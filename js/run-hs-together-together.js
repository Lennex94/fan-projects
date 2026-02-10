(function() {
  'use strict';

  const startBtn = document.getElementById('startBtn');
  const screen = document.getElementById('screen');
  const runStatus = document.getElementById('runStatus');
  const runLoader = document.getElementById('runLoader');
  const loaderStatus = document.getElementById('loaderStatus');
  const timelineFile = document.getElementById('timelineFile');
  const seatmapFile = document.getElementById('seatmapFile');

  const state = {
    timeline: null,
    seatmap: null,
    seat: null,
    startTime: 0,
    playing: false,
    durationMs: 60000,
    background: '#05060b'
  };

  function setStatus(message) {
    if (!runStatus) return;
    runStatus.textContent = message || '';
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function hexToRgb(hex) {
    const cleaned = hex.replace('#', '').trim();
    if (cleaned.length === 3) {
      const r = parseInt(cleaned[0] + cleaned[0], 16);
      const g = parseInt(cleaned[1] + cleaned[1], 16);
      const b = parseInt(cleaned[2] + cleaned[2], 16);
      return [r, g, b];
    }
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return [r, g, b];
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
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
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
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;
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
    const colorA = hexToRgb(palette[idx]);
    const colorB = hexToRgb(palette[Math.min(idx + 1, palette.length - 1)]);
    return mixColors(colorA, colorB, frac);
  }

  function rainbowColor(effect, seat, timeMs) {
    const axis = effect.axis || 'x';
    const speed = effect.speed || 0.4;
    const pos = axis === 'y' ? seat.yN : seat.xN;
    const hue = (pos * 360 + (timeMs / 1000) * speed * 360) % 360;
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
      const cycle = (timeMs / 1000) * speed;
      return samplePalette(palette, cycle % 1);
    }
    if (mode === 'spatial') {
      const spatialT = (seat.xN * 0.6 + seat.yN * 0.4) % 1;
      return samplePalette(palette, spatialT);
    }
    return samplePalette(palette, clamp(t ?? 0, 0, 1));
  }

  function randomIndices(count, total, seed) {
    const chosen = new Set();
    let value = seed || 1;
    while (chosen.size < count && chosen.size < total) {
      value = (value * 1664525 + 1013904223) % 4294967296;
      const idx = Math.floor((value / 4294967296) * total);
      chosen.add(idx);
    }
    return chosen;
  }

  function heartInside(seat, effect, timeMs) {
    const size = effect.heartSize ?? 0.18;
    const thickness = effect.heartThickness ?? 0.02;
    const mode = effect.heartMode || 'blink';
    let cx = effect.heartCenterX ?? 0.5;
    let cy = effect.heartCenterY ?? 0.5;

    if (mode === 'fly') {
      const speed = effect.heartSpeed ?? 0.3;
      const loopMs = effect.loopMs && effect.loopMs > 0 ? effect.loopMs : effect.durationMs;
      const t = clamp((localTimeMs(effect, timeMs) / 1000 * speed * 1000) / Math.max(loopMs, 1), 0, 1);
      const sx = effect.heartStartX ?? 0.3;
      const sy = effect.heartStartY ?? 0.2;
      const ex = effect.heartEndX ?? 0.7;
      const ey = effect.heartEndY ?? 0.7;
      cx = sx + (ex - sx) * t;
      cy = sy + (ey - sy) * t;
    }

    const x = (seat.xN - cx) / Math.max(size, 0.01);
    const y = (seat.yN - cy) / Math.max(size, 0.01);
    const rotation = (effect.heartRotation || 0) * (Math.PI / 180);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    const yy = -ry;
    const value = Math.pow(rx * rx + yy * yy - 1, 3) - rx * rx * Math.pow(yy, 3);
    if (thickness > 0) {
      return Math.abs(value) <= thickness;
    }
    return value <= 0.05;
  }

  function isEffectActive(effect, timeMs) {
    return timeMs >= effect.startMs && timeMs <= effect.startMs + effect.durationMs;
  }

  function effectProgress(effect, timeMs) {
    return clamp((timeMs - effect.startMs) / Math.max(effect.durationMs, 1), 0, 1);
  }

  function resolveSeatColor(effect, seat, timeMs) {
    const colorA = hexToRgb(effect.color1 || '#ffffff');
    const colorB = hexToRgb(effect.color2 || '#000000');
    const localT = localTimeMs(effect, timeMs) / 1000;
    const palette = effect.palette || [];
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
      if (mode === 'out') t = 1 - prog;
      if (mode === 'in-out') t = Math.sin(prog * Math.PI);
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, t) || mixColors(colorB, colorA, t);
      return mixColors(colorB, colorA, t);
    }

    if (effect.type === 'wave') {
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      const axis = effect.axis || 'x';
      const period = Math.max(effect.period || 0.25, 0.01);
      const speed = effect.speed || 0.4;
      const pos = axis === 'y' ? seat.yN : seat.xN;
      const phase = (pos / period + localT * speed) * Math.PI * 2;
      const mix = (Math.sin(phase) + 1) * 0.5;
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorA, colorB, mix);
      return mixColors(colorA, colorB, mix);
    }

    if (effect.type === 'gradient') {
      const axis = effect.axis || 'x';
      const pos = axis === 'y' ? seat.yN : seat.xN;
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, pos) || mixColors(colorA, colorB, pos);
      return mixColors(colorA, colorB, pos);
    }

    if (effect.type === 'split-sweep') {
      const loopMs = effect.loopMs && effect.loopMs > 0 ? effect.loopMs : effect.durationMs;
      const prog = clamp(localTimeMs(effect, timeMs) / Math.max(loopMs, 1), 0, 1);
      const dir = effect.splitDirection || 'edges-to-center';
      const dist = Math.abs(seat.xN - 0.5);
      const threshold = 0.5 - prog * 0.5;
      const active = dir === 'edges-to-center' ? dist >= threshold : dist <= prog * 0.5;
      if (!active) return outsideColor(effect, colorB);
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, prog) || colorA;
      return colorA;
    }

    if (effect.type === 'ripple') {
      const centerX = effect.centerX ?? 0.5;
      const centerY = effect.centerY ?? 0.5;
      const speed = effect.speed || 0.6;
      const spacing = Math.max(effect.rippleSpacing || 0.2, 0.05);
      const band = Math.max(effect.band || 0.12, 0.01);
      const dx = seat.xN - centerX;
      const dy = seat.yN - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const phase = (dist / spacing - localT * speed) % 1;
      const ring = phase < band;
      if (!ring) return outsideColor(effect, colorB);
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, phase / band) || colorA;
      return colorA;
    }

    if (effect.type === 'radial-fill') {
      const centerX = effect.centerX ?? 0.5;
      const centerY = effect.centerY ?? 0.5;
      const maxRadius = Math.max(
        Math.hypot(centerX, centerY),
        Math.hypot(1 - centerX, centerY),
        Math.hypot(centerX, 1 - centerY),
        Math.hypot(1 - centerX, 1 - centerY)
      );
      const loopMs = effect.loopMs && effect.loopMs > 0 ? effect.loopMs : effect.durationMs;
      const fillBase = clamp(localTimeMs(effect, timeMs) / Math.max(loopMs, 1), 0, 1);
      const direction = effect.fillDirection || 'outward';
      const fill = direction === 'inward' ? fillBase : fillBase;
      const dx = seat.xN - centerX;
      const dy = seat.yN - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const edge = direction === 'inward'
        ? dist >= maxRadius * (1 - fill)
        : dist <= maxRadius * fill;
      if (colorMode === 'rainbow') return edge ? rainbowColor(effect, seat, timeMs) : outsideColor(effect, colorB);
      if (colorMode === 'palette') return edge ? samplePalette(palette, fill) || colorA : outsideColor(effect, colorB);
      return edge ? colorA : outsideColor(effect, colorB);
    }

    if (effect.type === 'wipe') {
      const direction = effect.direction || 'left-to-right';
      const prog = effectProgress(effect, timeMs);
      const x = seat.xN;
      const y = seat.yN;
      let inFront = false;
      if (direction === 'left-to-right') inFront = x <= prog;
      if (direction === 'right-to-left') inFront = x >= 1 - prog;
      if (direction === 'top-to-bottom') inFront = y <= prog;
      if (direction === 'bottom-to-top') inFront = y >= 1 - prog;
      if (colorMode === 'rainbow' && inFront) return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette' && inFront) return paletteSample(effect, seat, timeMs, prog) || colorA;
      return inFront ? colorA : outsideColor(effect, colorB);
    }

    if (effect.type === 'section-flash') {
      const intervalMs = Math.max(effect.intervalMs || 800, 100);
      const holdMs = Math.min(Math.max(effect.holdMs || 400, 50), intervalMs);
      const step = Math.floor(localTimeMs(effect, timeMs) / intervalMs);
      let activeIndex = -1;
      if (effect.sectionMode === 'random') {
        const seed = effect.seed || 1;
        const noise = stableNoise(seed, step * 0.13);
        activeIndex = Math.floor(noise * (effect.sectionOrder?.length || 0));
      } else {
        activeIndex = step % (effect.sectionOrder?.length || 1);
      }
      const inHold = localTimeMs(effect, timeMs) % intervalMs <= holdMs;
      const seatIndex = sectionIndexFromOrder(effect, seat.section);
      if (!inHold || seatIndex < 0) return outsideColor(effect, colorB);
      const groupSize = Math.max(effect.groupSize || 1, 1);
      const orderLen = effect.sectionOrder?.length || 1;
      const mirror = (effect.sectionMode || '').includes('mirror');
      let active = false;
      if (effect.sectionMode === 'random') {
        const seed = (effect.seed || 1) + step * 13;
        const indices = randomIndices(groupSize, orderLen, seed);
        if (indices.has(seatIndex)) active = true;
        if (mirror && !active) {
          const mirrorIdx = (seatIndex + Math.floor(orderLen / 2)) % orderLen;
          if (indices.has(mirrorIdx)) active = true;
        }
      } else {
        for (let offset = 0; offset < groupSize; offset += 1) {
          const idx = (activeIndex + offset) % orderLen;
          if (seatIndex === idx) {
            active = true;
            break;
          }
          if (mirror) {
            const mirrorIdx = (idx + Math.floor(orderLen / 2)) % orderLen;
            if (seatIndex === mirrorIdx) {
              active = true;
              break;
            }
          }
        }
      }
      if (!active) return outsideColor(effect, colorB);
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') {
        const t = orderLen > 1 ? seatIndex / (orderLen - 1) : 0.5;
        return paletteSample(effect, seat, timeMs, t) || colorA;
      }
      return colorA;
    }

    if (effect.type === 'section-cascade') {
      const intervalMs = Math.max(effect.intervalMs || 600, 100);
      const holdMs = Math.min(Math.max(effect.holdMs || 350, 50), intervalMs);
      const step = Math.floor(localTimeMs(effect, timeMs) / intervalMs);
      const orderLen = effect.sectionOrder?.length || 1;
      const activeIndex = step % orderLen;
      const inHold = localTimeMs(effect, timeMs) % intervalMs <= holdMs;
      const seatIndex = sectionIndexFromOrder(effect, seat.section);
      if (!inHold || seatIndex !== activeIndex) return outsideColor(effect, colorB);
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') {
        const t = orderLen > 1 ? seatIndex / (orderLen - 1) : 0.5;
        return paletteSample(effect, seat, timeMs, t) || colorA;
      }
      return colorA;
    }

    if (effect.type === 'chase') {
      const axis = effect.axis || 'x';
      const speed = effect.speed || 0.5;
      const band = Math.max(effect.band || 0.12, 0.01);
      const pos = axis === 'y' ? seat.yN : seat.xN;
      const phase = (pos + localT * speed) % 1;
      const inBand = phase <= band;
      if (!inBand) return outsideColor(effect, colorB);
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, phase / band) || colorA;
      return colorA;
    }

    if (effect.type === 'radial') {
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      const centerX = effect.centerX ?? 0.5;
      const centerY = effect.centerY ?? 0.5;
      const speed = effect.speed || 0.6;
      const band = Math.max(effect.band || 0.1, 0.01);
      const dx = seat.xN - centerX;
      const dy = seat.yN - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = localT * speed;
      const edge = Math.abs(dist - radius);
      const mix = clamp(1 - edge / band, 0, 1);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorB, colorA, mix);
      return mixColors(colorB, colorA, mix);
    }

    if (effect.type === 'pulse') {
      const speed = effect.speed || 1;
      const mix = (Math.sin(localT * speed * Math.PI * 2) + 1) * 0.5;
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorA, colorB, mix);
      return mixColors(colorA, colorB, mix);
    }

    if (effect.type === 'breathing') {
      const speed = effect.breatheSpeed || 0.25;
      const hue = (localT * speed * 360) % 360;
      if (colorMode === 'rainbow') return hsvToRgb(hue, 1, 1);
      const mix = (Math.sin(localT * speed * Math.PI * 2) + 1) * 0.5;
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, mix) || mixColors(colorA, colorB, mix);
      return mixColors(colorA, colorB, mix);
    }

    if (effect.type === 'strobe') {
      const intervalMs = Math.max(effect.strobeIntervalMs || 200, 50);
      const holdMs = Math.min(Math.max(effect.strobeHoldMs || 80, 10), intervalMs);
      const active = localTimeMs(effect, timeMs) % intervalMs <= holdMs;
      if (!active) return outsideColor(effect, colorB);
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, 0.5) || colorA;
      return colorA;
    }

    if (effect.type === 'glitter') {
      const density = clamp(effect.glitterDensity ?? 0.15, 0, 1);
      const speed = effect.glitterSpeed ?? 1;
      const seed = seat.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const noise = stableNoise(seed, localT * speed * 0.35);
      if (noise < density) {
        if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
        if (colorMode === 'palette') {
          return paletteSample(effect, seat, timeMs, noise) || hexToRgb(effect.color1 || '#ffffff');
        }
        return colorA;
      }
      return outsideColor(effect, colorB);
    }

    if (effect.type === 'sparkle-field') {
      const density = clamp(effect.sparkleDensity ?? 0.2, 0, 1);
      const speed = effect.sparkleSpeed ?? 1.0;
      const seed = Math.round(seat.xN * 1000 + seat.yN * 10000);
      const noise = stableNoise(seed, localT * speed * 0.35);
      if (noise < density) {
        if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
        if (colorMode === 'palette') {
          return paletteSample(effect, seat, timeMs, noise) || hexToRgb(effect.color1 || '#ffffff');
        }
        return colorA;
      }
      return outsideColor(effect, colorB);
    }

    if (effect.type === 'heart') {
      const inside = heartInside(seat, effect, timeMs);
      if (!inside) return outsideColor(effect, colorB);
      const anim = effect.heartAnim || 'static';
      if (anim === 'blink') {
        const intervalMs = Math.max(effect.loopMs || 1000, 200);
        const prog = (localTimeMs(effect, timeMs) % intervalMs) / intervalMs;
        if (prog > 0.5) return outsideColor(effect, colorB);
        const intensity = Math.sin(prog * Math.PI * 2); 
        return mixColors(colorB, colorA, clamp(intensity * 2, 0, 1));
      }
      if (anim === 'breathe') {
        const speed = effect.heartBreatheSpeed || 0.4;
        const pulse = (Math.sin(localT * speed * Math.PI * 2) + 1) * 0.5;
        if (pulse < 0.25) return outsideColor(effect, colorB);
        return mixColors(colorB, colorA, pulse);
      }
      if (colorMode === 'rainbow') return rainbowColor(effect, seat, timeMs);
      if (colorMode === 'palette') return paletteSample(effect, seat, timeMs, 0.5) || colorA;
      return colorA;
    }

    return colorA;
  }

  function getSeatFromSelection(seats, selection) {
    if (!selection || !selection.block) return null;
    if (selection.tier === 'standing') {
      const standingSeats = seats.filter(seat => seat.section === selection.block);
      if (!standingSeats.length) return null;
      const stored = localStorage.getItem('standingSeatId');
      if (stored) {
        const match = standingSeats.find(seat => seat.id === stored);
        if (match) return match;
      }
      const randomSeat = standingSeats[Math.floor(Math.random() * standingSeats.length)];
      localStorage.setItem('standingSeatId', randomSeat.id);
      return randomSeat;
    }
    return seats.find(seat =>
      String(seat.section) === String(selection.block) &&
      String(seat.row) === String(selection.row) &&
      String(seat.seat) === String(selection.seat)
    );
  }

  function getSelection() {
    const raw = localStorage.getItem('hs_together_seat');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function findEffectColor(timeMs) {
    const effects = (state.timeline && state.timeline.effects) || [];
    const active = effects
      .filter(effect => isEffectActive(effect, timeMs))
      .filter(effect => !effect.sections || effect.sections.length === 0 || effect.sections.includes(state.seat.section))
      .filter(effect => seatMatchesMask(effect, state.seat));

    active.sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0) || a.startMs - b.startMs);

    for (let i = active.length - 1; i >= 0; i -= 1) {
      const color = resolveSeatColor(active[i], state.seat, timeMs);
      if (color) return color;
    }
    return null;
  }

  function renderFrame() {
    if (!state.playing) return;
    const now = performance.now();
    const timeMs = now - state.startTime;
    if (timeMs > state.durationMs) {
      state.playing = false;
      document.body.classList.remove('playing');
      setStatus('Show beendet.');
      startBtn.classList.remove('hidden');
      return;
    }

    const color = findEffectColor(timeMs);
    if (color) {
      screen.style.backgroundColor = rgbToCss(color);
      screen.style.opacity = "1";
    } else {
      // If no effect color, show the defined background color from timeline
      screen.style.backgroundColor = state.background;
      screen.style.opacity = "1";
    }

    requestAnimationFrame(renderFrame);
  }

  function startShow() {
    if (!state.seat || !state.timeline) return;
    
    document.body.classList.add('playing');
    
    // Request fullscreen on start for a better experience
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    }

    state.startTime = performance.now();
    state.playing = true;
    setStatus('');
    renderFrame();
  }

  function enableStart() {
    startBtn.disabled = false;
    startBtn.textContent = 'Start';
  }

  async function loadJsonWithFallback(paths, key) {
    for (const path of paths) {
      try {
        console.log(`Versuche zu laden: ${path}`);
        
        // Construct URL
        let url = path;
        if (window.location.hostname.includes('github')) {
          url = `${path}?t=${Date.now()}`;
        }
        
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          console.log(`Erfolgreich geladen: ${path}`);
          return data;
        } else {
          console.warn(`Fetch für ${path} ergab Status: ${res.status}`);
        }
      } catch (err) {
        console.error(`Fehler beim Laden von ${path}:`, err);
      }
    }
    
    return null;
  }

  function checkReady() {
    if (state.timeline && state.seatmap && state.seat) {
      runLoader.hidden = true;
      enableStart();
      setStatus('Bereit. Drücke Start, sobald der Song beginnt.');
      return true;
    }
    return false;
  }

  async function init() {
    startBtn.disabled = true;
    startBtn.textContent = 'Lädt...';

    const selection = getSelection();
    if (!selection) {
      setStatus('Kein Sitzplatz ausgewählt. Bitte wähle zuerst einen Platz aus.');
      return;
    }

    // Build a list of possible paths
    const possibleTimelinePaths = [
      '/data/timeline.json',
      './data/timeline.json',
      'data/timeline.json'
    ];

    const possibleSeatmapPaths = [
      '/data/seatmap_mapping.json',
      './data/seatmap_mapping.json',
      'data/seatmap_mapping.json'
    ];

    console.log("Starting automatic file discovery...");
    state.timeline = await loadJsonWithFallback(possibleTimelinePaths, 'timeline');
    state.seatmap = await loadJsonWithFallback(possibleSeatmapPaths, 'seatmap');

    console.log('Timeline loaded:', !!state.timeline);
    console.log('Seatmap loaded:', !!state.seatmap);
    console.log('Selection:', selection);

    if (!state.timeline || !state.seatmap) {
      const missing = [];
      if (!state.timeline) missing.push('timeline.json');
      if (!state.seatmap) missing.push('seatmap_mapping.json');

      console.error('Auto-load failed for:', missing);

      // Update UI with specific failure info
      if (loaderStatus) {
        loaderStatus.style.color = "#ff4d6d";
        loaderStatus.textContent = `FEHLER: ${missing.join(' & ')} nicht gefunden.`;
      }

      runLoader.hidden = false;
      setStatus(window.location.protocol === 'file:'
        ? 'Lokal blockiert. Bitte Dateien manuell wählen.'
        : 'Dateien im "data" Ordner nicht gefunden.');
      return;
    }

    state.durationMs = Math.max(1000, state.timeline.meta?.durationMs ?? 60000);
    state.background = state.timeline.meta?.backgroundColor || state.background;
    state.seat = getSeatFromSelection(state.seatmap.seats || [], selection);

    console.log('Seat found:', !!state.seat);
    if (state.seat) {
      console.log('Seat details:', state.seat);
    } else {
      console.error('Seat not found! Selection:', selection);
      console.log('Available seats sample:', state.seatmap.seats?.slice(0, 3));
    }

    if (!state.seat) {
      setStatus('Sitzplatz nicht gefunden. Bitte wähle deinen Sitzplatz erneut aus.');
      return;
    }

    console.log('Ready to start!');
    checkReady();
  }

  function tryManualLoad() {
    if (!state.timeline || !state.seatmap) return;
    runLoader.hidden = true;
    state.durationMs = Math.max(1000, state.timeline.meta?.durationMs ?? 60000);
    state.background = state.timeline.meta?.backgroundColor || state.background;
    const selection = getSelection();
    state.seat = getSeatFromSelection(state.seatmap.seats || [], selection);
    if (!state.seat) {
      setStatus('Sitzplatz nicht gefunden. Bitte wähle deinen Sitzplatz erneut aus.');
      return;
    }
    checkReady();
  }

  if (timelineFile) {
    timelineFile.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          state.timeline = JSON.parse(reader.result);
          if (loaderStatus) loaderStatus.textContent = 'timeline.json geladen.';
          tryManualLoad();
        } catch {
          alert('timeline.json konnte nicht gelesen werden.');
        }
      };
      reader.readAsText(file);
    });
  }

  if (seatmapFile) {
    seatmapFile.addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          state.seatmap = JSON.parse(reader.result);
          if (loaderStatus) loaderStatus.textContent = 'seatmap_mapping.json geladen.';
          tryManualLoad();
        } catch {
          alert('seatmap_mapping.json konnte nicht gelesen werden.');
        }
      };
      reader.readAsText(file);
    });
  }

  startBtn.addEventListener('click', () => {
    if (!state.playing) {
      startBtn.classList.add('hidden');
      startShow();
    }
  });

  init();
})();
