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

let clockOffset  = 0;      // Unterschied zwischen lokaler und Server-Uhr
let pollInterval = null;   // Timer für regelmäßige Datenbankabfragen
let isRunning    = false;  // Läuft die Show gerade?

// -------------------------------------------------------
// PIN-Prüfung
// -------------------------------------------------------

function checkPin() {
  const entered = pinInput.value.trim();
  if (entered === ADMIN_PIN) {
    pinSection.style.display = 'none';
    mainSection.style.display = 'flex';
    startAdminSession();
  } else {
    pinError.textContent = 'Falscher PIN. Bitte nochmal versuchen.';
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
  setStatus('⏳ Messe Server-Zeit...', 'waiting');

  // Clock-Offset messen (Uhren-Abgleich)
  clockOffset = await measureClockOffset();
  offsetInfo.textContent = `Server-Offset: ${clockOffset >= 0 ? '+' : ''}${clockOffset}ms`;

  // Ersten Status laden
  await poll();

  // Alle 5 Sekunden automatisch aktualisieren
  pollInterval = setInterval(poll, 5000);

  btnStart.disabled = false;
}

// -------------------------------------------------------
// Datenbank abfragen und Status anzeigen
// -------------------------------------------------------

async function poll() {
  try {
    const state = await fetchSyncState();
    pollInfo.textContent = `Check: ${new Date().toLocaleTimeString('de-DE')}`;

    if (state && state.start_epoch !== null && state.start_epoch !== undefined) {
      // Show läuft
      const correctedNow = Date.now() + clockOffset;
      const elapsedMs = correctedNow - state.start_epoch;
      const elapsedSec = (elapsedMs / 1000).toFixed(1);
      const totalSec = Math.round(state.start_epoch / 1000);

      isRunning = true;
      setStatus(`🟢 SHOW LÄUFT – ${elapsedSec}s vergangen`, 'running');
      btnStart.textContent = '▶ NOCHMAL STARTEN (Reset + Start)';
    } else {
      // Show noch nicht gestartet
      isRunning = false;
      setStatus('⏸ Wartet auf Start', 'waiting');
      btnStart.textContent = '▶ SHOW STARTEN';
    }
  } catch (err) {
    setStatus('⚠️ Verbindung verloren – prüfe WLAN', 'error');
  }
}

// -------------------------------------------------------
// START-Knopf
// -------------------------------------------------------

btnStart.addEventListener('click', async () => {
  if (!confirm('Show jetzt starten? Diese Aktion syncronisiert alle Teilnehmer.')) return;

  btnStart.disabled = true;
  setStatus('⏳ Starte...', 'waiting');

  try {
    // Aktuelle (korrigierte) Zeit als Startzeit setzen
    const startEpoch = Date.now() + clockOffset;
    await setStartEpoch(startEpoch);

    setStatus('🟢 GESTARTET! Alle Teilnehmer werden jetzt synchronisiert.', 'running');
    isRunning = true;

    // Status nach kurzer Pause aktualisieren
    setTimeout(poll, 1500);
  } catch (err) {
    setStatus('❌ Fehler beim Starten: ' + err.message, 'error');
    console.error(err);
  } finally {
    btnStart.disabled = false;
  }
});

// -------------------------------------------------------
// RESET-Knopf
// -------------------------------------------------------

btnReset.addEventListener('click', async () => {
  if (!confirm('Show wirklich zurücksetzen? Alle Teilnehmer-Animationen stoppen.')) return;

  try {
    await resetShow();
    isRunning = false;
    setStatus('⏸ Zurückgesetzt – bereit für neuen Start', 'waiting');
    btnStart.textContent = '▶ SHOW STARTEN';
  } catch (err) {
    setStatus('❌ Fehler beim Zurücksetzen: ' + err.message, 'error');
  }
});

// -------------------------------------------------------
// Hilfsfunktion: Status-Box aktualisieren
// -------------------------------------------------------

function setStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = 'status-box ' + (type || 'waiting');
}
