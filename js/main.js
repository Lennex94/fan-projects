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
