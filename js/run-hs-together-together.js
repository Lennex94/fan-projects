// Live beat tracking using aubiojs (WASM)
// Source usage pattern: <script src="https://unpkg.com/aubiojs"></script> then aubio().then(...) :contentReference[oaicite:1]{index=1}

(() => {
  const $ = (id) => document.getElementById(id);

  const startBtn = $("startBtn");
  const stopBtn = $("stopBtn");
  const statusEl = $("status");
  const bpmEl = $("bpm");
  const beatsEl = $("beats");
  const pulseEl = $("pulse");

  let audioCtx = null;
  let stream = null;
  let source = null;
  let processor = null;
  let gainZero = null;

  let tempo = null; // aubio Tempo instance
  let beatCount = 0;
  let lastBeatAt = 0;

  // Settings (tweakable)
  const HOP_SIZE = 512;      // samples per callback chunk
  const BUFFER_SIZE = 1024;  // internal buffer window
  const MIN_BEAT_GAP_MS = 180; // avoid double triggers

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function flashBeat() {
    // quick visual pulse
    pulseEl.classList.remove("is-beat");
    // force reflow
    void pulseEl.offsetHeight;
    pulseEl.classList.add("is-beat");
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        await navigator.wakeLock.request("screen");
      }
    } catch {
      // ignore: not supported / blocked
    }
  }

  async function initAubio(sampleRate) {
    if (typeof window.aubio !== "function") {
      throw new Error("aubiojs not loaded");
    }

    const mod = await window.aubio();
    if (!mod || !mod.Tempo) throw new Error("Tempo not available in aubiojs");

    // aubio tempo detector
    tempo = new mod.Tempo(BUFFER_SIZE, HOP_SIZE, sampleRate);
  }

  function stopAll() {
    try { if (processor) processor.disconnect(); } catch {}
    try { if (source) source.disconnect(); } catch {}
    try { if (gainZero) gainZero.disconnect(); } catch {}

    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    if (audioCtx) {
      audioCtx.close().catch(() => {});
    }

    audioCtx = null;
    stream = null;
    source = null;
    processor = null;
    gainZero = null;
    tempo = null;

    beatCount = 0;
    beatsEl.textContent = "0";
    bpmEl.textContent = "–";
    setStatus("Idle");

    stopBtn.disabled = true;
    startBtn.disabled = false;
  }

  async function start() {
    if (!window.isSecureContext) {
      setStatus("Error: needs HTTPS");
      return;
    }

    startBtn.disabled = true;
    setStatus("Requesting microphone…");

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
    } catch (e) {
      setStatus("Mic denied / not available");
      startBtn.disabled = false;
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume().catch(() => {});

    source = audioCtx.createMediaStreamSource(stream);

    // ScriptProcessorNode is deprecated but widely supported and fine for a first prototype
    processor = audioCtx.createScriptProcessor(HOP_SIZE, 1, 1);

    // Some browsers require the node to be connected to destination
    gainZero = audioCtx.createGain();
    gainZero.gain.value = 0;

    source.connect(processor);
    processor.connect(gainZero);
    gainZero.connect(audioCtx.destination);

    setStatus("Loading beat engine…");

    try {
      await initAubio(audioCtx.sampleRate);
    } catch (e) {
      setStatus("Beat engine failed to load");
      startBtn.disabled = false;
      return;
    }

    setStatus("Listening… (play music near your phone)");
    stopBtn.disabled = false;

    await requestWakeLock();

    processor.onaudioprocess = (ev) => {
      if (!tempo) return;

      const input = ev.inputBuffer.getChannelData(0);
      // aubio expects Float32Array-like
      const isBeat = tempo.do(input); // typically truthy on beat

      // bpm updates
      const bpm = tempo.getBpm ? tempo.getBpm() : 0;
      if (bpm && bpm > 0 && bpm < 260) bpmEl.textContent = Math.round(bpm).toString();

      const now = performance.now();
      if (isBeat && (now - lastBeatAt) > MIN_BEAT_GAP_MS) {
        lastBeatAt = now;
        beatCount += 1;
        beatsEl.textContent = String(beatCount);
        flashBeat();
      }
    };
  }

  // events
  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", stopAll);

  // safety cleanup
  window.addEventListener("pagehide", stopAll);
})();
