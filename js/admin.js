// =============================================================
// js/admin.js
// Logik für die Admin-Seite
// =============================================================

import { fetchSyncState, setStartEpoch, resetShow, measureClockOffset }
  from './sync.js';

// ⚠️ WICHTIG: Ändere diesen PIN bevor du live gehst!
const ADMIN_PIN = '1234';

// DOM-Elemente
const pinSection   = document.getElementById('pinSection');
const pinInput     = document.getElementById('pinInput');
const pinConfirm   = document.getElementById('pinConfirm');
const pinError     = document.getElementById('pinError');
const mainSection  = document.getElementById('mainSection');
const statusBox    = document.getElementById('statusBox');
const btnStart     = document.getElementById('btnStart');
const btnReset     = document.getElementById('btnReset');
const offsetInfo   = document.getElementById('offsetInfo');
const pollInfo     = document.getElementById('pollInfo');

let clockOffset   = 0;      // Unterschied zwischen lokaler und Server-Uhr
let pollInterval  = null;   // Timer für regelmäßige Datenbankabfragen
let isRunning     = false;  // Läuft die Show gerade?
let durationMs    = 60000;  // Wird aus timeline.json geladen
let autoResetDone = false;  // Verhindert mehrfachen Auto-Reset pro Show

// -------------------------------------------------------
// Timeline laden (für durationMs)
// -------------------------------------------------------

async function loadDuration() {
  try {
    const paths = ['/data/timeline.json', './data/timeline.json', 'data/timeline.json'];
    for (const path of paths) {
      const res = await fetch(path);
      if (res.ok) {
        const data = await res.json();
        if (data?.meta?.durationMs) {
          durationMs = data.meta.durationMs;
          console.log('[Admin] Show duration loaded:', durationMs, 'ms');
        }
        return;
      }
    }
  } catch (err) {
    console.warn('[Admin] timeline.json not found – using default 60s:', err.message);
  }
}

// -------------------------------------------------------
// PIN-Prüfung
// -------------------------------------------------------

function checkPin() {
  const entered = pinInput.value.trim();
  if (entered === ADMIN_PIN) {
    pinSection.style.display  = 'none';
    mainSection.style.display = 'flex';
    startAdminSession();
  } else {
    pinError.textContent = 'Wrong PIN. Please try again.';
    pinInput.value = '';
    pinInput.focus();
  }
}

pinConfirm.addEventListener('click', checkPin);
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkPin();
});

// -------------------------------------------------------
// Admin-Session starten
// -------------------------------------------------------

async function startAdminSession() {
  setStatus('⏳ Connecting...', 'waiting');

  await loadDuration();

  clockOffset = await measureClockOffset();
  offsetInfo.textContent = `Server offset: ${clockOffset >= 0 ? '+' : ''}${clockOffset}ms`;

  await poll();

  pollInterval = setInterval(poll, 5000);
  btnStart.disabled = false;
}

// -------------------------------------------------------
// UI in Bereitschaftszustand setzen
// (nach Show-Ende oder manuellem Reset)
// -------------------------------------------------------

function resetAdminUI() {
  isRunning     = false;
  autoResetDone = false;
  setStatus('⏸ Ready – press ▶ to start the show', 'waiting');
  btnStart.textContent = '▶ SHOW STARTEN';
  btnStart.disabled    = false;
}

// -------------------------------------------------------
// Datenbank abfragen und Status anzeigen
// -------------------------------------------------------

async function poll() {
  try {
    const state = await fetchSyncState();
    pollInfo.textContent = `Last check: ${new Date().toLocaleTimeString('de-DE')}`;

    if (state && state.start_epoch !== null && state.start_epoch !== undefined) {
      const correctedNow = Date.now() + clockOffset;
      const elapsedMs    = correctedNow - state.start_epoch;
      const elapsedSec   = (elapsedMs / 1000).toFixed(1);

      // Show ist abgelaufen → automatisch zurücksetzen
      if (elapsedMs > durationMs && !autoResetDone) {
        autoResetDone = true;
        console.log('[Admin] Show finished – auto-reset');
        try {
          await resetShow();
        } catch (err) {
          console.error('[Admin] Auto-reset failed:', err.message);
        }
        resetAdminUI();
        return;
      }

      // Show läuft noch
      isRunning = true;
      const remaining = Math.max(0, Math.round((durationMs - elapsedMs) / 1000));
      setStatus(`🟢 SHOW RUNNING – ${elapsedSec}s elapsed (${remaining}s left)`, 'running');
      btnStart.textContent = '▶ RESTART (Reset + Start)';

    } else {
      // Keine aktive Show
      if (isRunning) {
        // War vorher running → wurde extern resettet
        resetAdminUI();
      } else {
        setStatus('⏸ Ready – press ▶ to start the show', 'waiting');
        btnStart.textContent = '▶ SHOW STARTEN';
      }
      isRunning = false;
    }
  } catch (err) {
    setStatus('⚠️ Connection lost – check WiFi', 'error');
  }
}

// -------------------------------------------------------
// START-Knopf (kein confirm-Dialog – direkt loslegen)
// -------------------------------------------------------

btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  setStatus('⏳ Starting...', 'waiting');
  autoResetDone = false;

  try {
    const startEpoch = Date.now() + clockOffset;
    await setStartEpoch(startEpoch);

    isRunning = true;
    setStatus('🟢 STARTED! All participants are now synced.', 'running');
    btnStart.textContent = '▶ RESTART (Reset + Start)';

    setTimeout(poll, 1500);
  } catch (err) {
    setStatus('❌ Start failed: ' + err.message, 'error');
    console.error(err);
  } finally {
    btnStart.disabled = false;
  }
});

// -------------------------------------------------------
// RESET-Knopf
// -------------------------------------------------------

btnReset.addEventListener('click', async () => {
  if (!confirm('Reset show? All participant animations will stop.')) return;

  try {
    await resetShow();
    resetAdminUI();
  } catch (err) {
    setStatus('❌ Reset failed: ' + err.message, 'error');
  }
});

// -------------------------------------------------------
// Hilfsfunktion: Status-Box aktualisieren
// -------------------------------------------------------

function setStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className   = 'status-box ' + (type || 'waiting');
}
