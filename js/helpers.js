/* ============================================================
   helpers.js — Volunteer form + live block overview
   ============================================================ */

const SUPABASE_URL = 'https://gbbxjjhsdvqcgbeammcr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U_Oki3osdN3PZC0fzopyLg_r-B1IxtA';
const TABLE = 'helpers_intake';

// ── Arena structure ────────────────────────────────────────
const UPPER_TIER = Array.from({ length: 30 }, (_, i) => String(401 + i));
const LOWER_TIER = Array.from({ length: 29 }, (_, i) => String(101 + i));
const STANDING = [
  'FRONT GA LEFT',
  'FRONT GA RIGHT',
  'CIRCLE',
  'KISS',
  'SQUARE',
  'DISCO',
  'REAR GA',
];

// ── Supabase helpers ───────────────────────────────────────
async function fetchVolunteers() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?select=block_or_ga,name,show_name_public`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to submit');
  }
}

// ── Normalise block identifier for matching ────────────────
function normalise(str) {
  return String(str || '')
    .trim()
    .toUpperCase()
    .replace(/^BLOCK\s*/i, '');
}

// ── Build the overview ─────────────────────────────────────
function buildOverview(volunteers) {
  // Build a map: normalised block → array of public names
  const takenMap = {};
  for (const v of volunteers) {
    const key = normalise(v.block_or_ga);
    if (!key) continue;
    if (!takenMap[key]) takenMap[key] = [];
    if (v.show_name_public && v.name) takenMap[key].push(v.name);
    else if (!v.show_name_public) takenMap[key].push(null); // taken but anonymous
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
      const names = takenMap[key] || null;
      const isTaken = names !== null && names.length > 0;

      const chip = document.createElement('div');
      chip.className = `block-chip${isGA ? ' ga-chip' : ''} ${isTaken ? 'taken' : 'open'}`;

      const numEl = document.createElement('div');
      numEl.className = 'chip-number';
      numEl.textContent = block;
      chip.appendChild(numEl);

      if (isTaken) {
        // Show first public name, truncated
        const publicName = names.find(Boolean);
        if (publicName) {
          const nameEl = document.createElement('div');
          nameEl.className = 'chip-name';
          nameEl.textContent = publicName.split(' ')[0]; // first name only
          chip.appendChild(nameEl);
        } else {
          const takenEl = document.createElement('div');
          takenEl.className = 'chip-name';
          takenEl.textContent = '✓';
          chip.appendChild(takenEl);
        }
        // Badge dot
        const badge = document.createElement('div');
        badge.className = 'chip-badge';
        chip.appendChild(badge);
      } else {
        const freeEl = document.createElement('div');
        freeEl.className = 'chip-name';
        freeEl.textContent = 'OPEN';
        chip.appendChild(freeEl);

        // Clicking an open block pre-fills the form
        chip.addEventListener('click', () => prefillBlock(block, isGA));
      }

      grid.appendChild(chip);
    }

    container.appendChild(grid);
  };

  renderTier('Upper Tier — Seated', UPPER_TIER);
  renderTier('Lower Tier — Seated', LOWER_TIER);
  renderTier('Standing / GA', STANDING, true);

  // Show legend
  const legend = document.getElementById('overviewLegend');
  if (legend) legend.style.display = 'flex';
}

// ── Pre-fill form from block chip click ───────────────────
function prefillBlock(block, isGA) {
  const input = document.getElementById('blockOrGaInput');
  const areaSelect = document.querySelector('select[name="area_type"]');
  const hint = document.getElementById('prefillHint');

  if (input) {
    input.value = isGA ? block : block;
    input.dispatchEvent(new Event('input'));
  }

  if (areaSelect) {
    areaSelect.value = isGA ? 'standing' : 'seated';
    areaSelect.dispatchEvent(new Event('change'));
  }

  if (hint) {
    hint.textContent = `Signing up for: ${isGA ? '' : 'Block '}${block}`;
    hint.classList.add('visible');
  }

  // Scroll to form and show all steps
  const formCard = document.getElementById('formCard');
  if (formCard) {
    formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Make all form steps visible so the user can fill them in
  showAllSteps();
}

function showAllSteps() {
  const form = document.getElementById('helperForm');
  if (!form) return;
  form.querySelectorAll('[data-step]').forEach((el) => {
    el.style.display = '';
  });
}

// ── Step-by-step form flow ─────────────────────────────────
function initStepFlow() {
  const form = document.getElementById('helperForm');
  if (!form) return;

  const steps = Array.from(form.querySelectorAll('[data-step]'))
    .sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));

  // Hide everything after step 1 initially
  steps.forEach((el, index) => {
    if (index > 0) el.style.display = 'none';
  });

  const showStep = (idx) => {
    if (steps[idx]) steps[idx].style.display = '';
  };

  const advanceIfReady = (currentIndex) => {
    const current = steps[currentIndex];
    if (!current) return;
    const input = current.querySelector('input, select, textarea');
    if (!input) return;
    const value = String(input.value || '').trim();
    if (!value) return;
    showStep(currentIndex + 1);
  };

  steps.forEach((step, index) => {
    const input = step.querySelector('input, select, textarea');
    if (!input) return;
    input.addEventListener('change', () => advanceIfReady(index));
    input.addEventListener('input', () => advanceIfReady(index));
  });

  // Social platform → placeholder
  const socialSelect = form.querySelector('select[name="social_platform"]');
  const socialsInput = form.querySelector('input[name="socials"]');
  if (socialSelect && socialsInput) {
    socialSelect.addEventListener('change', () => {
      const map = {
        instagram: '@username',
        tiktok: '@username',
        whatsapp: '+31 6 12345678',
        email: 'name@email.com',
        x: '@username',
        other: 'Your contact',
      };
      socialsInput.placeholder = map[socialSelect.value] || 'Your contact';
    });
  }
}

// ── Status message ─────────────────────────────────────────
const statusEl = document.getElementById('helperFormStatus');
function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff7a59' : 'rgba(249, 247, 243, 0.72)';
}

// ── Form submit ────────────────────────────────────────────
const form = document.getElementById('helperForm');
if (form) {
  initStepFlow();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const socialPlatform = String(data.get('social_platform') || '').trim();
    const socialHandle = String(data.get('socials') || '').trim();

    const payload = {
      attending: data.get('attending') === 'yes',
      wants_help: data.get('wants_help') === 'yes',
      name: String(data.get('name') || '').trim(),
      area_type: data.get('area_type'),
      block_or_ga: String(data.get('block_or_ga') || '').trim(),
      can_print: data.get('can_print') === 'yes',
      extra_blocks: String(data.get('extra_blocks') || '').trim(),
      socials: socialPlatform ? `${socialPlatform}: ${socialHandle}` : socialHandle,
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

      // Hide prefill hint
      const hint = document.getElementById('prefillHint');
      if (hint) hint.classList.remove('visible');

      // Reload overview after a short delay
      setTimeout(() => loadOverview(), 800);
    } catch (err) {
      console.error(err);
      setStatus('Something went wrong. Please try again.', true);
    }
  });
}

// ── Load overview on page ready ────────────────────────────
async function loadOverview() {
  try {
    const volunteers = await fetchVolunteers();
    buildOverview(volunteers);
  } catch (err) {
    const loading = document.getElementById('overviewLoading');
    if (loading) loading.textContent = 'Could not load current overview.';
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadOverview();
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
