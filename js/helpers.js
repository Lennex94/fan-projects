const SUPABASE_URL = 'https://gbbxjjhsdvqcgbeammcr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U_Oki3osdN3PZC0fzopyLg_r-B1IxtA';
const TABLE = 'helpers_intake';

const form = document.getElementById('helperForm');
const statusEl = document.getElementById('helperFormStatus');

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff7a59' : 'rgba(249, 247, 243, 0.72)';
}

function initStepFlow() {
  if (!form) return;
  const steps = Array.from(form.querySelectorAll('[data-step]'))
    .filter((el) => el.tagName === 'LABEL' || el.tagName === 'BUTTON')
    .sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));

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

  const socialSelect = form.querySelector('select[name="social_platform"]');
  const socialsInput = form.querySelector('input[name="socials"]');
  if (socialSelect && socialsInput) {
    socialSelect.addEventListener('change', () => {
      const platform = socialSelect.value;
      if (!platform) return;
      const placeholderMap = {
        instagram: '@username',
        tiktok: '@username',
        whatsapp: '+31 6 12345678',
        email: 'name@email.com',
        x: '@username',
        other: 'Your contact',
      };
      socialsInput.placeholder = placeholderMap[platform] || 'Your contact';
    });
  }
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

    setStatus('Submitting...');
    try {
      await submitHelper(payload);
      setStatus('Thanks! Your response has been saved.');
      form.reset();
      initStepFlow();
    } catch (err) {
      console.error(err);
      setStatus('Something went wrong. Please try again.', true);
    }
  });
}
