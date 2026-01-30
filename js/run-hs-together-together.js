(() => {
  const screen = document.getElementById("screen");
  const startBtn = document.getElementById("startBtn");
  if (!screen || !startBtn) return;

  // Tuning (kannst du später feinjustieren)
  const MIN_INTERVAL_MS = 160;     // min Abstand zwischen Beat-Hits
  const BEAT_BOOST = 42;           // wie stark Hue bei Beat springt
  const BASE_SPEED = 0.25;         // Grund-Geschwindigkeit für Farbdrift
  const ENERGY_SPEED = 8.0;        // wie stark Audio Energie Speed erhöht
  const SMOOTH = 0.92;             // Glättung für Energy
  const FLUX_SMOOTH = 0.90;        // Glättung für Flux

  let audioCtx, analyser, timeData, freqData, prevFreq;
  let startedAt = 0;
  let lastHit = 0;

  // “immer lebendig”
  let hue = 160; // Startfarbe (passt zu deinem Neon-Vibe)
  let energyAvg = 0;
  let fluxAvg = 0;

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function rmsFromTime(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = (arr[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / arr.length);
  }

  function spectralFlux(cur, prev) {
    let flux = 0;
    for (let i = 0; i < cur.length; i++) {
      const d = cur[i] - prev[i];
      if (d > 0) flux += d;
    }
    return flux / (cur.length * 255); // normalize grob 0..1
  }

  function setColorFromHue(h, energy) {
    // energy 0..~0.2 (typisch) -> wir skalieren “musikalisch”
    const e = clamp(energy * 6, 0, 1);
    const sat = 70 + e * 25;       // 70..95
    const light = 18 + e * 16;     // 18..34
    screen.style.backgroundColor = `hsl(${h} ${sat}% ${light}%)`;

    // sanfter Puls über Helligkeit (nicht nervig)
    const bright = 1 + e * 0.8;    // 1..1.8
    screen.style.filter = `brightness(${bright}) saturate(1.15)`;
  }

  async function start() {
    startBtn.disabled = true;

    try {
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

      timeData = new Uint8Array(analyser.fftSize);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      prevFreq = new Uint8Array(analyser.frequencyBinCount);

      src.connect(analyser);

      document.body.classList.add("running");
      startedAt = performance.now();

      // optional fullscreen
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }

      requestAnimationFrame(loop);
    } catch (e) {
      console.error(e);
      startBtn.disabled = false;
    }
  }

  function loop() {
    if (!analyser) return;

    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);

    const rms = rmsFromTime(timeData);
    energyAvg = energyAvg * SMOOTH + rms * (1 - SMOOTH);

    const flux = spectralFlux(freqData, prevFreq);
    fluxAvg = fluxAvg * FLUX_SMOOTH + flux * (1 - FLUX_SMOOTH);

    prevFreq.set(freqData);

    const now = performance.now();
    const elapsedSec = (now - startedAt) / 1000;

    // 1) Immer-Animation (auch ohne Beat-Erkennung)
    const speed = BASE_SPEED + clamp(energyAvg * ENERGY_SPEED, 0, 6);
    hue = (hue + speed) % 360;

    // 2) Beat-Hit (über Flux)
    const threshold = fluxAvg * 1.6 + 0.012; // wichtiger Part
    const isBeat = flux > threshold && (now - lastHit) > MIN_INTERVAL_MS;

    if (isBeat) {
      lastHit = now;

      // ab ~2 Minuten: bunter (mehr Sprünge)
      const boost = elapsedSec >= 120 ? (BEAT_BOOST * 1.35) : BEAT_BOOST;
      hue = (hue + boost + Math.random() * 18) % 360;

      // kurzer Flash, aber smooth
      screen.style.transition = "background-color 260ms ease, filter 260ms ease";
      setTimeout(() => {
        screen.style.transition = "background-color 420ms ease, filter 520ms ease";
      }, 180);
    }

    // Farbe setzen
    setColorFromHue(hue, energyAvg);

    requestAnimationFrame(loop);
  }

  startBtn.addEventListener("click", start);
})();
