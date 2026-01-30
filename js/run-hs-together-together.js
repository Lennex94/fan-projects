(() => {
  const screen = document.getElementById("screen");
  const startBtn = document.getElementById("startBtn");

  if (!screen || !startBtn) return;

  // Initial state
  screen.setAttribute("aria-hidden", "false");
  screen.style.backgroundColor = "#000";

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // Palette: erst “clean”, nach 2 Minuten bunter
  function pickColor(elapsedSec) {
    const calm = ["#7cffd8", "#7aa2ff", "#b37cff", "#ffffff"];
    const wild = ["#ff3b3b", "#ff9f1a", "#ffe600", "#7cff3b", "#00f5ff", "#7aa2ff", "#b37cff", "#ff4dff"];

    const palette = elapsedSec < 120 ? calm : wild;
    return palette[Math.floor(Math.random() * palette.length)];
  }

  let audioCtx, analyser, data;
  let startedAt = 0;

  // Beat-ish detection via RMS + adaptive threshold (läuft überall, auch mobile)
  let avg = 0;
  let lastHit = 0;

  function rmsFromTimeDomain(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = (arr[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / arr.length);
  }

  function pulse(strength) {
    // brightness pulse instead of instant chaotic flashes
    const b = 1 + clamp(strength * 1.8, 0, 1.2);
    screen.style.filter = `brightness(${b}) saturate(1.1)`;
    clearTimeout(pulse._t);
    pulse._t = setTimeout(() => {
      screen.style.filter = "brightness(1) saturate(1)";
    }, 220);
  }

  async function start() {
    startBtn.disabled = true;

    try {
      // mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      await audioCtx.resume();

      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      data = new Uint8Array(analyser.fftSize);

      src.connect(analyser);

      document.body.classList.add("running");
      startedAt = performance.now();

      // optional fullscreen (nicht überall supported)
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }

      requestAnimationFrame(loop);
    } catch (err) {
      console.error("Mic start failed:", err);
      startBtn.disabled = false;
    }
  }

  function loop(t) {
    if (!analyser) return;

    analyser.getByteTimeDomainData(data);
    const rms = rmsFromTimeDomain(data);

    // smooth moving average
    avg = avg * 0.96 + rms * 0.04;

    // adaptive threshold
    const threshold = avg * 1.45 + 0.008; // tweakable
    const now = performance.now();
    const elapsedSec = (now - startedAt) / 1000;

    // beat hit condition + minimum interval
    if (rms > threshold && (now - lastHit) > 170) {
      lastHit = now;

      // color + softer pulse
      const c = pickColor(elapsedSec);
      screen.style.backgroundColor = c;

      // strength based on "how much above threshold"
      const strength = clamp((rms - threshold) * 10, 0, 1);
      pulse(strength);
    }

    // also keep subtle breathing even without big beats
    const breathe = 0.92 + clamp((avg * 3.2), 0, 0.18);
    screen.style.filter = `brightness(${breathe}) saturate(1.05)`;

    requestAnimationFrame(loop);
  }

  startBtn.addEventListener("click", start);
})();
