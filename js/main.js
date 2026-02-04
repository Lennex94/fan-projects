// ============================================
// FanProjects - Main JavaScript
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Set current year in footer
  const yearSpan = document.getElementById('year');
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  // Hero reveal animation (homepage)
  const revealBtn = document.getElementById('revealBtn');
  if (revealBtn) {
    const bg = document.querySelector('.bg');
    const overlay = document.querySelector('.overlay');
    const heroContent = document.getElementById('heroContent');

    revealBtn.addEventListener('click', () => {
      // Hide button
      revealBtn.classList.add('hidden');
      
      // Reveal background
      if (bg) bg.classList.add('revealed');
      if (overlay) overlay.classList.add('revealed');
      
      // Show content after a delay
      setTimeout(() => {
        if (heroContent) {
          heroContent.setAttribute('aria-hidden', 'false');
          heroContent.classList.add('revealed');
        }
        
        // Enable body scroll
        document.body.style.overflow = 'auto';
      }, 800);
    });
  }

  // Join project functionality
  const joinBtn = document.getElementById('fpJoinBtn');
  if (joinBtn) {
    joinBtn.addEventListener('click', () => {
      const level = document.getElementById('fpLevel')?.value || '';
      const block = document.getElementById('fpBlock')?.value || '';

      if (!block) {
        alert('Please enter your block number.');
        return;
      }

      // Create URL with parameters
      const params = new URLSearchParams({
        level: level,
        block: block
      });
      
      // Navigate to run page
      window.location.href = `./run-hs-together-together.html?${params.toString()}`;
    });
  }

  // Add smooth scroll behavior
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

  // Add staggered animation to project lists
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

  // Add staggered animation to pills in project meta
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

  // Form validation enhancement
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      // Add your form submission logic here
      // For now, just show a confirmation
      alert('Request submitted! (This is a demo - implement actual form handling)');
    });
  });

  // Add parallax effect to project hero images
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

  // Enhanced hover effects for panels
  const panels = document.querySelectorAll('.panel');
  panels.forEach(panel => {
    panel.addEventListener('mouseenter', function() {
      this.style.transform = 'translateY(-4px) scale(1.01)';
    });
    
    panel.addEventListener('mouseleave', function() {
      this.style.transform = 'translateY(0) scale(1)';
    });
  });

  // Add loading animation for images
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

  // Add custom cursor effect on buttons (optional enhancement)
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(button => {
    button.addEventListener('mouseenter', () => {
      document.body.style.cursor = 'pointer';
    });
    
    button.addEventListener('mouseleave', () => {
      document.body.style.cursor = 'default';
    });
  });

  // Intersection Observer for fade-in animations
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

  // Observe panels and sections
  document.querySelectorAll('.panel, .two-col').forEach(el => {
    observer.observe(el);
  });
});
