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
    const res = await fetch('/api/sync', {
      headers: { Accept: 'application/json' }
    });
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
 * Sendet einen "Ich bin noch hier"-Ping an die participants-Tabelle.
 * Wird alle 3 Minuten von der Run-Seite aufgerufen.
 */
export async function sendHeartbeat() {
  try {
    let deviceId = localStorage.getItem('fanproject_device_id');
    if (!deviceId) {
      deviceId = crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('fanproject_device_id', deviceId);
    }
    await fetch(`${SUPABASE_URL}/rest/v1/participants`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ id: deviceId, project: SYNC_ID, last_seen: new Date().toISOString() })
    });
  } catch {
    // Non-critical, silent fail
  }
}

/**
 * Liest die Anzahl aktiver Teilnehmer der letzten 5 Minuten.
 * Nur für die Admin-Seite.
 */
export async function fetchParticipantCount() {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/participants?project=eq.${SYNC_ID}&last_seen=gte.${fiveMinutesAgo}&select=id`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Prefer: 'count=exact',
          Range: '0-0'
        }
      }
    );
    const range = res.headers.get('Content-Range');
    if (!range) return null;
    const total = range.split('/')[1];
    return total === '*' ? 0 : parseInt(total, 10);
  } catch {
    return null;
  }
}

/**
 * Liest den Show-Status direkt aus Supabase (kein Cloudflare-Cache).
 * Nur für die Admin-Seite gedacht, die immer frische Daten braucht.
 */
export async function fetchSyncStateDirect() {
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
