// =============================================================
// js/run-hs-together-together.js
// Animations-Wiedergabe mit zentraler Synchronisation
//
// ÄNDERUNGEN gegenüber dem Original:
//  - Timing über Supabase-Startzeit statt lokal
//  - Wartemodus wenn Admin noch nicht gestartet hat
//  - Automatischer Re-Sync wenn Browser zurück in Vordergrund kommt
// =============================================================

import { fetchSyncState, measureClockOffset, sendHeartbeat } from './sync.js';

'use strict';

const startBtn     = document.getElementById('startBtn');
const screen       = document.getElementById('screen');
const runStatus    = document.getElementById('runStatus');
const runLoader    = document.getElementById('runLoader');
const loaderStatus = document.getElementById('loaderStatus');
const timelineFile = document.getElementById('timelineFile');
const seatmapFile  = document.getElementById('seatmapFile');

const state = {
  timeline:    null,
  seatmap:     null,
  seat:        null,
  playing:     false,
  durationMs:  60000,
  background:  '#05060b',

  // Sync-Felder
  startEpoch:  null,  // Unix-Timestamp (ms) vom Server
  clockOffset: 0,     // Unterschied lokale Uhr ↔ Server-Uhr
  syncTimer:   null,  // Polling-Timer (Warte- und Lauf-Modus)
  waitMode:    false  // true = Nutzer hat Start gedrückt, wartet auf Admin
};

// =============================================================
// WAKE LOCK – verhindert Bildschirmsperre während der Show
// =============================================================

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      // Automatisch neu anfordern wenn Screen noch sichtbar und Show aktiv
      if (document.visibilityState === 'visible' && (state.waitMode || state.playing)) {
        requestWakeLock();
      }
    });
    console.log('[WakeLock] Screen bleibt an');
  } catch (err) {
    console.warn('[WakeLock] Nicht möglich:', err.message);
  }
}

// =============================================================
// STATUS-ANZEIGE
// =============================================================

function setStatus(message) {
  if (!runStatus) return;
  runStatus.textContent = message || '';
}

// =============================================================
// HILFSFUNKTIONEN FARBE (unverändert)
// =============================================================

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgb(hex) {
  const cleaned = hex.replace('#', '').trim();
  if (cleaned.length === 3) {
    return [
      parseInt(cleaned[0] + cleaned[0], 16),
      parseInt(cleaned[1] + cleaned[1], 16),
      parseInt(cleaned[2] + cleaned[2], 16)
    ];
  }
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16)
  ];
}

function rgbToCss(rgb) {
  if (!rgb) return '';
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function mixColors(a, b, t) {
  const clamped = clamp(t, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * clamped),
    Math.round(a[1] + (b[1] - a[1]) * clamped),
    Math.round(a[2] + (b[2] - a[2]) * clamped)
  ];
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

function seatMatchesMask(effect, seat) {
  if (!effect.mask || effect.mask.type !== 'polygon') return true;
  const points = effect.mask.points || [];
  if (points.length < 3) return true;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    const intersect =
      (yi > seat.yN) !== (yj > seat.yN) &&
      seat.xN < ((xj - xi) * (seat.yN - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function samplePalette(palette, t) {
  if (!palette || palette.length === 0) return null;
  if (palette.length === 1) return hexToRgb(palette[0]);
  const clamped = clamp(t, 0, 1);
  const scaled = clamped * (palette.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  return mixColors(
    hexToRgb(palette[idx]),
    hexToRgb(palette[Math.min(idx + 1, palette.length - 1)]),
    frac
  );
}

function rainbowColor(effect, seat, timeMs) {
  const axis  = effect.axis  || 'x';
  const speed = effect.speed || 0.4;
  const pos   = axis === 'y' ? seat.yN : seat.xN;
  const hue   = (pos * 360 + (timeMs / 1000) * speed * 360) % 360;
  return hsvToRgb(hue, 1, 1);
}

function stableNoise(seed, t) {
  const value = Math.sin(seed * 12.9898 + t * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function outsideColor(effect, colorB) {
  if (effect.outsideMode === 'secondary') return colorB;
  return null;
}

function localTimeMs(effect, timeMs) {
  const base = timeMs - effect.startMs;
  if (effect.loopMs && effect.loopMs > 0) {
    return ((base % effect.loopMs) + effect.loopMs) % effect.loopMs;
  }
  return base;
}

function sectionIndexFromOrder(effect, section) {
  if (!effect.sectionOrder || effect.sectionOrder.length === 0) return -1;
  return effect.sectionOrder.indexOf(section);
}

function paletteSample(effect, seat, timeMs, t) {
  const palette = effect.palette || [];
  if (!palette.length) return null;
  const mode = effect.paletteMode || 'effect';
  if (mode === 'time') {
    const speed = effect.paletteSpeed ?? 0.2;
    return samplePalette(palette, ((timeMs / 1000) * speed) % 1);
  }
  if (mode === 'spatial') {
    return samplePalette(palette, (seat.xN * 0.6 + seat.yN * 0.4) % 1);
  }
  return samplePalette(palette, clamp(t ?? 0, 0, 1));
}

function randomIndices(count, total, seed) {
  const chosen = new Set();
  let value = seed || 1;
  while (chosen.size < count && chosen.size < total) {
    value = (value * 1664525 + 1013904223) % 4294967296;
    chosen.add(Math.floor((value / 4294967296) * total));
  }
  return chosen;
}

function heartInside(seat, effect, timeMs) {
  const size      = effect.heartSize      ?? 0.18;
  const thickness = effect.heartThickness ?? 0.02;
  const mode      = effect.heartMode      || 'blink';
  let cx = effect.heartCenterX ?? 0.5;
  let cy = effect.heartCenterY ?? 0.5;
  if (mode === 'fly') {
    const speed  = effect.heartSpeed ?? 0.3;
    const loopMs = effect.loopMs && effect.loopMs > 0 ? effect.loopMs : effect.durationMs;
    const t      = clamp((localTimeMs(effect, timeMs) / 1000 * speed * 1000) / Math.max(loopMs, 1), 0, 1);
    cx = (effect.heartStartX ?? 0.3) + ((effect.heartEndX ?? 0.7) - (effect.heartStartX ?? 0.3)) * t;
    cy = (effect.heartStartY ?? 0.2) + ((effect.heartEndY ?? 0.7) - (effect.heartStartY ?? 0.2)) * t;
  }
  const cos   = Math.cos((effect.heartRotation || 0) * (Math.PI / 180));
  const sin   = Math.sin((effect.heartRotation || 0) * (Math.PI / 180));
  const xr    = (seat.xN - cx) / Math.max(size, 0.01);
  const yr    = (seat.yN - cy) / Math.max(size, 0.01);
  const rx    = xr * cos - yr * sin;
  const yy    = -(xr * sin + yr * cos);
  const value = Math.pow(rx * rx + yy * yy - 1, 3) - rx * rx * Math.pow(yy, 3);
  return thickness > 0 ? Math.abs(value) <= thickness : value <= 0.05;
}

function isEffectActive(effect, timeMs) {
  return timeMs >= effect.startMs && timeMs <= effect.startMs + effect.durationMs;
}

function effectProgress(effect, timeMs) {
  return clamp((timeMs - effect.startMs) / Math.max(effect.durationMs, 1), 0, 1);
}

// =============================================================
// FARB-RENDERING — Editor-kompatibel
// =============================================================

function smoothstep(t) {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

function samplePaletteWrap(colors, t) {
  if (!colors?.length) return [255, 255, 255];
  if (colors.length === 1) return hexToRgb(colors[0]);
  const n = colors.length;
  const wrapped = ((t % 1) + 1) % 1;
  const scaled = wrapped * n;
  const idx = Math.floor(scaled) % n;
  const frac = scaled - Math.floor(scaled);
  return mixColors(hexToRgb(colors[idx]), hexToRgb(colors[(idx + 1) % n]), frac);
}

function seatSeed(seat) {
  const px = Math.round(seat.xN * 10240);
  const py = Math.round(seat.yN * 7680);
  let h = (Math.imul(px, 0x9e3779b9) ^ Math.imul(py, 0x85ebca6b)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) | 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

// ── Topologie (bowlAngle/ring/level) inline aus Sitz-Position ────────────────

const _TOPO_OVERRIDES = {
  'GA-FRONT-L': { bowlAngle: 0.12, distanceToStageLinear: 0.06, ring: 0.10, level: 'floor' },
  'GA-FRONT-R': { bowlAngle: 0.88, distanceToStageLinear: 0.06, ring: 0.10, level: 'floor' },
  'GA-REAR':    { bowlAngle: 0.50, distanceToStageLinear: 0.94, ring: 0.20, level: 'floor' },
  'GA-CIRCLE':  { bowlAngle: 0.50, distanceToStageLinear: 0.40, ring: 0.15, level: 'floor' },
  'GA-KISS':    { bowlAngle: 0.40, distanceToStageLinear: 0.38, ring: 0.15, level: 'floor' },
  'GA-DISCO':   { bowlAngle: 0.50, distanceToStageLinear: 0.35, ring: 0.15, level: 'floor' },
  'GA-SQUARE':  { bowlAngle: 0.60, distanceToStageLinear: 0.38, ring: 0.15, level: 'floor' },
};

function getSeatTopo(seat) {
  if (_TOPO_OVERRIDES[seat.section]) return _TOPO_OVERRIDES[seat.section];
  const xN = seat.xN, yN = seat.yN;
  const raw = Math.atan2(yN - 0.5, xN - 0.5);
  const bowlAngle = (((raw - Math.PI) / (Math.PI * 2)) + 1) % 1;
  const distanceToStageLinear = clamp(xN, 0, 1);
  const dist = Math.hypot(xN - 0.5, yN - 0.5);
  const ring = clamp(dist / 0.45, 0, 1);
  const level = ring < 0.28 ? 'lower' : ring < 0.55 ? 'upper' : 'corner';
  return { bowlAngle, distanceToStageLinear, ring, level };
}

// ── Text-Masken-Cache (Canvas, entspricht textMask.js im Editor) ─────────────

const _textMaskCache = new Map();

function buildTextMask(text, textX, textY, textSize, fontFamily, textRotation, textCurve) {
  const key = `${text}|${textX.toFixed(3)}|${textY.toFixed(3)}|${textSize.toFixed(3)}|${fontFamily}|${(textRotation || 0).toFixed(1)}|${(textCurve || 0).toFixed(3)}`;
  if (_textMaskCache.has(key)) return _textMaskCache.get(key);

  const W = 1024, H = 768;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  const cx = textX * W;
  const cy = textY * H;
  const fontPx = Math.max(8, Math.round(textSize * W));
  const rot = textRotation ?? 0;
  const curve = textCurve ?? 0;

  ctx.save();
  ctx.translate(cx, cy);
  if (rot !== 0) ctx.rotate(rot * Math.PI / 180);
  ctx.font = `bold ${fontPx}px ${fontFamily || 'Arial Black'}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (Math.abs(curve) > 1e-5) {
    const letters = Array.from(text);
    const metrics = letters.map(ch => ({ ch, width: ctx.measureText(ch).width }));
    const totalWidth = metrics.reduce((s, m) => s + m.width, 0) || 1;
    const maxAngle = Math.min(Math.max(curve, 0), 1) * Math.PI * 0.72;
    const radius = maxAngle > 0 ? totalWidth / maxAngle : 0;
    let xPos = -totalWidth / 2;
    for (const { ch, width } of metrics) {
      const charCenter = xPos + width / 2;
      const theta = (charCenter / totalWidth) * maxAngle;
      ctx.save();
      ctx.translate(radius * Math.sin(theta), radius - radius * Math.cos(theta));
      ctx.rotate(theta);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      xPos += width;
    }
  } else {
    ctx.fillText(text, 0, 0);
  }
  ctx.restore();

  const data = ctx.getImageData(0, 0, W, H).data;
  const lookup = (xN, yN) => {
    const px = Math.round(xN * (W - 1));
    const py = Math.round(yN * (H - 1));
    if (px < 0 || px >= W || py < 0 || py >= H) return false;
    return data[(py * W + px) * 4] > 127;
  };
  _textMaskCache.set(key, lookup);
  return lookup;
}

// ── Basis-Farbe aus colors[] und colorMode ────────────────────────────────────

function resolveBaseColor(effect, seat, timeMs) {
  const colorMode = effect.colorMode || 'solid';
  if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);

  const colors = (effect.colors?.length > 0) ? effect.colors : [effect.color1 || '#ffffff'];
  const animSpeed = effect.colorAnimSpeed ?? 0.3;

  if (colorMode === 'cycle') {
    return samplePaletteWrap(colors, (timeMs / 1000) * animSpeed);
  }
  if (colorMode === 'flow') {
    const dir = effect.gradientDirection || 'left-to-right';
    let pos;
    switch (dir) {
      case 'right-to-left': pos = 1 - seat.xN; break;
      case 'top-to-bottom': pos = seat.yN; break;
      case 'bottom-to-top': pos = 1 - seat.yN; break;
      case 'diagonal-tl':   pos = (seat.xN + seat.yN) / 2; break;
      case 'diagonal-tr':   pos = ((1 - seat.xN) + seat.yN) / 2; break;
      case 'radial':        pos = clamp(Math.hypot(seat.xN - 0.5, seat.yN - 0.5) * 1.41421356, 0, 1); break;
      default:              pos = seat.xN;
    }
    return samplePaletteWrap(colors, pos + (timeMs / 1000) * animSpeed);
  }
  if (colorMode === 'center-out') {
    const r = clamp(Math.hypot(seat.xN - 0.5, seat.yN - 0.5) * 1.41421356, 0, 1);
    return samplePaletteWrap(colors, r - (timeMs / 1000) * animSpeed);
  }
  if (colorMode === 'outside-in') {
    const r = clamp(Math.hypot(seat.xN - 0.5, seat.yN - 0.5) * 1.41421356, 0, 1);
    return samplePaletteWrap(colors, r + (timeMs / 1000) * animSpeed);
  }
  if (colorMode === 'rotate') {
    const angle = Math.atan2(seat.yN - 0.5, seat.xN - 0.5);
    const pos = (angle / (Math.PI * 2)) + 0.5;
    return samplePaletteWrap(colors, pos + (timeMs / 1000) * animSpeed);
  }

  if (colors.length === 1) return hexToRgb(colors[0]);

  const dir = effect.gradientDirection || 'left-to-right';
  let t;
  switch (dir) {
    case 'right-to-left': t = 1 - seat.xN; break;
    case 'top-to-bottom': t = seat.yN; break;
    case 'bottom-to-top': t = 1 - seat.yN; break;
    case 'diagonal-tl':   t = (seat.xN + seat.yN) / 2; break;
    case 'diagonal-tr':   t = ((1 - seat.xN) + seat.yN) / 2; break;
    case 'radial':        t = clamp(Math.hypot(seat.xN - 0.5, seat.yN - 0.5) * 1.41421356, 0, 1); break;
    default:              t = seat.xN;
  }
  const n = colors.length;
  const scaled = clamp(t, 0, 1) * (n - 1);
  const idx = Math.min(Math.floor(scaled), n - 2);
  const softness = clamp(effect.gradientSoftness ?? 0.5, 0.01, 1);
  let frac = scaled - Math.floor(scaled);
  frac = frac * softness + (frac < 0.5 ? 0 : 1) * (1 - softness);
  return mixColors(hexToRgb(colors[idx]), hexToRgb(colors[idx + 1]), frac);
}

// ── Fade-Hüllkurve ────────────────────────────────────────────────────────────

function computeFadeAlpha(effect, timeMs) {
  let alpha = 1;
  const fadeInMs = effect.fadeInMs ?? 0;
  if (fadeInMs > 0) {
    const elapsed = timeMs - effect.startMs;
    if (elapsed < fadeInMs) alpha = Math.min(alpha, smoothstep(clamp(elapsed / fadeInMs, 0, 1)));
  }
  const fadeOutMs = effect.fadeOutMs ?? 0;
  if (fadeOutMs > 0) {
    const remaining = (effect.startMs + effect.durationMs) - timeMs;
    if (remaining < fadeOutMs) alpha = Math.min(alpha, smoothstep(clamp(remaining / fadeOutMs, 0, 1)));
  }
  return alpha;
}

// ── Rohfarbe pro Effekt ───────────────────────────────────────────────────────
// Gibt color, [color, sparkleAlpha] oder null zurück.

function resolveSeatColorRaw(effect, seat, timeMs) {
  const localT    = localTimeMs(effect, timeMs) / 1000;
  const baseColor = resolveBaseColor(effect, seat, timeMs);
  const BLACK     = [0, 0, 0];

  if (effect.type === 'solid') {
    return baseColor;
  }

  // Jeder Sitz = ein Pixel; zusammen formen alle Handys den Schriftzug.
  if (effect.type === 'text-sign') {
    const text = (effect.text ?? 'TEXT').trim() || 'TEXT';
    const lookup = buildTextMask(
      text,
      effect.textX        ?? 0.5,
      effect.textY        ?? 0.5,
      effect.textSize     ?? 0.12,
      effect.fontFamily   ?? 'Arial Black',
      effect.textRotation ?? 0,
      effect.textCurve    ?? 0,
    );
    const inText = lookup(seat.xN, seat.yN);
    const colors = effect.colors ?? ['#ffffff'];
    const bgMode = effect.textBackgroundMode ?? 'none';
    const bgColor = bgMode === 'background' && colors.length >= 2 ? hexToRgb(colors[1]) : null;
    if (!inText) return bgColor;
    return hexToRgb(colors[0] ?? '#ffffff');
  }

  if (effect.type === 'sparkle-field') {
    const density = clamp(effect.sparkleDensity ?? 0.2, 0, 1);
    const speed   = effect.sparkleSpeed ?? 1.0;
    const seed    = seatSeed(seat);
    const noise   = stableNoise(seed, localT * speed * 0.35);
    if (!(noise < density)) return null;
    return baseColor;
  }

  if (effect.type === 'twinkle') {
    const speed     = clamp(effect.twinkleSpeed     ?? 1.0, 0.1, 5.0);
    const intensity = clamp(effect.twinkleIntensity ?? 0.90, 0.1, 1.0);
    const base      = clamp(effect.twinkleBase      ?? 0.10, 0.0, 0.45);
    const softness  = clamp(effect.twinkleSoftness  ?? 2.5,  1.0, 6.0);
    const density   = clamp(effect.twinkleDensity   ?? 0.70, 0.1, 1.0);
    const seed      = seatSeed(seat);
    const t         = timeMs / 1000;

    const activeSeat = stableNoise(seed * 7.91, 0) < density;
    let brightness;
    if (activeSeat) {
      const freq1  = (0.5 + stableNoise(seed * 1.7,  0) * 1.8) * speed;
      const phase1 = stableNoise(seed * 2.3, 0) * Math.PI * 2;
      const fast   = Math.pow(Math.max(0, Math.sin(t * freq1 * Math.PI * 2 + phase1)), softness);
      const freq2  = (0.08 + stableNoise(seed * 4.1, 0) * 0.17) * speed;
      const phase2 = stableNoise(seed * 5.7, 0) * Math.PI * 2;
      const slow   = (Math.sin(t * freq2 * Math.PI * 2 + phase2) + 1) * 0.5;
      brightness   = base + (1 - base) * (fast * intensity * (0.4 + 0.6 * slow));
    } else {
      const freq2  = (0.05 + stableNoise(seed * 3.3, 0) * 0.12) * speed;
      const phase2 = stableNoise(seed * 6.1, 0) * Math.PI * 2;
      const slow   = (Math.sin(t * freq2 * Math.PI * 2 + phase2) + 1) * 0.5;
      brightness   = base * (0.3 + 0.7 * slow);
    }
    if (brightness < 0.015) return null;
    return [baseColor, clamp(brightness, 0, 1)];
  }

  if (effect.type === 'heart') {
    if (!heartInside(seat, effect, timeMs)) return null;
    const anim = effect.heartAnim || 'static';
    if (anim === 'breathe') {
      const pulse = (Math.sin(localT * (effect.heartBreatheSpeed || 0.4) * Math.PI * 2) + 1) * 0.5;
      if (pulse < 0.25) return null;
      return [baseColor, pulse];
    }
    if (anim === 'blink') {
      const intervalMs = Math.max(effect.loopMs || 1000, 200);
      const prog = (localTimeMs(effect, timeMs) % intervalMs) / intervalMs;
      if (prog > 0.5) return null;
      return [baseColor, clamp(Math.sin(prog * Math.PI * 2) * 2, 0, 1)];
    }
    return baseColor;
  }

  if (effect.type === 'topo-breathing-bowl') {
    const topo       = getSeatTopo(seat);
    const speed      = effect.breatheSpeed ?? 0.25;
    const phaseShift = effect.phaseShift   ?? 0.35;
    const phase = topo.ring * phaseShift;
    const t = ((localT * speed + phase) % 1 + 1) % 1;
    let mix;
    if (t < 0.45)      mix = smoothstep(t / 0.45);
    else if (t < 0.55) mix = 1.0;
    else               mix = smoothstep(1 - (t - 0.55) / 0.45);
    if (mix <= 0.01) return null;
    return mixColors(BLACK, baseColor, mix);
  }

  if (effect.type === 'topo-bowl-sweep') {
    const topo      = getSeatTopo(seat);
    const speed     = effect.speed ?? 0.2;
    const waveWidth = Math.max(effect.waveWidth ?? 0.15, 0.01);
    const dir       = effect.reverse ? -1 : 1;
    const wavePos   = ((localT * speed * dir) % 1 + 1) % 1;
    const diff      = ((topo.bowlAngle - wavePos) % 1 + 1) % 1;
    const angDist   = Math.min(diff, 1 - diff);
    const mix       = smoothstep(1 - angDist / Math.max(waveWidth / 2, 0.005));
    if (mix <= 0) return null;
    return mixColors(BLACK, baseColor, mix);
  }

  if (effect.type === 'topo-orbit-chase') {
    const topo = getSeatTopo(seat);
    const speed = effect.speed ?? 0.25;
    const band  = Math.max(effect.band ?? 0.08, 0.01);
    const dir   = effect.reverse ? -1 : 1;
    const LEVEL_LAG = { floor: 0.0, lower: 0.04, upper: 0.08, corner: 0.12 };
    const lag      = LEVEL_LAG[topo.level] ?? 0;
    const orbitPos = ((localT * speed * dir + lag) % 1 + 1) % 1;
    const diff     = ((topo.bowlAngle - orbitPos) % 1 + 1) % 1;
    const angDist  = Math.min(diff, 1 - diff);
    const mix      = smoothstep(1 - angDist / Math.max(band / 2, 0.005));
    if (mix <= 0) return null;
    return mixColors(BLACK, baseColor, mix);
  }

  if (effect.type === 'topo-gradient-bands') {
    const topo   = getSeatTopo(seat);
    const speed  = effect.speed ?? 0.15;
    const dir    = effect.reverse ? -1 : 1;
    const offset = ((localT * speed * dir) % 1 + 1) % 1;
    const pos    = ((topo.bowlAngle + offset) % 1 + 1) % 1;
    const cols   = effect.colors?.length > 0 ? effect.colors : ['#ff4488', '#4488ff'];
    return samplePaletteWrap(cols, pos);
  }

  return baseColor;
}

// ── Layer-Compositing: Rohfarbe + Fade-Hüllkurve → [color, alpha] ────────────

function resolveSeatColorAndFade(effect, seat, timeMs) {
  const raw = resolveSeatColorRaw(effect, seat, timeMs);
  if (raw === null) return [null, 0];

  let color, sparkleAlpha;
  if (Array.isArray(raw[0])) {
    color = raw[0]; sparkleAlpha = raw[1];
  } else {
    color = raw; sparkleAlpha = 1;
  }
  if (!color) return [null, 0];

  const alpha = computeFadeAlpha(effect, timeMs) * sparkleAlpha;
  if (alpha <= 0.005) return [null, 0];
  return [color, alpha];
}

// =============================================================
// SITZ-AUSWAHL (unverändert)
// =============================================================

function getSeatFromSelection(seats, selection) {
  if (!selection || !selection.block) return null;
  if (selection.tier === 'standing') {
    const standingSeats = seats.filter(s => s.section === selection.block);
    if (!standingSeats.length) return null;
    const stored = localStorage.getItem('standingSeatId');
    if (stored) {
      const match = standingSeats.find(s => s.id === stored);
      if (match) return match;
    }
    const randomSeat = standingSeats[Math.floor(Math.random() * standingSeats.length)];
    localStorage.setItem('standingSeatId', randomSeat.id);
    return randomSeat;
  }
  return seats.find(s =>
    String(s.section) === String(selection.block) &&
    String(s.row)     === String(selection.row)   &&
    String(s.seat)    === String(selection.seat)
  );
}

function getSelection() {
  const raw = localStorage.getItem('hs_together_seat');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// =============================================================
// AKTIVE FARBE FINDEN — Bottom-to-top Layer-Compositing
// =============================================================

function findEffectColor(timeMs) {
  let current = hexToRgb(state.background);

  const effects = (state.timeline && state.timeline.effects) || [];
  const active  = effects
    .filter(e => isEffectActive(e, timeMs))
    .filter(e => !e.sections || e.sections.length === 0 || e.sections.includes(state.seat.section))
    .filter(e => seatMatchesMask(e, state.seat));

  active.sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0) || a.startMs - b.startMs);

  for (const effect of active) {
    const [color, alpha] = resolveSeatColorAndFade(effect, state.seat, timeMs);
    if (!color || alpha <= 0.005) continue;
    current = alpha >= 0.995 ? color : mixColors(current, color, alpha);
  }

  return current;
}

// =============================================================
// ANIMATIONS-LOOP  ←  GEÄNDERT
// =============================================================

function renderFrame() {
  if (!state.playing) return;

  // Zentrale Zeit: Server-Startzeit + Uhr-Korrektur
  const correctedNow = Date.now() + state.clockOffset;
  const timeMs       = correctedNow - state.startEpoch;

  // Show noch nicht gestartet → Wartebildschirm
  if (timeMs < 0) {
    const remaining = Math.ceil(-timeMs / 1000);
    setStatus(`Show starts in ${remaining}s...`);
    screen.style.backgroundColor = state.background;
    requestAnimationFrame(renderFrame);
    return;
  }

  // Show beendet → zurück in Wartezustand (kein "Show ended" für Zuschauer)
  if (timeMs > state.durationMs) {
    stopSyncPolling();
    resetToWaiting();
    return;
  }

  // Normale Wiedergabe
  setStatus('');
  screen.style.backgroundColor = rgbToCss(findEffectColor(timeMs));
  screen.style.opacity          = '1';

  requestAnimationFrame(renderFrame);
}

// =============================================================
// SYNC-POLLING  ←  NEU: zentrale Funktionen dafür
// =============================================================

function stopSyncPolling() {
  if (state.syncTimer) {
    clearInterval(state.syncTimer);
    state.syncTimer = null;
  }
}

/**
 * Startet das Polling.
 * intervalMs: Wie oft abgefragt wird (Standard: 3000ms im Wartemodus,
 *             15000ms während die Show läuft)
 */
function startSyncPolling(intervalMs) {
  stopSyncPolling(); // Alten Timer zuerst stoppen, um Doppel-Timer zu vermeiden
  state.syncTimer = setInterval(() => syncCheck(), intervalMs);
}

/**
 * Eine einzelne Sync-Prüfung.
 * Wird vom Polling-Timer und vom Visibility-Handler aufgerufen.
 */
async function syncCheck() {
  try {
    const syncData = await fetchSyncState();

    if (!syncData || syncData.start_epoch === null || syncData.start_epoch === undefined) {
      // Admin hat noch nicht gestartet oder hat resettet
      if (state.playing) {
        // Show lief, wurde aber zurückgesetzt → zurück in Wartezustand
        resetToWaiting();
      }
      // Wenn im waitMode: einfach weiter warten, nicht zurücksetzen
      return;
    }

    const newEpoch = syncData.start_epoch;

    if (newEpoch !== state.startEpoch) {
      // Startzeit hat sich geändert (neuer Start oder Reset+Neustart)
      console.log('[Sync] Startzeit aktualisiert:', newEpoch);
      state.startEpoch = newEpoch;
    }

    // Wartemodus: Nutzer hat gedrückt, Admin hat jetzt gestartet
    if (state.waitMode && state.startEpoch) {
      state.waitMode = false;
      beginAnimation();
      return;
    }

    // Show läuft bereits und Polling passt Intervall an
    if (state.playing) {
      // Während der Show reichen 15 Sekunden
      startSyncPolling(15000);
    }

  } catch (err) {
    console.warn('[Sync] Sync-Check fehlgeschlagen:', err.message);
    // Kein Netz → einfach weiterlaufen
  }
}

// =============================================================
// ANIMATION STARTEN  ←  GEÄNDERT
// =============================================================

/**
 * Startet die eigentliche Animations-Schleife.
 * Wird aufgerufen wenn startEpoch bekannt ist.
 */
function beginAnimation() {
  document.body.classList.add('playing');
  document.body.classList.remove('wait-mode');
  document.getElementById('waitIndicator').hidden = true;
  requestWakeLock();

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (document.documentElement.webkitRequestFullscreen) {
    document.documentElement.webkitRequestFullscreen();
  }

  state.playing  = true;
  state.waitMode = false;
  setStatus('');

  renderFrame();

  // Während der Show alle 15 Sekunden synchronisieren
  startSyncPolling(15000);
}

/**
 * Wird aufgerufen wenn der Nutzer auf "Start" drückt.
 *
 * Fall A: Admin hat bereits gestartet → sofort an richtiger Stelle einsteigen
 * Fall B: Admin hat noch nicht gestartet → Wartemodus, automatischer Start sobald Signal kommt
 */
async function startShow() {
  if (!state.seat || !state.timeline) return;

  requestWakeLock();
  startBtn.classList.add('hidden');

  // Startzeit noch nicht bekannt? → Einmal direkt nachfragen
  if (!state.startEpoch) {
    setStatus('Connecting...');
    try {
      const syncData = await fetchSyncState();
      if (syncData && syncData.start_epoch) {
        state.startEpoch = syncData.start_epoch;
      }
    } catch {
      // Kein Netz → weiter mit null
    }
  }

  if (state.startEpoch) {
    // ✅ Fall A: Admin hat bereits gestartet
    const correctedNow = Date.now() + state.clockOffset;
    const elapsed      = correctedNow - state.startEpoch;

    if (elapsed > state.durationMs) {
      // Show schon vorbei → zurück in Wartezustand, nicht "beendet" zeigen
      resetToWaiting();
      return;
    }

    if (elapsed > 0) {
      setStatus(`Joining... (show running for ${Math.round(elapsed / 1000)}s)`);
    }

    beginAnimation();

  } else {
    // ⏳ Fall B: Admin hat noch NICHT gestartet → Wartemodus
    state.waitMode = true;
    document.body.classList.add('wait-mode');
    setStatus('');
    document.getElementById('waitIndicator').hidden = false;
    screen.style.backgroundColor = state.background;

    // Alle 3 Sekunden nachfragen (engeres Polling im Wartemodus)
    startSyncPolling(3000);
  }
}

// =============================================================
// BROWSER IM HINTERGRUND / PAGE VISIBILITY  ←  NEU
// =============================================================

/**
 * Wird aufgerufen, wenn der Nutzer in den Browser zurückkehrt.
 * (z.B. von der Kamera-App, nach Bildschirmsperre, etc.)
 *
 * Was hier passiert:
 * 1. Clock-Offset neu messen (Uhr könnte abgewichen sein)
 * 2. Aktuellen Show-Status laden
 * 3. Wenn Show läuft und Animation war aktiv → renderFrame() neu starten
 *    (weil requestAnimationFrame im Hintergrund pausiert wurde)
 * 4. Wenn im Wartemodus und Show inzwischen gestartet → automatisch einsteigen
 */
async function handleReturnToForeground() {
  console.log('[Sync] Browser wieder sichtbar – Re-Sync...');

  // Wake Lock wird beim Tab-Wechsel automatisch freigegeben → neu anfordern
  if (state.waitMode || state.playing) {
    requestWakeLock();
  }

  // 1. Uhr neu abgleichen
  state.clockOffset = await measureClockOffset();

  // 2. Aktuellen Status laden
  try {
    const syncData = await fetchSyncState();

    if (syncData && syncData.start_epoch) {
      state.startEpoch = syncData.start_epoch;

      const correctedNow = Date.now() + state.clockOffset;
      const elapsed      = correctedNow - state.startEpoch;

      if (elapsed > state.durationMs) {
        // Show schon vorbei → zurück in Wartezustand
        stopSyncPolling();
        resetToWaiting();
        return;
      }

      // Wartemodus: Show ist inzwischen gestartet
      if (state.waitMode) {
        state.waitMode = false;
        beginAnimation();
        return;
      }

      // Show lief bereits → renderFrame() neu starten
      // (war pausiert während Browser im Hintergrund)
      if (state.playing) {
        console.log('[Sync] Starte renderFrame() neu nach Hintergrund-Pause');
        renderFrame(); // Startet die Schleife wieder, springt automatisch zur richtigen Stelle
        return;
      }

    } else {
      // Admin hat noch nicht gestartet oder zurückgesetzt
      state.startEpoch = null;
      if (state.playing) {
        resetToWaiting();
      }
    }

  } catch (err) {
    console.warn('[Sync] Re-Sync nach Hintergrund fehlgeschlagen:', err.message);
    // Kein Netz: Wenn Animation lief, einfach weiterlaufen lassen
    if (state.playing && state.startEpoch) {
      renderFrame(); // Schleife neu starten (war durch Hintergrund pausiert)
    }
  }
}

// Page Visibility API: Browser-Event wenn Seite sichtbar/unsichtbar wird
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // Nutzer kommt zurück (von Kamera, anderem App, Bildschirmsperre etc.)
    handleReturnToForeground();
  } else {
    // Browser geht in Hintergrund
    // Wir stoppen den Polling-Timer – er wird beim Zurückkehren
    // durch handleReturnToForeground() neu gestartet.
    // Die Animation selbst pausiert der Browser automatisch.
    console.log('[Sync] Browser in Hintergrund – Polling pausiert');
    stopSyncPolling();
  }
});

// =============================================================
// DATEIEN LADEN (unverändert)
// =============================================================

function enableStart() {
  startBtn.disabled    = false;
  startBtn.textContent = "Press Start when 'Coming Up Roses' begins";
}

/**
 * Setzt die Run-Seite in den Wartezustand zurück.
 * Wird nach Show-Ende, Reset oder Fehler aufgerufen –
 * Zuschauer sehen NIEMALS "Show ended".
 */
function resetToWaiting() {
  state.playing    = false;
  state.startEpoch = null;
  state.waitMode   = false;
  document.body.classList.remove('playing');
  document.body.classList.remove('wait-mode');
  document.getElementById('waitIndicator').hidden = true;
  setStatus('Show begins soon');
  startBtn.classList.remove('hidden');
  startBtn.textContent = "Press Start when 'Coming Up Roses' begins";
  startBtn.disabled    = false;
  // Langsames Polling: warten auf nächstes Admin-Start-Signal
  startSyncPolling(5000);
}

async function loadJsonWithFallback(paths) {
  for (const path of paths) {
    try {
      const url = window.location.hostname.includes('github')
        ? `${path}?t=${Date.now()}`
        : path;
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (err) {
      console.error(`Fehler beim Laden von ${path}:`, err);
    }
  }
  return null;
}

function checkReady() {
  if (!state.timeline || !state.seat) return false;

  runLoader.hidden = true;
  enableStart();

  if (state.startEpoch) {
    const correctedNow = Date.now() + state.clockOffset;
    const elapsed      = correctedNow - state.startEpoch;
    if (elapsed > 0 && elapsed < state.durationMs) {
      setStatus(`Show already running (${Math.round(elapsed / 1000)}s). Press Start to join.`);
    } else if (elapsed <= 0) {
      setStatus("Show starts soon. Press Start when 'Coming Up Roses' begins.");
    } else {
      // Show ist schon vorbei → Wartezustand, nicht "beendet"
      resetToWaiting();
      return true;
    }
  } else {
    setStatus('Show begins soon');
  }
  return true;
}

// =============================================================
// INITIALISIERUNG  ←  ERWEITERT
// =============================================================

async function init() {
  startBtn.disabled    = true;
  startBtn.textContent = 'Loading...';

  const selection = getSelection();
  if (!selection) {
    setStatus('No seat selected. Please choose your seat first.');
    return;
  }

  // Validate standing coordinates before doing any loading
  if (selection.type === 'standing') {
    const xN = Number(selection.xN);
    const yN = Number(selection.yN);
    if (!Number.isFinite(xN) || !Number.isFinite(yN)) {
      setStatus('Location not saved correctly. Returning to seat selection...');
      setTimeout(() => { window.location.href = './join-hs-together.html'; }, 3000);
      return;
    }
  }

  // 1. Uhr mit Server abgleichen
  state.clockOffset = await measureClockOffset();
  console.log('[Sync] Clock-Offset:', state.clockOffset, 'ms');

  // 2. Aktuellen Show-Status laden
  try {
    const syncData = await fetchSyncState();
    if (syncData && syncData.start_epoch !== null && syncData.start_epoch !== undefined) {
      state.startEpoch = syncData.start_epoch;
      console.log('[Sync] Show läuft bereits seit',
        Math.round(((Date.now() + state.clockOffset) - state.startEpoch) / 1000), 's');
    }
  } catch (err) {
    console.warn('[Sync] Init-Sync fehlgeschlagen – kein Netz?', err.message);
  }

  // 3. Timeline laden
  state.timeline = await loadJsonWithFallback([
    '/data/timeline.json', './data/timeline.json', 'data/timeline.json'
  ]);

  if (!state.timeline) {
    if (loaderStatus) {
      loaderStatus.style.color = '#ff4d6d';
      loaderStatus.textContent = 'FEHLER: timeline.json nicht gefunden.';
    }
    runLoader.hidden = false;
    setStatus(window.location.protocol === 'file:'
      ? 'Blocked locally. Please upload the files manually.'
      : 'Files not found in "data" folder.');
    return;
  }

  // 4. Seat-Objekt aufbauen — stehend: synthetisch, sitzend: aus Sektion-JSON
  if (selection.type === 'standing') {
    const xN = Number(selection.xN);
    const yN = Number(selection.yN);
    state.seat = {
      id:      `standing-${selection.area}-${xN.toFixed(4)}-${yN.toFixed(4)}`,
      section: selection.area,
      xN,
      yN
    };
  } else {
    const sectionPath = encodeURIComponent(selection.block);
    state.seatmap = await loadJsonWithFallback([
      `/data/seats/${sectionPath}.json`,
      `./data/seats/${sectionPath}.json`,
      `data/seats/${sectionPath}.json`
    ]);

    if (!state.seatmap) {
      if (loaderStatus) {
        loaderStatus.style.color = '#ff4d6d';
        loaderStatus.textContent = 'FEHLER: seat section file nicht gefunden.';
      }
      runLoader.hidden = false;
      setStatus(window.location.protocol === 'file:'
        ? 'Blocked locally. Please upload the files manually.'
        : 'Files not found in "data" folder.');
      return;
    }

    state.seat = getSeatFromSelection(state.seatmap.seats || [], selection);

    if (!state.seat) {
      setStatus('Seat not found. Please select your seat again.');
      return;
    }
  }

  state.durationMs = Math.max(1000, state.timeline.meta?.durationMs ?? 60000);
  state.background = state.timeline.meta?.backgroundColor || state.background;

  checkReady();

  // Participant heartbeat: sofort und dann alle 3 Minuten
  sendHeartbeat();
  setInterval(sendHeartbeat, 3 * 60 * 1000);
}

// =============================================================
// MANUELLES DATEILADEN (Fallback, unverändert)
// =============================================================

function tryManualLoad() {
  const selection = getSelection();
  if (!state.timeline) return;
  if (selection?.type !== 'standing' && !state.seatmap) return;
  runLoader.hidden = true;
  state.durationMs = Math.max(1000, state.timeline.meta?.durationMs ?? 60000);
  state.background = state.timeline.meta?.backgroundColor || state.background;
  if (selection?.type === 'standing') {
    const xN = Number(selection.xN);
    const yN = Number(selection.yN);
    state.seat = {
      id:      `standing-${selection.area}-${xN.toFixed(4)}-${yN.toFixed(4)}`,
      section: selection.area,
      xN,
      yN
    };
  } else {
    state.seat = getSeatFromSelection(state.seatmap.seats || [], selection);
  }
  if (!state.seat) { setStatus('Seat not found.'); return; }
  checkReady();
}

if (timelineFile) {
  timelineFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state.timeline = JSON.parse(reader.result);
        if (loaderStatus) loaderStatus.textContent = 'timeline.json geladen.';
        tryManualLoad();
      } catch { alert('timeline.json konnte nicht gelesen werden.'); }
    };
    reader.readAsText(file);
  });
}

if (seatmapFile) {
  seatmapFile.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state.seatmap = JSON.parse(reader.result);
        if (loaderStatus) loaderStatus.textContent = 'seatmap_mapping.json geladen.';
        tryManualLoad();
      } catch { alert('seatmap_mapping.json konnte nicht gelesen werden.'); }
    };
    reader.readAsText(file);
  });
}

// =============================================================
// START-KNOPF
// =============================================================

startBtn.addEventListener('click', () => {
  if (!state.playing && !state.waitMode) {
    startShow();
  }
});

// =============================================================
// START
// =============================================================

init();
