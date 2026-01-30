import { getBlockProgress } from "./stadium-map.js";

// 1) block/rang holen: URL -> localStorage -> fallback
const params = new URLSearchParams(location.search);
const level = params.get("level") || localStorage.getItem("fp_level") || "lower";
const block = params.get("block") || localStorage.getItem("fp_block") || "117";

// 2) delay berechnen
const sweepDurationMs = 9000;     // wie lange eine Welle einmal ums Stadion braucht (tweakbar)
const upperOffsetMs = 12000;      // Unterrang startet früher, Oberrang kommt später (tweakbar)

const info = getBlockProgress(level, block);
let delayMs = 0;

if (info) delayMs = info.t * sweepDurationMs;
if (level === "upper") delayMs += upperOffsetMs;

// optional debug
if (params.get("debug") === "1") {
  console.log("[FP] level:", level, "block:", block, "info:", info, "delayMs:", delayMs);
}


(() => {
  const startBtn = document.getElementById("startBtn");
  const screen = document.getElementById("screen");

  let audioCtx = null;
  let stream = null;
  let source = null;
  let processor = null;
  let gainZero = null;
  let tempo = null;

  let lastBeatAt = 0;
  const MIN_BEAT_GAP_MS = 180;

  const HOP_SIZE = 512;
  const BUFFER_SIZE = 1024;

  // --- Palettes (ruhig -> später bunt) ---
  const palettes = {
    // Anfang: ein Spektrum (kühl / clean)
    calm: ["#7aa2ff", "#7cffd8", "#a96bff", "#5ef1ff"],

    // Ab 2 Minuten: full chaos (aber hübsch)
    full: ["#7cffd8", "#7aa2ff", "#ff4fd8", "#ffd36e", "#a96bff", "#58ff7a", "#ff6b6b", "#5ef1ff"]
  };

  // --- Timeline / Blocks (zeitbasiert, stabiler als Beat-Count) ---
  // until: Sekunden seit Start
  // colorEvery: nur alle X Beats neue Farbe (langsamer = hochwertiger Look)
  // fadeMs: Übergangsdauer
  // pulseMs/pulseStrength: Beat-Puls
  // sparkleChance: Wahrscheinlichkeit pro Beat, dass ein Phone sparkelt
  const timeline = [
    { until: 30,  palette: "calm", colorEvery: 8,  fadeMs: 1800, pulseMs: 850, pulseStrength: 1.08, sparkleChance: 0.04 },
    { until: 120, palette: "calm", colorEvery: 6,  fadeMs: 1400, pulseMs: 720, pulseStrength: 1.10, sparkleChance: 0.07 },

    // ab 2 Minuten: bunter + etwas lebendiger
    { until: 9999, palette: "full", colorEvery: 4, fadeMs: 950, pulseMs: 520, pulseStrength: 1.13, sparkleChance: 0.13 }
  ];

  let startTime = 0;
  let globalBeat = 0;
  let colorIndex = 0;

  function getStage(elapsedSec) {
    return timeline.find(t => elapsedSec < t.until) || timeline[timeline.length - 1];
  }

  function applyStage(stage) {
    screen.style.setProperty("--fadeMs", stage.fadeMs + "ms");
    screen.style.setProperty("--pulseMs", stage.pulseMs + "ms");
    screen.style.setProperty("--pulseStrength", String(stage.pulseStrength));
  }

  function setColor(hex) {
    screen.style.setProperty("--bgColor", hex);
  }

  function pulse() {
    screen.classList.remove("pulse");
    void screen.offsetHeight;
    screen.classList.add("pulse");
  }

  function sparkle() {
    screen.classList.remove("sparkle");
    void screen.offsetHeight;
    screen.classList.add("sparkle");
  }

  // Pick next color in current palette (in order, nicht random-chaos)
  function nextColor(paletteArr) {
    colorIndex = (colorIndex + 1) % paletteArr.length;
    return paletteArr[colorIndex];
  }

  function onBeat() {
    const now = performance.now();
    if (now - lastBeatAt < MIN_BEAT_GAP_MS) return;
    lastBeatAt = now;

    globalBeat++;

    const elapsedSec = (now - startTime) / 1000;
    const stage = getStage(elapsedSec);
    applyStage(stage);

    // soft pulse on every beat
    pulse();

    // sparkle on some phones sometimes (dezent)
    if (Math.random() < stage.sparkleChance) {
      sparkle();
    }

    // slower color change cadence
    if (globalBeat % stage.colorEvery === 0) {
      const pal = palettes[stage.palette] || palettes.full;
      setColor(nextColor(pal));
    }
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
    } catch {}
  }

  async function enterFullscreen() {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen();
    } catch {}
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
    if (!window.isSecureContext) return;

    startBtn.disabled = true;
    document.body.classList.add("running");
    screen.style.display = "block";

    startTime = performance.now();
    globalBeat = 0;
    colorIndex = 0;

    // initial: calm palette first color
    const first = palettes.calm[0];
    setColor(first);
    applyStage(timeline[0]);

    await enterFullscreen();
    await requestWakeLock();

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
      });
    } catch {
      document.body.classList.remove("running");
      startBtn.disabled = false;
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume().catch(() => {});

    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(HOP_SIZE, 1, 1);

    gainZero = audioCtx.createGain();
    gainZero.gain.value = 0;

    source.connect(processor);
    processor.connect(gainZero);
    gainZero.connect(audioCtx.destination);

    try {
      await initAubio(audioCtx.sampleRate);
    } catch {
      cleanup();
      document.body.classList.remove("running");
      startBtn.disabled = false;
      return;
    }

    startBtn.classList.add("hidden");

    processor.onaudioprocess = (ev) => {
      if (!tempo) return;
      const input = ev.inputBuffer.getChannelData(0);
      const isBeat = tempo.do(input);
      if (isBeat) onBeat();
    };
  }

  startBtn.addEventListener("click", start);
  window.addEventListener("pagehide", cleanup);
})();

