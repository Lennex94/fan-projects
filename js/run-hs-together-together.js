(() => {
  const screen = document.getElementById("screen");
  const startBtn = document.getElementById("startBtn");
  if (!screen || !startBtn) return;

  // --------- BLOCK / LEVEL (for wave delay) ----------
  const params = new URLSearchParams(location.search);
  const level = (params.get("level") || "").toLowerCase(); // "upper" | "lower"
  const blockRaw = params.get("block") || "";

  const UPPER_CLOCKWISE = [
    "417","418","419","420","421","422","423","424",
    "425","426","427","428","429","430","401",
    "402","403","404","405","406","407","408","409",
    "410","411","412","413","414","415","416",
  ];

  const LOWER_CLOCKWISE = [
    "117","118","119","120","121","122","123","124",
    "125","126","127","128","129",
    "101","102","103","104","105","106","107","108","109","110","111",
    "112","113","114","115","116",
  ];

  function normalizeBlock(v) {
    const raw = String(v || "").trim();
    const digits = raw.replace(/\D+/g, "");
    if (!digits) return "";
    return digits.padStart(3, "0");
  }

  function getDelayMs(level, block) {
    const b = normalizeBlock(block);
    const list = level === "upper" ? UPPER_CLOCKWISE : level === "lower" ? LOWER_CLOCKWISE : null;
    if (!list) return 0;

    const idx = list.indexOf(b);
    if (idx === -1) return 0;

    const t = list.length <= 1 ? 0 : idx / (list.length - 1);

    const sweepDurationMs = 9000;   // 1x ums Stadion
    const upperOffsetMs   = 12000;  // Unterrang startet früher

    let d = t * sweepDurationMs;
    if (level === "upper") d += upperOffsetMs;
    return Math.max(0, Math.round(d));
  }

  const delayMs = getDelayMs(level, blockRaw);

  // --------- COLORS (bright + not "muddy") ----------
  // (Die sind absichtlich hell, keine "HSL-Depression")
  const calm = ["#7cffd8", "#7aa2ff", "#b57cff", "#5ef1ff"];
  const full = ["#7cffd8","#7aa2ff","#ff4fd8","#ffd36e","#a96bff","#58ff7a","#ff6b6b","#5ef1ff"];

  let colorIndex = 0;
  function pickPalette(elapsedSec) {
    return elapsedSec >= 120 ? full : calm;
  }
  function nextColor(pal) {
    colorIndex = (colorIndex + 1) % pal.length;
    return pal[colorIndex];
  }

  // --------- AUDIO / BEAT ----------
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
  const MIN_BEAT_GAP_MS = 170;

  // fallback energy peak helps a TON in messy stadium audio
  let rmsAvg = 0;

  function rms(input) {
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    return Math.sqrt(sum / input.length);
  }

  function beatEffect() {
    const now = performance.now();
    if (now - lastBeatAt < MIN_BEAT_GAP_MS) return;
    lastBeatAt = now;

    const elapsedSec = (now - startedAt) / 1000;
    const pal = pickPalette(elapsedSec);

    // color change (not too fast)
    const c = nextColor(pal);
    screen.style.backgroundColor = c;

    // punchy but not strobe
    screen.style.filter = "brightness(1.25) saturate(1.15)";
    clearTimeout(beatEffect._t);
    beatEffect._t = setTimeout(() => {
      screen.style.filter = "brightness(1) saturate(1)";
    }, 140);
  }

  function scheduleBeat() {
    // block wave: same beat, but delayed per block
    if (delayMs > 0) setTimeout(beatEffect, delayMs);
    else beatEffect();
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

    // show "life" instantly
    document.body.classList.add("running");
    screen.style.backgroundColor = calm[0];
    screen.style.filter = "brightness(1) saturate(1)";

    startedAt = performance.now();
    colorIndex = 0;

    // full screen (optional)
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

    // some browsers want an output connected
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

      // 1) aubio beat
      const isBeat = tempo.do(input);

      // 2) fallback peak detect (helps a lot if aubio misses)
      const r = rms(input);
      rmsAvg = rmsAvg * 0.94 + r * 0.06;
      const peak = r > (rmsAvg * 1.75 + 0.01);

      if (isBeat || peak) scheduleBeat();
    };
  }

  startBtn.addEventListener("click", start);
  window.addEventListener("pagehide", cleanup);
})();
