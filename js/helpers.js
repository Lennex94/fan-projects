/* ============================================================
   helpers.js — Volunteer form + live block overview
   ============================================================ */

const SUPABASE_URL = 'https://gbbxjjhsdvqcgbeammcr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U_Oki3osdN3PZC0fzopyLg_r-B1IxtA';
const TABLE = 'helpers_intake';

const UPPER_TIER = Array.from({ length: 30 }, (_, i) => String(401 + i));
const LOWER_TIER = Array.from({ length: 29 }, (_, i) => String(101 + i));
const STANDING = ['FRONT GA LEFT','FRONT GA RIGHT','CIRCLE','KISS','SQUARE','DISCO','REAR GA'];

// ── Supabase ───────────────────────────────────────────────
async function fetchVolunteers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?select=block_or_ga,name,show_name_public,can_print,socials`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) throw new Error('Could not load volunteers');
  return res.json();
}

async function submitHelper(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || 'Failed to submit');
}

function normalise(str) {
  return String(str || '').trim().toUpperCase().replace(/^BLOCK\s*/i, '');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Hide anything that looks like a phone number
function formatSocial(str) {
  if (!str) return '';
  // If it contains 5+ consecutive digits → treat as phone number
  if (/\d{5,}/.test(str)) return '📱 Private contact';
  return escapeHtml(str);
}

// ── Detail popup ───────────────────────────────────────────
function ensureOverlay() {
  if (document.getElementById('blockPopupOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'blockPopupOverlay';
  overlay.style.cssText = [
    'display:none','position:fixed','inset:0','z-index:9999',
    'background:rgba(0,0,0,0.75)','backdrop-filter:blur(5px)',
    'align-items:center','justify-content:center','padding:20px',
  ].join(';');
  overlay.innerHTML = '<div id="blockPopupBox" style="' + [
    'background:#111','border:1px solid rgba(168,85,247,0.4)',
    'border-radius:16px','padding:24px 24px 20px','max-width:360px',
    'width:100%','font-family:var(--font-body,sans-serif)',
    'color:#fff','position:relative','max-height:80vh','overflow-y:auto',
  ].join(';') + '"></div>';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(); });
  document.body.appendChild(overlay);
}

function closePopup() {
  const o = document.getElementById('blockPopupOverlay');
  if (o) o.style.display = 'none';
}

function showBlockDetail(block, vols, isGA) {
  ensureOverlay();
  const box = document.getElementById('blockPopupBox');
  const canPrintAny = vols.some((v) => v.can_print);

  box.innerHTML = `
    <button onclick="closePopup()" style="position:absolute;top:14px;right:14px;
      background:none;border:none;color:rgba(255,255,255,0.35);font-size:1.1rem;cursor:pointer;">✕</button>
    <div style="font-size:0.68rem;letter-spacing:.1em;color:rgba(255,255,255,0.35);text-transform:uppercase;margin-bottom:2px;">
      ${isGA ? 'Standing / GA' : 'Block'}
    </div>
    <div style="font-size:1.5rem;font-weight:700;color:#c084fc;margin-bottom:6px;">${escapeHtml(block)}</div>
    <div style="font-size:0.8rem;color:rgba(255,255,255,0.4);margin-bottom:18px;">
      ${vols.length} helper${vols.length !== 1 ? 's' : ''}
      ${canPrintAny ? ' &nbsp;·&nbsp; <span style="color:#6ee7ff;">🖨 Can print</span>' : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${vols.map((v) => `
        <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:10px 14px;">
          <div style="font-size:0.9rem;font-weight:600;margin-bottom:2px;display:flex;align-items:center;gap:8px;">
            ${v.show_name_public && v.name
              ? `<span>${escapeHtml(v.name)}</span>`
              : `<span style="color:rgba(255,255,255,0.3);font-style:italic;font-weight:400;">Anonymous</span>`}
            ${v.can_print ? `<span style="font-size:0.75rem;color:#6ee7ff;">🖨</span>` : ''}
          </div>
          ${v.show_name_public && v.socials
            ? `<div style="font-size:0.78rem;color:rgba(255,255,255,0.4);">${formatSocial(v.socials)}</div>`
            : ''}
        </div>
      `).join('')}
    </div>`;

  document.getElementById('blockPopupOverlay').style.display = 'flex';
}

// ── Build chip grid ────────────────────────────────────────
function buildOverview(volunteers) {
  const takenMap = {};
  for (const v of volunteers) {
    const key = normalise(v.block_or_ga);
    if (!key) continue;
    if (!takenMap[key]) takenMap[key] = [];
    takenMap[key].push(v);
  }

  const container = document.getElementById('overviewContainer');
  if (!container) return;
  container.innerHTML = '';

  const renderTier = (label, blocks, isGA = false) => {
    const tierLabel = document.createElement('div');
    tierLabel.className = 'overview-tier-label';
    tierLabel.textContent = label;
    container.appendChild(tierLabel);

    const grid = document.createElement('div');
    grid.className = 'block-grid';

    for (const block of blocks) {
      const key = normalise(block);
      const vols = takenMap[key] || [];
      const isTaken = vols.length > 0;

      const chip = document.createElement('div');
      chip.className = `block-chip${isGA ? ' ga-chip' : ''} ${isTaken ? 'taken' : 'open'}`;
      chip.style.cursor = 'pointer';

      const numEl = document.createElement('div');
      numEl.className = 'chip-number';
      numEl.textContent = block;
      chip.appendChild(numEl);

      if (isTaken) {
        const publicVols = vols.filter((v) => v.show_name_public && v.name);
        const nameEl = document.createElement('div');
        nameEl.className = 'chip-name';
        if (publicVols.length > 0) {
          const firstName = publicVols[0].name.split(/[\s,+&]/)[0].trim();
          nameEl.textContent = vols.length > 1 ? `${firstName} +${vols.length - 1}` : firstName;
        } else {
          nameEl.textContent = vols.length > 1 ? `${vols.length}×` : '✓';
        }
        chip.appendChild(nameEl);

        if (vols.some((v) => v.can_print)) {
          const printBadge = document.createElement('div');
          printBadge.className = 'chip-print-badge';
          printBadge.textContent = '🖨';
          chip.appendChild(printBadge);
        }

        const dot = document.createElement('div');
        dot.className = 'chip-badge';
        chip.appendChild(dot);

        chip.addEventListener('click', () => showBlockDetail(block, vols, isGA));
      } else {
        const freeEl = document.createElement('div');
        freeEl.className = 'chip-name';
        freeEl.textContent = 'OPEN';
        chip.appendChild(freeEl);
        chip.addEventListener('click', () => prefillBlock(block, isGA));
      }

      grid.appendChild(chip);
    }
    container.appendChild(grid);
  };

  renderTier('Upper Tier — Seated', UPPER_TIER);
  renderTier('Lower Tier — Seated', LOWER_TIER);
  renderTier('Standing / GA', STANDING, true);

  const legend = document.getElementById('overviewLegend');
  if (legend) legend.style.display = 'flex';
}

// ── Pre-fill from chip ────────────────────────────────────
function prefillBlock(block, isGA) {
  const input = document.getElementById('blockOrGaInput');
  const hint  = document.getElementById('prefillHint');

  if (input) input.value = block;
  if (hint)  { hint.textContent = `Signing up for: ${isGA ? '' : 'Block '}${block}`; hint.classList.add('visible'); }

  const formCard = document.getElementById('formCard');
  if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Status ─────────────────────────────────────────────────
function setStatus(msg, isError = false) {
  const el = document.getElementById('helperFormStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ff7a59' : 'rgba(249,247,243,0.72)';
}

// ── Form submit ────────────────────────────────────────────
const form = document.getElementById('helperForm');
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);

    const name      = String(data.get('name') || '').trim();
    const blockOrGa = String(data.get('block_or_ga') || '').trim();
    const canPrint  = data.get('can_print') === 'yes';
    const socials   = String(data.get('socials') || '').trim();

    if (!name || !blockOrGa) {
      setStatus('Please fill in your name and block / GA area.', true);
      return;
    }

    // Infer area_type from block value
    const isNumeric = /^\d+$/.test(blockOrGa);
    const areaType  = isNumeric ? 'seated' : 'standing';

    const payload = {
      attending:        true,
      wants_help:       true,
      name,
      area_type:        areaType,
      block_or_ga:      blockOrGa,
      can_print:        canPrint,
      extra_blocks:     '',
      socials:          socials || '',
      show_name_public: true,
    };

    setStatus('Submitting…');
    try {
      await submitHelper(payload);
      setStatus('You\'re in! See you at the show. 💜');
      form.reset();
      const hint = document.getElementById('prefillHint');
      if (hint) hint.classList.remove('visible');
      setTimeout(() => loadOverview(), 800);
    } catch (err) {
      console.error(err);
      setStatus('Something went wrong. Please try again.', true);
    }
  });
}

// ── Init ───────────────────────────────────────────────────
async function loadOverview() {
  try {
    buildOverview(await fetchVolunteers());
  } catch (err) {
    const el = document.getElementById('overviewLoading');
    if (el) el.textContent = 'Could not load current overview.';
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadOverview();
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
