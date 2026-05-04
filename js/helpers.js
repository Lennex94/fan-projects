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
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
            ${v.can_print ? `<span style="font-size:0.75rem;color:#6ee7ff;" title="Can print">🖨</span>` : ''}
          </div>
          ${v.show_name_public && v.socials
            ? `<div style="font-size:0.78rem;color:rgba(255,255,255,0.4);">${escapeHtml(v.socials)}</div>`
            : ''}
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('blockPopupOverlay').style.display = 'flex';
}

// ── Build the chip grid ────────────────────────────────────
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

      // Number / label
      const numEl = document.createElement('div');
      numEl.className = 'chip-number';
      numEl.textContent = block;
      chip.appendChild(numEl);

      if (isTaken) {
        // Name: first name of first public volunteer, + count if more
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

        // Printer icon badge
        if (vols.some((v) => v.can_print)) {
          const printBadge = document.createElement('div');
          printBadge.className = 'chip-print-badge';
          printBadge.textContent = '🖨';
          chip.appendChild(printBadge);
        }

        // Cyan dot
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

// ── Pre-fill form ──────────────────────────────────────────
function prefillBlock(block, isGA) {
  const input = document.getElementById('blockOrGaInput');
  const areaSelect = document.querySelector('select[name="area_type"]');
  const hint = document.getElementById('prefillHint');

  if (input) { input.value = block; input.dispatchEvent(new Event('input')); }
  if (areaSelect) { areaSelect.value = isGA ? 'standing' : 'seated'; areaSelect.dispatchEvent(new Event('change')); }
  if (hint) { hint.textContent = `Signing up for: ${isGA ? '' : 'Block '}${block}`; hint.classList.add('visible'); }

  const formCard = document.getElementById('formCard');
  if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  showAllSteps();
}

function showAllSteps() {
  const form = document.getElementById('helperForm');
  if (!form) return;
  form.querySelectorAll('[data-step]').forEach((el) => (el.style.display = ''));
}

// ── Step flow ──────────────────────────────────────────────
function initStepFlow() {
  const form = document.getElementById('helperForm');
  if (!form) return;

  const steps = Array.from(form.querySelectorAll('[data-step]'))
    .sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));

  steps.forEach((el, i) => { if (i > 0) el.style.display = 'none'; });

  steps.forEach((step, i) => {
    const input = step.querySelector('input, select, textarea');
    if (!input) return;
    const advance = () => {
      if (!String(input.value || '').trim()) return;
      if (steps[i + 1]) steps[i + 1].style.display = '';
    };
    input.addEventListener('change', advance);
    input.addEventListener('input', advance);
  });

  const socialSelect = form.querySelector('select[name="social_platform"]');
  const socialsInput = form.querySelector('input[name="socials"]');
  if (socialSelect && socialsInput) {
    socialSelect.addEventListener('change', () => {
      const map = { instagram:'@username', tiktok:'@username', whatsapp:'+31 6 12345678', email:'name@email.com', x:'@username', other:'Your contact' };
      socialsInput.placeholder = map[socialSelect.value] || 'Your contact';
    });
  }
}

// ── Status ─────────────────────────────────────────────────
const statusEl = document.getElementById('helperFormStatus');
function setStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#ff7a59' : 'rgba(249,247,243,0.72)';
}

// ── Form submit ────────────────────────────────────────────
const form = document.getElementById('helperForm');
if (form) {
  initStepFlow();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const platform = String(data.get('social_platform') || '').trim();
    const handle   = String(data.get('socials') || '').trim();

    const payload = {
      attending:        data.get('attending') === 'yes',
      wants_help:       data.get('wants_help') === 'yes',
      name:             String(data.get('name') || '').trim(),
      area_type:        data.get('area_type'),
      block_or_ga:      String(data.get('block_or_ga') || '').trim(),
      can_print:        data.get('can_print') === 'yes',
      extra_blocks:     String(data.get('extra_blocks') || '').trim(),
      socials:          platform ? `${platform}: ${handle}` : handle,
      show_name_public: data.get('show_name_public') === 'yes',
    };

    if (!payload.name || !payload.block_or_ga || !payload.socials) {
      setStatus('Please fill out your name, block/GA area, and socials.', true);
      return;
    }

    setStatus('Submitting…');
    try {
      await submitHelper(payload);
      setStatus('Thanks! Your response has been saved. 💜');
      form.reset();
      initStepFlow();
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
