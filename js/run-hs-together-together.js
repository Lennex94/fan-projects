(() => {
  const screen = document.getElementById("screen");
  const startBtn = document.getElementById("startBtn");

  if (!screen || !startBtn) {
    console.warn("Missing #screen or #startBtn in HTML.");
    return;
  }

  console.log("[run] loaded", window.FP_JOIN || {});

  // --- simple palette logic (block influences palette start) ---
  const blockStr = (window.FP_JOIN?.block || "").toString();
  const blockNum = parseInt(blockStr, 10);
  const seed = Number.isFinite(blockNum) ? blockNum : 0;

  const palettes = [
    ["#00ffd5", "#7aa2ff", "#b57cff", "#ff6bd6"],          // neon cool
    ["#ffd36b", "#ff7a7a", "#ff3df2", "#7cffd8"],          // warm pop
    ["#7cffd8", "#00c2ff", "#5bff7a", "#ffee6b"],          // bright
    ["#7aa2ff", "#b57cff", "#00ffd5", "#ff6b9d"],          // dreamy
  ];
  const palette = palettes[Math.abs(seed) % palettes.length];

  let audioCtx;
  let analyser;
  let data;
  let rafId;

  // Beat detection variables
  let avg = 0;        // smoothed energy avg
  let variance = 0;   // smoothed variance
  let lastBeat = 0;
  let colorIndex = 0;

  // CSS-friendly transitions
  screen.style.transition = "background-color 600ms ease, filter 220ms ease";
  screen.style.backgroundColor = "#000";
  screen.style.filter = "brightness(1)";

  function nextColor() {
    colorIndex = (colorIndex + 1) % palette.length;
    return palette[colorIndex];
  }

  function pulse() {
    screen.style.filter = "brightness(1.35)";
    setTimeout(() => (screen.style.filter = "brightness(1)"), 120);
  }

  function computeRMS(bytes) {
    // time-domain bytes: 0..255, center 128
    let sum = 0;
    for (let i = 0; i < bytes.length; i++) {
      const v = (bytes[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / bytes.length);
  }

  function tick() {
    analyser.getByteTimeDomainData(data);

    const rms = computeRMS(data);

    // exponential smoothing for avg + variance
    const a = 0.05; // smoothing factor
    const diff = rms - avg;
    avg += a * diff;
    variance = (1 - a) * variance + a * diff * diff;

    const std = Math.sqrt(variance);
    const threshold = avg + std * 1.6;

    const now = performance.now();

    // beat gate: min 180ms between beats
    if (rms > threshold && now - lastBeat > 180) {
      lastBeat = now;

      // beat action
      screen.style.backgroundColor = nextColor();
      pulse();
    }

    rafId = requestAnimationFrame(tick);
  }

  async function start() {
    startBtn.disabled = true;
    startBtn.textContent = "Starting…";

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      // iOS/Safari needs explicit resume inside user gesture
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      const source = audioCtx.createMediaStreamSource(stream);

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;

      data = new Uint8Array(analyser.fftSize);

      source.connect(analyser);

      // Visual: hide button, start loop
      startBtn.style.opacity = "0";
      startBtn.style.pointerEvents = "none";

      // Start with a nice first color so you SEE it's alive
      screen.style.backgroundColor = palette[0];

      tick();
    } catch (err) {
      console.error(err);

      // Put button back with a useful message
      startBtn.disabled = false;
      startBtn.textContent = "Allow Microphone";
      startBtn.style.opacity = "1";
      startBtn.style.pointerEvents = "auto";

      // Small visible feedback without extra UI spam:
      screen.style.backgroundColor = "#111";
      screen.style.filter = "brightness(1)";

      // Optional: if you want a hard alert (remove if annoying)
      alert("Microphone blocked or unavailable. Enable mic permission for this site, then try again.");
    }
  }

  startBtn.addEventListener("click", start);

  // cleanup on leave
  window.addEventListener("pagehide", () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (audioCtx && audioCtx.state !== "closed") audioCtx.close().catch(() => {});
  });
})();
