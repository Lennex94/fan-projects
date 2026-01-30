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

  // Farbe-Palette (kannst du später anpassen)
  const palette = [
    "#7cffd8", // mint neon
    "#7aa2ff", // soft blue
    "#ff4fd8", // pink
    "#ffd36e", // warm gold
    "#a96bff", // purple
    "#58ff7a", // green
    "#ff6b6b", // red-ish
    "#5ef1ff"  // cyan
  ];
  let colorIndex = 0;

  const HOP_SIZE = 512;
  const BUFFER_SIZE = 1024;

  function setColor(hex) {
    // Smooth transition is done in CSS
    screen.style.backgroundColor = hex;
  }

  function beatTick() {
    const now = performance.now();
    if (now - lastBeatAt < MIN_BEAT_GAP_MS) return;
    lastBeatAt = now;

    colorIndex = (colorIndex + 1) % palette.length;
    setColor(palette[colorIndex]);

    // optional “pulse”: short brightness bump, not strobe
    screen.classList.remove("pulse");
    void screen.offsetHeight;
    screen.classList.add("pulse");
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
    } catch {}
  }

  async function enterFullscreen() {
    // Fullscreen only works from a user gesture, so do it right after Start click
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
    if (!window.isSecureContext) {
      // HTTPS required for mic
      return;
    }

    startBtn.disabled = true;

    // Make sure color screen is visible immediately
    document.body.classList.add("running");
    screen.style.display = "block";

    // start with the first color
    setColor(palette[colorIndex]);

    await enterFullscreen();
    await requestWakeLock();

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
    } catch {
      // Permission denied or not available
      document.body.classList.remove("running");
      startBtn.disabled = false;
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume().catch(() => {});

    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(HOP_SIZE, 1, 1);

    // connect to destination with zero gain (some browsers need it)
    gainZero = audioCtx.createGain();
    gainZero.gain.value = 0;

    source.connect(processor);
    processor.connect(gainZero);
    gainZero.connect(audioCtx.destination);

    // load aubio tempo detector
    try {
      await initAubio(audioCtx.sampleRate);
    } catch {
      cleanup();
      document.body.classList.remove("running");
      startBtn.disabled = false;
      return;
    }

    // After we’re live, hide start button completely
    startBtn.classList.add("hidden");

    processor.onaudioprocess = (ev) => {
      if (!tempo) return;
      const input = ev.inputBuffer.getChannelData(0);

      // aubio beat detection
      const isBeat = tempo.do(input);
      if (isBeat) beatTick();
    };
  }

  startBtn.addEventListener("click", start);

  // Cleanup on navigation
  window.addEventListener("pagehide", cleanup);
})();
