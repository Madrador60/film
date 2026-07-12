(function () {
  const root = document.documentElement;
  const body = document.body;

  if (!body) return;

  root.classList.add('ui2-booting');
  root.classList.add('mx-experience');
  root.dataset.input = 'pointer';

  window.addEventListener('load', () => {
    root.classList.remove('ui2-booting');
    root.classList.add('ui2-ready');
  }, { once: true });

  document.addEventListener('click', (event) => {
    const action = event.target.closest('a,button,.media-card,.episode-card,.source-btn,.detail-action-card');
    if (!action || action.matches('[disabled],.disabled')) return;
    pulse(action, event);

    const sidebar = document.getElementById('sidebar');
    if (sidebar?.classList.contains('open') && !action.closest('#sidebar') && !action.closest('#mobileMenu')) {
      sidebar.classList.remove('open');
    }
  }, true);

  document.addEventListener('pointerdown', (event) => {
    root.dataset.input = 'pointer';
    const target = event.target.closest('a,button,.media-card,.episode-card,.source-btn,.detail-action-card');
    if (!target || target.matches('[disabled],.disabled')) return;
    target.classList.add('ui2-pressed');
  }, { passive: true });

  document.addEventListener('pointerup', clearPressed, { passive: true });
  document.addEventListener('pointercancel', clearPressed, { passive: true });

  document.addEventListener('keydown', (event) => {
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      root.dataset.input = 'keyboard';
    }
    trapActiveDialog(event);
    if (event.key !== 'Escape') return;
    document.getElementById('sidebar')?.classList.remove('open');
    document.querySelector('.quick-modal:not(.hidden) .quick-close')?.click();
    document.querySelector('.trailer-modal:not(.hidden) .close-modal')?.click();
  });

  enhanceImages();
  watchDynamicCards();
  setActiveSidebarLink();
  installNetworkFeedback();
  secureExternalLinks();

  function pulse(element, event) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dot = document.createElement('span');
    dot.className = 'ui2-ripple';
    const size = Math.max(rect.width, rect.height);
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.left = `${event.clientX - rect.left - size / 2}px`;
    dot.style.top = `${event.clientY - rect.top - size / 2}px`;

    element.classList.add('ui2-ripple-host');
    element.appendChild(dot);
    window.setTimeout(() => dot.remove(), 520);
  }

  function clearPressed() {
    document.querySelectorAll('.ui2-pressed').forEach((el) => el.classList.remove('ui2-pressed'));
  }

  function enhanceImages(scope = document) {
    scope.querySelectorAll('img:not([data-ui2-img])').forEach((img) => {
      img.dataset.ui2Img = 'true';
      img.classList.toggle('ui2-img-loaded', img.complete && img.naturalWidth > 0);
      img.addEventListener('load', () => img.classList.add('ui2-img-loaded'), { once: true });
      img.addEventListener('error', () => img.classList.add('ui2-img-error'), { once: true });
    });
  }

  function watchDynamicCards() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          enhanceImages(node);
          node.querySelectorAll?.('.media-card,.settings-card,.admin-panel,.episode-card,.source-btn').forEach((card) => {
            card.classList.add('ui2-enter');
            window.setTimeout(() => card.classList.remove('ui2-enter'), 420);
          });
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setActiveSidebarLink() {
    const current = location.pathname.split('/').pop() || 'index.html';
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    const type = params.get('type');

    document.querySelectorAll('#sidebar .nav[href]').forEach((link) => {
      const url = new URL(link.getAttribute('href'), location.href);
      const path = url.pathname.split('/').pop() || 'index.html';
      const linkView = url.searchParams.get('view');
      const linkType = url.searchParams.get('type');
      let active = path === current;

      if (current === 'catalog.html') {
        active = path === 'catalog.html' && (
          (linkView && linkView === view) ||
          (linkType && linkType === type) ||
          (!linkView && !linkType && !view && !type)
        );
      }

      if (current === 'library.html') {
        active = path === 'library.html' && (!linkView || linkView === view || !view);
      }

      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function trapActiveDialog(event) {
    if (event.key !== 'Tab') return;
    const dialog = document.querySelector('[role="dialog"]:not(.hidden), dialog[open]');
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function installNetworkFeedback() {
    const toast = document.createElement('div');
    toast.className = 'mx-network-toast hidden';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);

    const announce = (online) => {
      toast.dataset.state = online ? 'online' : 'offline';
      toast.innerHTML = online
        ? '<i class="fa-solid fa-wifi"></i> Connexion rétablie'
        : '<i class="fa-solid fa-triangle-exclamation"></i> Mode hors connexion';
      toast.classList.remove('hidden');
      window.clearTimeout(announce.timer);
      announce.timer = window.setTimeout(() => toast.classList.add('hidden'), online ? 2200 : 5000);
    };

    window.addEventListener('online', () => announce(true));
    window.addEventListener('offline', () => announce(false));
    if (!navigator.onLine) announce(false);
  }

  function secureExternalLinks() {
    document.querySelectorAll('a[target="_blank"]').forEach((link) => {
      const rel = new Set(String(link.rel || '').split(/\s+/).filter(Boolean));
      rel.add('noopener');
      rel.add('noreferrer');
      link.rel = Array.from(rel).join(' ');
    });
  }
})();
