// ============================================
// FanProjects - Main JavaScript
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  const revealBtn = document.getElementById('revealBtn');
  if (revealBtn) {
    const bg = document.querySelector('.bg');
    const overlay = document.querySelector('.overlay');
    const heroContent = document.getElementById('heroContent');
    const hero = document.querySelector('.hero');

    revealBtn.addEventListener('click', () => {
      revealBtn.classList.add('hidden');

      if (bg) bg.classList.add('revealed');
      if (overlay) overlay.classList.add('revealed');
      if (hero) hero.classList.add('revealed');

      setTimeout(() => {
        if (heroContent) {
          heroContent.setAttribute('aria-hidden', 'false');
          heroContent.classList.add('revealed');
        }

        document.body.style.overflow = 'auto';
      }, 800);
    });
  }

  const joinBtn = document.getElementById('fpJoinBtn');
  if (joinBtn) {
    joinBtn.addEventListener('click', () => {
      const level = document.getElementById('fpLevel')?.value || '';
      const block = document.getElementById('fpBlock')?.value || '';

      if (!block) {
        alert('Please enter your block number.');
        return;
      }

      const params = new URLSearchParams({
        level: level,
        block: block
      });

      window.location.href = `./run-hs-together-together.html?${params.toString()}`;
    });
  }

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  const projectListItems = document.querySelectorAll('.project-list li');
  projectListItems.forEach((item, index) => {
    item.style.opacity = '0';
    item.style.transform = 'translateX(-20px)';

    setTimeout(() => {
      item.style.transition = 'all 0.5s ease';
      item.style.opacity = '1';
      item.style.transform = 'translateX(0)';
    }, 100 * index);
  });

  const pills = document.querySelectorAll('.project-meta .pill');
  pills.forEach((pill, index) => {
    pill.style.opacity = '0';
    pill.style.transform = 'translateY(-10px)';

    setTimeout(() => {
      pill.style.transition = 'all 0.4s ease';
      pill.style.opacity = '1';
      pill.style.transform = 'translateY(0)';
    }, 100 * index);
  });

  const demoForms = document.querySelectorAll('form[data-demo="true"]');
  demoForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      alert('Request submitted! (This is a demo - implement actual form handling)');
    });
  });

  const projectHeroImg = document.querySelector('.project-hero__img');
  if (projectHeroImg) {
    window.addEventListener('scroll', () => {
      const scrolled = window.pageYOffset;
      const rate = scrolled * 0.3;

      if (scrolled < window.innerHeight) {
        projectHeroImg.style.transform = `translateY(${rate}px)`;
      }
    });
  }

  const panels = document.querySelectorAll('.panel');
  panels.forEach(panel => {
    panel.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-4px) scale(1.01)';
    });

    panel.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0) scale(1)';
    });
  });

  const images = document.querySelectorAll('img');
  images.forEach(img => {
    if (!img.complete) {
      img.style.opacity = '0';
      img.addEventListener('load', () => {
        img.style.transition = 'opacity 0.5s ease';
        img.style.opacity = '1';
      });
    }
  });

  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.panel, .two-col, .feature-card').forEach(el => {
    observer.observe(el);
  });
});
