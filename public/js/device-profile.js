(function () {
  const root = document.documentElement;
  const body = document.body;
  let lastProfile = '';

  function detectProfile() {
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const landscape = width >= height;
    const tvLike = width >= 1600 && height >= 850 && coarse && !fine;
    const fourK = width >= 2560;

    if (tvLike) return 'tv';
    if (fourK) return '4k';
    if (width <= 640) return 'phone';
    if (width <= 1024) return landscape ? 'tablet-landscape' : 'tablet';
    if (width <= 1440) return 'laptop';
    return 'desktop';
  }

  function applyProfile() {
    const profile = detectProfile();
    if (profile === lastProfile && root.dataset.pointerReady === 'true') return;
    lastProfile = profile;

    root.dataset.device = profile;
    root.dataset.pointer = window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine';
    root.dataset.orientation = window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
    root.dataset.pointerReady = 'true';
    body?.classList.toggle('is-tv', profile === 'tv');
    body?.classList.toggle('is-4k', profile === '4k');
  }

  function handleKeyboardIntent(event) {
    if (!['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
    root.dataset.inputMode = 'keyboard';
    handleSpatialNavigation(event);
  }

  function handlePointerIntent() {
    root.dataset.inputMode = 'pointer';
  }

  function handleSpatialNavigation(event) {
    if (!event.key.startsWith('Arrow')) return;
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;

    const items = getFocusableItems();
    if (!items.length) return;

    if (!active || !items.includes(active)) {
      items[0].focus();
      return;
    }

    const next = findNextFocusable(active, items, event.key);
    if (!next || next === active) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  function getFocusableItems() {
    return [...document.querySelectorAll([
      'a[href]',
      'button:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '.media-card',
      '.episode-card',
      '.source-btn',
      '.detail-action-card'
    ].join(','))]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
  }

  function findNextFocusable(active, items, key) {
    const base = active.getBoundingClientRect();
    const baseX = base.left + base.width / 2;
    const baseY = base.top + base.height / 2;
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }[key];

    let winner = null;
    let winnerScore = Infinity;

    items.forEach((item) => {
      if (item === active) return;
      const rect = item.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - baseX;
      const dy = y - baseY;
      const primary = direction[0] ? dx * direction[0] : dy * direction[1];
      if (primary <= 4) return;
      const secondary = direction[0] ? Math.abs(dy) : Math.abs(dx);
      const score = primary + secondary * 2.4;
      if (score < winnerScore) {
        winner = item;
        winnerScore = score;
      }
    });

    return winner;
  }

  applyProfile();
  window.addEventListener('resize', applyProfile, { passive: true });
  window.addEventListener('orientationchange', applyProfile, { passive: true });
  window.addEventListener('keydown', handleKeyboardIntent, true);
  window.addEventListener('pointerdown', handlePointerIntent, true);
})();
