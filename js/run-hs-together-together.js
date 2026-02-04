// ============================================
// Run Page - Beat Reactive Visualizer
// ============================================

(function() {
  'use strict';

  // Get elements
  const startBtn = document.getElementById('startBtn');
  const screen = document.getElementById('screen');
  
  // Get join parameters
  const params = window.FP_JOIN || { level: '', block: '' };
  
  // Color schemes based on beat intensity
  const colorSchemes = {
    low: ['#a78bfa', '#8b5cf6', '#7c3aed'],      // Purple
    medium: ['#ff6b9d', '#f43f5e', '#e11d48'],   // Pink/Red
    high: ['#ffa94d', '#fb923c', '#f97316'],     // Orange
    ultra: ['#fde047', '#facc15', '#eab308']     // Yellow
  };

  // Audio context and analyzer
  let audioContext;
  let analyser;
  let microphone;
  let dataArray;
  let beatDetector;
  let rafId;

  // Beat detection state
  let bassHistory = [];
  const bassHistoryLength = 43;
  let beatThreshold = 1.3;
  let lastBeatTime = 0;
  const beatCooldown = 200; // ms

  // Visual state
  let currentColor = '#a78bfa';
  let targetColor = '#a78bfa';
  let intensity = 0;
  let pulse = 0;

  // Initialize
  async function init() {
    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } 
      });

      // Create audio context
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;

      microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);

      // Setup data array
      const bufferLength = analyser.frequencyBinCount;
      dataArray = new Uint8Array(bufferLength);

      // Start visualization
      visualize();
      
      console.log('🎵 Beat detector initialized');
      console.log(`📍 Level: ${params.level}, Block: ${params.block}`);
      
    } catch (err) {
      console.error('Microphone access denied:', err);
      screen.style.background = 'linear-gradient(135deg, #ff6b9d, #ffa94d)';
      screen.innerHTML = '<div style="color: white; font-size: 2rem; text-align: center; padding: 2rem;">Please enable microphone access to use the beat visualizer</div>';
    }
  }

  // Detect beat from bass frequencies
  function detectBeat() {
    // Get frequency data
    analyser.getByteFrequencyData(dataArray);

    // Focus on bass frequencies (0-200 Hz roughly maps to bins 0-20)
    let bassSum = 0;
    const bassRange = 20;
    
    for (let i = 0; i < bassRange; i++) {
      bassSum += dataArray[i];
    }
    
    const bassAvg = bassSum / bassRange;

    // Add to history
    bassHistory.push(bassAvg);
    if (bassHistory.length > bassHistoryLength) {
      bassHistory.shift();
    }

    // Calculate average of recent history
    const historyAvg = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;

    // Detect beat if current bass is significantly higher than recent average
    const now = Date.now();
    const isBeat = bassAvg > historyAvg * beatThreshold && 
                   (now - lastBeatTime) > beatCooldown;

    if (isBeat) {
      lastBeatTime = now;
      
      // Determine intensity based on how much it exceeds threshold
      const beatStrength = (bassAvg / historyAvg) - 1;
      
      if (beatStrength > 1.2) {
        triggerBeat('ultra', beatStrength);
      } else if (beatStrength > 0.8) {
        triggerBeat('high', beatStrength);
      } else if (beatStrength > 0.4) {
        triggerBeat('medium', beatStrength);
      } else {
        triggerBeat('low', beatStrength);
      }
    }

    // Calculate overall intensity for ambient effects
    const overallSum = dataArray.reduce((a, b) => a + b, 0);
    intensity = Math.min(overallSum / (dataArray.length * 255), 1);

    return isBeat;
  }

  // Trigger beat effect
  function triggerBeat(level, strength) {
    const colors = colorSchemes[level];
    targetColor = colors[Math.floor(Math.random() * colors.length)];
    pulse = Math.min(strength, 2);
    
    console.log(`💥 Beat detected: ${level} (strength: ${strength.toFixed(2)})`);
  }

  // Color interpolation
  function interpolateColor(color1, color2, factor) {
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    
    const r = Math.round(c1.r + (c2.r - c1.r) * factor);
    const g = Math.round(c1.g + (c2.g - c1.g) * factor);
    const b = Math.round(c1.b + (c2.b - c1.b) * factor);
    
    return `rgb(${r}, ${g}, ${b})`;
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  }

  // Main visualization loop
  function visualize() {
    rafId = requestAnimationFrame(visualize);

    // Detect beat
    detectBeat();

    // Smooth color transition
    const colorFactor = 0.1;
    currentColor = interpolateColor(currentColor, targetColor, colorFactor);

    // Decay pulse
    pulse *= 0.85;

    // Calculate scale based on pulse
    const scale = 1 + (pulse * 0.2);

    // Apply visual effects
    const brightness = 0.5 + (intensity * 0.5);
    const blur = pulse * 10;

    screen.style.backgroundColor = currentColor;
    screen.style.transform = `scale(${scale})`;
    screen.style.filter = `brightness(${brightness}) blur(${blur}px)`;
    screen.style.boxShadow = `inset 0 0 ${100 + pulse * 100}px rgba(0, 0, 0, ${0.3 - intensity * 0.2})`;
  }

  // Start button handler
  startBtn.addEventListener('click', async () => {
    startBtn.classList.add('hidden');
    await init();
  });

  // Stop on page unload
  window.addEventListener('beforeunload', () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    if (microphone) {
      microphone.disconnect();
    }
    if (audioContext) {
      audioContext.close();
    }
  });

  // Show block info on screen
  if (params.block) {
    const info = document.createElement('div');
    info.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      z-index: 100;
      backdrop-filter: blur(10px);
      background: rgba(0, 0, 0, 0.3);
      padding: 0.5rem 1rem;
      border-radius: 100px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    info.textContent = `Block ${params.block} • ${params.level}`;
    document.body.appendChild(info);
  }

})();
