(() => {
  const screen = document.getElementById("screen");
  const startBtn = document.getElementById("startBtn");
  if (!screen || !startBtn) return;

  // ---------- TIMING / LOOK ----------
  const SWITCH_EVERY_BEATS_CALM = 4; // im Intro nur alle 4 Beats Farbe ändern
  const SWITCH_EVERY_BEATS_FULL = 2; // später lebendiger
  const MIN_BEAT_GAP_MS = 170;

  // sanfter Pulse statt Strobo
  const PULSE_BRIGHTNESS = 1.14;  // kleiner = softer
  const PULSE_MS = 240;          // länger = weicher (keine 80ms Pop-Flashes)
  const SATURATE = 1.08;         // leicht, nicht “neon overload”

  // ---------- PALETTES ----------
  // Calm: nur ein Spektrum (cyan/blue/purple vibe), nichts wildes
  const PALETTE_CALM = [
    "#6fe7ff", // soft cyan
    "#7aa2ff", // blue
    "#9a86ff", // violet
    "#61ffd8", // mint-cyan (passt zu deinem accent)
  ];

  // Full: ab 2 Minuten darf’s bunt werden
  const PALETTE_FULL = [
    "#7cffd8", "#7aa2ff", "#ff4fd8", "#ffd36e",
    "#a96bff", "#58ff7a", "#ff6b6b", "#5ef1ff"
  ];

  // ---------- AUDIO (aubio Tempo) ----------
  let audioCtx = null;
  let stream = null;
  let source = null;
  let processor = null;
  let gainZero = null;
  let tempo = null;

  const HOP_SIZE = 512;
  const BUFFER_SIZE = 1024;

  let startedAt = 0;
  let lastBeatAt = 0;
  let beatCount = 0;

  let colorIndex = 0;

  function pickPalette(elapsedSec) {
    return elapsedSec >= 120 ? PALETTE_FULL : PALETTE_CALM; // ab 2 Minuten bunt
  }

  function switchEvery(elapsedSec) {
    return elapsedSec >= 120 ? SWITCH_EVERY_BEATS_FULL : SWITCH_EVERY_BEATS_CALM;
  }

  function nextColor(pal) {
    colorIndex = (colorIndex + 1) % pal.length;
    return pal[colorIndex];
  }

  // Smooth pulse: brightness bump that eases out (no strobe)
  function softPulse() {
    screen.style.filter = `brightness(${PULSE_BRIGHTNESS}) saturate(${SATURATE})`;
    clearTimeout(softPulse._t);
    softPulse._t = setTimeout(() => {
      screen.style.filter = `brightness(1) saturate(${SATURATE})`;
    }, PULSE_MS);
  }

  function applyBeat() {
    const now = performance.now();
    if (now - lastBeatAt < MIN_BEAT_GAP_MS) return;
    lastBeatAt = now;

    const elapsedSec = (now - startedAt) / 1000;
    beatCount++;

    // ALWAYS pulse on beat (soft)
    softPulse();

    // Change color only every N beats (keeps it elegant)
    const every = switchEvery(elapsedSec);
    if (beatCount % every !== 0) return;

    const pal = pickPalette(elapsedSec);
    const c = nextColor(pal);

    // long-ish fade looks premium
    screen.style.backgroundColor = c;
  }

  async function initAubio(sampleRate) {
    const mod = await window.aubio();
    tempo = new mod.Tempo(BUFFER_SIZE, HOP_SIZE, sampleRate);
  }

  function cleanup() {
    try { if (processor) processor.disconnect(); } catch {}
    try { if (source) source.disconnect(); } catch {}
    try { if (gainZero) gainZero.disconnect(); } catch {}
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (audioCtx) audioCtx.close().catch(() => {});
    audioCtx = null; stream = null; source = null; processor = null; gainZero = null; tempo = null;
  }

  async function start() {
    startBtn.disabled = true;

    document.body.classList.add("running");

    // start in calm palette, first color visible instantly
    startedAt = performance.now();
    beatCount = 0;
    colorIndex = 0;

    screen.style.transition = "background-color 1200ms ease, filter 260ms ease";
    screen.style.backgroundColor = PALETTE_CALM[0];
    screen.style.filter = `brightness(1) saturate(${SATURATE})`;

    // fullscreen optional
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false },
        video: false
      });
    } catch (e) {
      console.error("Mic blocked:", e);
      startBtn.disabled = false;
      document.body.classList.remove("running");
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume().catch(() => {});

    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(HOP_SIZE, 1, 1);

    // some browsers need output connected
    gainZero = audioCtx.createGain();
    gainZero.gain.value = 0;

    source.connect(processor);
    processor.connect(gainZero);
    gainZero.connect(audioCtx.destination);

    try {
      await initAubio(audioCtx.sampleRate);
    } catch (e) {
      console.error("aubio init failed:", e);
      cleanup();
      return;
    }

    processor.onaudioprocess = (ev) => {
      if (!tempo) return;
      const input = ev.inputBuffer.getChannelData(0);
      const isBeat = tempo.do(input);
      if (isBeat) applyBeat();
    };
  }

  startBtn.addEventListener("click", start);
  window.addEventListener("pagehide", cleanup);
})();
