// HOME: background intro + click reveal (and no "stuck dark" on back/forward)
(function () {
  const isHome = document.body.classList.contains("home");
  if (!isHome) return;

  const btn = document.getElementById("revealBtn");
  const content = document.getElementById("heroContent");
  if (!btn || !content) return;

  // must match the file in /assets
  const BG_SRC = "./assets/logo-bg.png";

  function runBgIntro() {
    // hide button until bg is ready (looks cleaner)
    btn.disabled = true;
    document.body.classList.remove("bg-ready");

    const img = new Image();
    img.src = BG_SRC;

    const done = () => {
      // double RAF -> guarantees the transition actually runs
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          btn.disabled = false;
          document.body.classList.add("bg-ready");
        });
      });
    };

    if (img.decode) {
      img.decode().then(done).catch(done);
    } else {
      img.onload = done;
      img.onerror = done;
    }
  }

  function hardResetHome() {
    // instant reset (no transitions)
    document.body.classList.add("no-anim");
    document.body.classList.remove("revealed", "bg-ready");
    content.setAttribute("aria-hidden", "true");
    btn.disabled = true;

    // force style recalculation
    void document.body.offsetHeight;

    requestAnimationFrame(() => {
      document.body.classList.remove("no-anim");
      runBgIntro();
    });
  }

  function revealHome() {
    document.body.classList.add("revealed");
    content.setAttribute("aria-hidden", "false");
  }

  btn.addEventListener("click", revealHome);

  // Back/forward cache: always restart the intro when you come back
  window.addEventListener("pageshow", hardResetHome);

  // When leaving, clear state so the cached snapshot isn't "dark"
  window.addEventListener("pagehide", () => {
    document.body.classList.remove("revealed", "bg-ready");
    content.setAttribute("aria-hidden", "true");
  });

  // normal initial load
  hardResetHome();
})();


// Footer year
const y = document.getElementById("year");
if (y) y.textContent = new Date().getFullYear();


// Projects filter (only if grid exists)
const chips = document.querySelectorAll(".chip");
const grid = document.getElementById("projectsGrid");

if (chips.length && grid) {
  chips.forEach((btn) => {
    btn.addEventListener("click", () => {
      chips.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const filter = btn.dataset.filter;
      const cards = grid.querySelectorAll(".card");

      cards.forEach((card) => {
        const type = card.dataset.type;
        card.style.display = (filter === "all" || filter === type) ? "" : "none";
      });
    });
  });
}

// Join selection -> store -> go to visualizer
document.getElementById("fpJoinBtn")?.addEventListener("click", () => {
  const level = document.getElementById("fpLevel").value;
  const block = document.getElementById("fpBlock").value;

  localStorage.setItem("fp_level", level);
  localStorage.setItem("fp_block", block);

  // WICHTIG: hier deine echte Visualizer-Seite rein
  window.location.href = "./hs-visualizer.html";
});

// --- Project join: Level/Block -> run page (fixes 404 + removes old hs-visualizer.html usage) ---
(function () {
  const joinBtn = document.getElementById("fpJoinBtn");
  const levelEl = document.getElementById("fpLevel");
  const blockEl = document.getElementById("fpBlock");

  if (!joinBtn || !levelEl || !blockEl) return;

  function goJoin() {
    const level = (levelEl.value || "").trim();
    const block = (blockEl.value || "").trim();

    const params = new URLSearchParams();
    if (level) params.set("level", level);
    if (block) params.set("block", block);

    const url = "./run-hs-together-together.html" + (params.toString() ? `?${params.toString()}` : "");
    window.location.href = url;
  }

  joinBtn.addEventListener("click", goJoin);

  blockEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") goJoin();
  });
})();
