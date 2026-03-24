// =============================================================
// js/sync.js
// Verbindung zur Supabase-Datenbank für die Show-Synchronisation
// =============================================================

const SUPABASE_URL = 'https://gbbxjjhsdvqcgbeammcr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U_Oki3osdN3PZC0fzopyLg_r-B1IxtA';
const SYNC_ID = 'hs_together';

/**
 * Liest den aktuellen Show-Status aus der Datenbank.
 * Gibt null zurück, wenn die Show noch nicht gestartet ist.
 * Gibt ein Objekt { start_epoch: 1234567890 } zurück wenn gestartet.
 */
export async function fetchSyncState() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/show_sync?id=eq.${SYNC_ID}&select=start_epoch`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Accept: 'application/json'
        }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] || null;
  } catch {
    return null;
  }
}

/**
 * Setzt die Startzeit in der Datenbank.
 * epochMs = Unix-Zeitstempel in Millisekunden (z.B. 1714500000000)
 * Nur der Admin ruft diese Funktion auf.
 */
export async function setStartEpoch(epochMs) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/show_sync?id=eq.${SYNC_ID}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ start_epoch: epochMs })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Datenbankfehler: ' + text);
  }
}

/**
 * Setzt die Startzeit zurück auf NULL (Show-Reset).
 */
export async function resetShow() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/show_sync?id=eq.${SYNC_ID}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ start_epoch: null })
    }
  );
  if (!res.ok) throw new Error('Reset fehlgeschlagen');
}

/**
 * Misst den Unterschied zwischen der lokalen Uhr und der Server-Uhr.
 * Smartphones können manchmal bis zu mehreren Sekunden falsch gehen.
 * Dieser Offset wird bei der Zeitberechnung dazugerechnet.
 * Gibt 0 zurück, wenn die Messung fehlschlägt.
 */
export async function measureClockOffset() {
  try {
    const t0 = Date.now();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/show_sync?id=eq.${SYNC_ID}&select=id`,
      { headers: { apikey: SUPABASE_KEY } }
    );
    const t1 = Date.now();
    const serverDateStr = res.headers.get('date');
    if (!serverDateStr) return 0;
    const serverTime = new Date(serverDateStr).getTime();
    const roundTrip = t1 - t0;
    // Schätzt die Server-Zeit zur Hälfte der Übertragungszeit
    const offset = serverTime - (t0 + Math.round(roundTrip / 2));
    console.log(`[Sync] Clock-Offset gemessen: ${offset}ms`);
    return offset;
  } catch {
    console.warn('[Sync] Clock-Offset-Messung fehlgeschlagen, nehme 0');
    return 0;
  }
}
