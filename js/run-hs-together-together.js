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

  // ==== Palette (später easy anpassbar) ====
  const palette = [
    "#7cffd8", "#7aa2ff", "#ff4fd8", "#ffd36e",
    "#a96bff", "#58ff7a", "#ff6b6b", "#5ef1ff"
  ];

  // ==== Scenes (Blocks) ====
  // beats = wie lange der Abschnitt dauert
  // colorEvery = nur alle X Beats neue Farbe (z.B. 8 = sehr langsam)
  // fadeMs = wie weich die Farb-Übergänge sind
  // pulseMs / pulseStrength = wie “hart” der Beat-Puls ist
  const scenes = [
    { name: "Intro", beats: 32, colorEvery: 8, fadeMs: 1400, pulseMs: 900, pulseStrength: 1.08 },
    { name: "Build", beats: 32, colorEvery: 4, fadeMs: 1000, pulseMs: 700, pulseStrength: 1.12 },
    { name: "Main",  beats: 64, colorEvery: 2, fadeMs: 650,  pulseMs: 420, pulseStrength: 1.15 },
    { name: "Outro", beats: 32, colorEvery: 8, fadeMs: 1600, pulseMs: 950, pulseStrength: 1.06 }
  ];

  let sceneIndex = 0;
  let beatInScene = 0;
  let globalBeat = 0;
  let colorIndex = 0;

  const HOP_SIZE = 512;
  const BUFFER_SIZE = 1024;

  function applyScene(scene) {
    screen.style.setProperty("--fadeMs", scene.fadeMs + "ms");
    screen.style.setProperty("--pulseMs", scene.pulseMs + "ms");
    screen.style.setProperty("--pulseStrength", String(scene.pulseStrength));
  }

  function setColor(hex) {
    screen.style.setProperty("--bgColor", hex);
  }

  function pulse() {
    screen.classList.remove("pulse");
    void screen.offsetHeight;
    screen.classList.add("pulse");
  }

  function nextScene() {
    sceneIndex = (sceneIndex + 1) % scenes.length;
    beatInScene = 0;
    applyScene(scenes[sceneIndex]);
  }

  function onBeat() {
    const now = performance.now();
    if (now - lastBeatAt < MIN_BEAT_GAP_MS) return;
    lastBeatAt = now;

    globalBeat++;
    beatInScene++;

    const scene = scenes[sceneIndex];

    // Pulse on EVERY beat (soft)
    pulse();

    // Only change color every N beats (slower, nicer)
    if (globalBeat % scene.colorEvery === 0) {
      colorIndex = (colorIndex + 1) % palette.length;
      setColor(palette[colorIndex]);
    }

    // Move to next scene after X beats
    if (beatInScene >= scene.beats) {
      nextScene();
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

    audioCtx = null;
    stream = null;
    source = null;
    processor = null;
    gainZero = null;
    tempo = null;
  }

  async function start() {
    if (!window.isSecureContext) return;

    startBtn.disabled = true;
    document.body.classList.add("running");
    screen.style.display = "block";

    // init scene + color
    sceneIndex = 0;
    beatInScene = 0;
    globalBeat = 0;
    colorIndex = 0;

    applyScene(scenes[sceneIndex]);
    setColor(palette[colorIndex]);

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
