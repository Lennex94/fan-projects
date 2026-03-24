// =============================================================
// js/run-hs-together-together.js
// Animations-Wiedergabe mit zentraler Synchronisation
//
// ÄNDERUNGEN gegenüber dem Original:
//  - Timing über Supabase-Startzeit statt lokal
//  - Wartemodus wenn Admin noch nicht gestartet hat
//  - Automatischer Re-Sync wenn Browser zurück in Vordergrund kommt
// =============================================================

import { fetchSyncState, measureClockOffset } from './sync.js';

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
// FARB-RENDERING (unverändert)
// =============================================================

function resolveSeatColor(effect, seat, timeMs) {
  const colorA    = hexToRgb(effect.color1 || '#ffffff');
  const colorB    = hexToRgb(effect.color2 || '#000000');
  const localT    = localTimeMs(effect, timeMs) / 1000;
  const palette   = effect.palette || [];
  const colorMode = effect.colorMode || 'dual';

  if (effect.type === 'solid') {
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, 0) || colorA;
    return colorA;
  }
  if (effect.type === 'fade') {
    const prog = clamp(localTimeMs(effect, timeMs) / Math.max(effect.durationMs, 1), 0, 1);
    const mode = effect.fadeMode || 'in-out';
    let t = prog;
    if (mode === 'out')    t = 1 - prog;
    if (mode === 'in-out') t = Math.sin(prog * Math.PI);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, t) || mixColors(colorB, colorA, t);
    return mixColors(colorB, colorA, t);
  }
  if (effect.type === 'wave') {
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    const axis   = effect.axis   || 'x';
    const period = Math.max(effect.period || 0.25, 0.01);
    const speed  = effect.speed  || 0.4;
    const pos    = axis === 'y' ? seat.yN : seat.xN;
    const phase  = (pos / period + localT * speed) * Math.PI * 2;
    const mix    = (Math.sin(phase) + 1) * 0.5;
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorA, colorB, mix);
    return mixColors(colorA, colorB, mix);
  }
  if (effect.type === 'gradient') {
    const axis = effect.axis || 'x';
    const pos  = axis === 'y' ? seat.yN : seat.xN;
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, pos) || mixColors(colorA, colorB, pos);
    return mixColors(colorA, colorB, pos);
  }
  if (effect.type === 'split-sweep') {
    const loopMs = effect.loopMs && effect.loopMs > 0 ? effect.loopMs : effect.durationMs;
    const prog   = clamp(localTimeMs(effect, timeMs) / Math.max(loopMs, 1), 0, 1);
    const dir    = effect.splitDirection || 'edges-to-center';
    const dist   = Math.abs(seat.xN - 0.5);
    const active = dir === 'edges-to-center' ? dist >= 0.5 - prog * 0.5 : dist <= prog * 0.5;
    if (!active) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, prog) || colorA;
    return colorA;
  }
  if (effect.type === 'ripple') {
    const centerX  = effect.centerX  ?? 0.5;
    const centerY  = effect.centerY  ?? 0.5;
    const speed    = effect.speed    || 0.6;
    const spacing  = Math.max(effect.rippleSpacing || 0.2, 0.05);
    const band     = Math.max(effect.band || 0.12, 0.01);
    const dist     = Math.sqrt((seat.xN - centerX) ** 2 + (seat.yN - centerY) ** 2);
    const phase    = (dist / spacing - localT * speed) % 1;
    if (!(phase < band)) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, phase / band) || colorA;
    return colorA;
  }
  if (effect.type === 'radial-fill') {
    const centerX   = effect.centerX ?? 0.5;
    const centerY   = effect.centerY ?? 0.5;
    const maxRadius = Math.max(
      Math.hypot(centerX, centerY), Math.hypot(1 - centerX, centerY),
      Math.hypot(centerX, 1 - centerY), Math.hypot(1 - centerX, 1 - centerY)
    );
    const loopMs    = effect.loopMs && effect.loopMs > 0 ? effect.loopMs : effect.durationMs;
    const fillBase  = clamp(localTimeMs(effect, timeMs) / Math.max(loopMs, 1), 0, 1);
    const direction = effect.fillDirection || 'outward';
    const dist      = Math.sqrt((seat.xN - centerX) ** 2 + (seat.yN - centerY) ** 2);
    const edge      = direction === 'inward'
      ? dist >= maxRadius * (1 - fillBase)
      : dist <= maxRadius * fillBase;
    if (colorMode === 'rainbow') return edge ? rainbowColor(effect, seat, timeMs) : outsideColor(effect, colorB);
    if (colorMode === 'palette') return edge ? samplePalette(palette, fillBase) || colorA : outsideColor(effect, colorB);
    return edge ? colorA : outsideColor(effect, colorB);
  }
  if (effect.type === 'wipe') {
    const direction = effect.direction || 'left-to-right';
    const prog      = effectProgress(effect, timeMs);
    let inFront = false;
    if (direction === 'left-to-right')  inFront = seat.xN <= prog;
    if (direction === 'right-to-left')  inFront = seat.xN >= 1 - prog;
    if (direction === 'top-to-bottom')  inFront = seat.yN <= prog;
    if (direction === 'bottom-to-top')  inFront = seat.yN >= 1 - prog;
    if (colorMode === 'rainbow' && inFront) return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette' && inFront) return paletteSample(effect, seat, timeMs, prog) || colorA;
    return inFront ? colorA : outsideColor(effect, colorB);
  }
  if (effect.type === 'section-flash') {
    const intervalMs  = Math.max(effect.intervalMs || 800, 100);
    const holdMs      = Math.min(Math.max(effect.holdMs || 400, 50), intervalMs);
    const step        = Math.floor(localTimeMs(effect, timeMs) / intervalMs);
    const orderLen    = effect.sectionOrder?.length || 1;
    let activeIndex   = -1;
    if (effect.sectionMode === 'random') {
      activeIndex = Math.floor(stableNoise(effect.seed || 1, step * 0.13) * orderLen);
    } else {
      activeIndex = step % orderLen;
    }
    const inHold    = localTimeMs(effect, timeMs) % intervalMs <= holdMs;
    const seatIndex = sectionIndexFromOrder(effect, seat.section);
    if (!inHold || seatIndex < 0) return outsideColor(effect, colorB);
    const groupSize = Math.max(effect.groupSize || 1, 1);
    const mirror    = (effect.sectionMode || '').includes('mirror');
    let active      = false;
    if (effect.sectionMode === 'random') {
      const indices = randomIndices(groupSize, orderLen, (effect.seed || 1) + step * 13);
      active = indices.has(seatIndex);
      if (mirror && !active) active = indices.has((seatIndex + Math.floor(orderLen / 2)) % orderLen);
    } else {
      for (let offset = 0; offset < groupSize; offset++) {
        const idx = (activeIndex + offset) % orderLen;
        if (seatIndex === idx) { active = true; break; }
        if (mirror && seatIndex === (idx + Math.floor(orderLen / 2)) % orderLen) { active = true; break; }
      }
    }
    if (!active) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') {
      return paletteSample(effect, seat, timeMs, orderLen > 1 ? seatIndex / (orderLen - 1) : 0.5) || colorA;
    }
    return colorA;
  }
  if (effect.type === 'section-cascade') {
    const intervalMs = Math.max(effect.intervalMs || 600, 100);
    const holdMs     = Math.min(Math.max(effect.holdMs || 350, 50), intervalMs);
    const step       = Math.floor(localTimeMs(effect, timeMs) / intervalMs);
    const orderLen   = effect.sectionOrder?.length || 1;
    const inHold     = localTimeMs(effect, timeMs) % intervalMs <= holdMs;
    const seatIndex  = sectionIndexFromOrder(effect, seat.section);
    if (!inHold || seatIndex !== step % orderLen) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') {
      return paletteSample(effect, seat, timeMs, orderLen > 1 ? seatIndex / (orderLen - 1) : 0.5) || colorA;
    }
    return colorA;
  }
  if (effect.type === 'chase') {
    const axis  = effect.axis  || 'x';
    const speed = effect.speed || 0.5;
    const band  = Math.max(effect.band || 0.12, 0.01);
    const pos   = axis === 'y' ? seat.yN : seat.xN;
    const phase = (pos + localT * speed) % 1;
    if (!(phase <= band)) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, phase / band) || colorA;
    return colorA;
  }
  if (effect.type === 'radial') {
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    const centerX = effect.centerX ?? 0.5;
    const centerY = effect.centerY ?? 0.5;
    const speed   = effect.speed   || 0.6;
    const band    = Math.max(effect.band || 0.1, 0.01);
    const dist    = Math.sqrt((seat.xN - centerX) ** 2 + (seat.yN - centerY) ** 2);
    const mix     = clamp(1 - Math.abs(dist - localT * speed) / band, 0, 1);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorB, colorA, mix);
    return mixColors(colorB, colorA, mix);
  }
  if (effect.type === 'pulse') {
    const speed = effect.speed || 1;
    const mix   = (Math.sin(localT * speed * Math.PI * 2) + 1) * 0.5;
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorA, colorB, mix);
    return mixColors(colorA, colorB, mix);
  }
  if (effect.type === 'breathing') {
    const speed = effect.breatheSpeed || 0.25;
    if (colorMode === 'rainbow') return hsvToRgb((localT * speed * 360) % 360, 1, 1);
    const mix = (Math.sin(localT * speed * Math.PI * 2) + 1) * 0.5;
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorA, colorB, mix);
    return mixColors(colorA, colorB, mix);
  }
  if (effect.type === 'strobe') {
    const intervalMs = Math.max(effect.strobeIntervalMs || 200, 50);
    const holdMs     = Math.min(Math.max(effect.strobeHoldMs || 80, 10), intervalMs);
    if (!(localTimeMs(effect, timeMs) % intervalMs <= holdMs)) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, 0.5) || colorA;
    return colorA;
  }
  if (effect.type === 'glitter') {
    const density = clamp(effect.glitterDensity ?? 0.15, 0, 1);
    const speed   = effect.glitterSpeed ?? 1;
    const seed    = seat.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const noise   = stableNoise(seed, localT * speed * 0.35);
    if (!(noise < density)) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, noise) || hexToRgb(effect.color1 || '#ffffff');
    return colorA;
  }
  if (effect.type === 'sparkle-field') {
    const density = clamp(effect.sparkleDensity ?? 0.2, 0, 1);
    const speed   = effect.sparkleSpeed ?? 1.0;
    const seed    = Math.round(seat.xN * 1000 + seat.yN * 10000);
    const noise   = stableNoise(seed, localT * speed * 0.35);
    if (!(noise < density)) return outsideColor(effect, colorB);
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, noise) || hexToRgb(effect.color1 || '#ffffff');
    return colorA;
  }
  if (effect.type === 'heart') {
    if (!heartInside(seat, effect, timeMs)) return outsideColor(effect, colorB);
    const anim = effect.heartAnim || 'static';
    if (anim === 'blink') {
      const intervalMs = Math.max(effect.loopMs || 1000, 200);
      const prog       = (localTimeMs(effect, timeMs) % intervalMs) / intervalMs;
      if (prog > 0.5) return outsideColor(effect, colorB);
      return mixColors(colorB, colorA, clamp(Math.sin(prog * Math.PI * 2) * 2, 0, 1));
    }
    if (anim === 'breathe') {
      const pulse = (Math.sin(localT * (effect.heartBreatheSpeed || 0.4) * Math.PI * 2) + 1) * 0.5;
      if (pulse < 0.25) return outsideColor(effect, colorB);
      return mixColors(colorB, colorA, pulse);
    }
    if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
    if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, 0.5) || colorA;
    return colorA;
  }
  return colorA;
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
// AKTIVE FARBE FINDEN (unverändert)
// =============================================================

function findEffectColor(timeMs) {
  const effects = (state.timeline && state.timeline.effects) || [];
  const active  = effects
    .filter(e => isEffectActive(e, timeMs))
    .filter(e => !e.sections || e.sections.length === 0 || e.sections.includes(state.seat.section))
    .filter(e => seatMatchesMask(e, state.seat));

  active.sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0) || a.startMs - b.startMs);
  for (let i = active.length - 1; i >= 0; i--) {
    const color = resolveSeatColor(active[i], state.seat, timeMs);
    if (color) return color;
  }
  return null;
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
    setStatus(`Show startet in ${remaining}s...`);
    screen.style.backgroundColor = state.background;
    requestAnimationFrame(renderFrame);
    return;
  }

  // Show beendet
  if (timeMs > state.durationMs) {
    state.playing = false;
    document.body.classList.remove('playing');
    setStatus('Show beendet.');
    startBtn.classList.remove('hidden');
    stopSyncPolling();
    return;
  }

  // Normale Wiedergabe
  setStatus('');
  const color = findEffectColor(timeMs);
  screen.style.backgroundColor = color ? rgbToCss(color) : state.background;
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
      // Admin hat noch nicht gestartet
      if (state.playing) {
        // Show lief lokal, wurde aber zurückgesetzt → stoppen
        state.playing    = false;
        state.startEpoch = null;
        state.waitMode   = false;
        document.body.classList.remove('playing');
        setStatus('Show wurde zurückgesetzt. Warte auf neues Signal...');
        startBtn.classList.remove('hidden');
        startBtn.textContent = 'Start';
        startBtn.disabled    = false;
      }
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

  startBtn.classList.add('hidden');

  // Startzeit noch nicht bekannt? → Einmal direkt nachfragen
  if (!state.startEpoch) {
    setStatus('Verbinde...');
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
      setStatus('Die Show ist bereits beendet.');
      startBtn.classList.remove('hidden');
      return;
    }

    if (elapsed > 0) {
      setStatus(`Einsteigen... (Show läuft seit ${Math.round(elapsed / 1000)}s)`);
    }

    beginAnimation();

  } else {
    // ⏳ Fall B: Admin hat noch NICHT gestartet → Wartemodus
    state.waitMode = true;
    setStatus('⏳ Warte auf Start-Signal vom Admin...');
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
        // Show schon vorbei
        if (state.playing) {
          state.playing = false;
          document.body.classList.remove('playing');
          setStatus('Show beendet.');
          startBtn.classList.remove('hidden');
          stopSyncPolling();
        }
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
        state.playing = false;
        document.body.classList.remove('playing');
        setStatus('Show wurde zurückgesetzt.');
        startBtn.classList.remove('hidden');
        startBtn.textContent = 'Start';
        stopSyncPolling();
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
  startBtn.textContent = 'Start';
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
  if (!state.timeline || !state.seatmap || !state.seat) return false;

  runLoader.hidden = true;
  enableStart();

  if (state.startEpoch) {
    const correctedNow = Date.now() + state.clockOffset;
    const elapsed      = correctedNow - state.startEpoch;
    if (elapsed > 0 && elapsed < state.durationMs) {
      setStatus(`Show läuft bereits (${Math.round(elapsed / 1000)}s). Drück Start zum Einsteigen.`);
    } else if (elapsed <= 0) {
      setStatus('Show startet gleich. Drück Start.');
    } else {
      setStatus('Show bereits beendet.');
      startBtn.disabled    = true;
      startBtn.textContent = 'Beendet';
    }
  } else {
    setStatus('Bereit. Warte auf Start-Signal...');
  }
  return true;
}

// =============================================================
// INITIALISIERUNG  ←  ERWEITERT
// =============================================================

async function init() {
  startBtn.disabled    = true;
  startBtn.textContent = 'Lädt...';

  const selection = getSelection();
  if (!selection) {
    setStatus('Kein Sitzplatz ausgewählt. Bitte zuerst Platz wählen.');
    return;
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

  // 3. Timeline und Seatmap laden
  state.timeline = await loadJsonWithFallback([
    '/data/timeline.json', './data/timeline.json', 'data/timeline.json'
  ]);
  state.seatmap = await loadJsonWithFallback([
    '/data/seatmap_mapping.json', './data/seatmap_mapping.json', 'data/seatmap_mapping.json'
  ]);

  if (!state.timeline || !state.seatmap) {
    const missing = [];
    if (!state.timeline) missing.push('timeline.json');
    if (!state.seatmap)  missing.push('seatmap_mapping.json');
    if (loaderStatus) {
      loaderStatus.style.color = '#ff4d6d';
      loaderStatus.textContent = `FEHLER: ${missing.join(' & ')} nicht gefunden.`;
    }
    runLoader.hidden = false;
    setStatus(window.location.protocol === 'file:'
      ? 'Lokal blockiert. Bitte Dateien manuell hochladen.'
      : 'Dateien nicht im "data"-Ordner gefunden.');
    return;
  }

  state.durationMs = Math.max(1000, state.timeline.meta?.durationMs ?? 60000);
  state.background = state.timeline.meta?.backgroundColor || state.background;
  state.seat       = getSeatFromSelection(state.seatmap.seats || [], selection);

  if (!state.seat) {
    setStatus('Sitzplatz nicht gefunden. Bitte nochmal auswählen.');
    return;
  }

  checkReady();
}

// =============================================================
// MANUELLES DATEILADEN (Fallback, unverändert)
// =============================================================

function tryManualLoad() {
  if (!state.timeline || !state.seatmap) return;
  runLoader.hidden = true;
  state.durationMs = Math.max(1000, state.timeline.meta?.durationMs ?? 60000);
  state.background = state.timeline.meta?.backgroundColor || state.background;
  state.seat       = getSeatFromSelection(state.seatmap.seats || [], getSelection());
  if (!state.seat) { setStatus('Sitzplatz nicht gefunden.'); return; }
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
