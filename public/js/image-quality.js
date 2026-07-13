(function () {
  const DETAILS_CACHE = new Map();
  const pending = [];
  const queued = new WeakSet();
  const MAX_ENRICHMENTS = 24;
  const MAX_CONCURRENCY = 3;
  let enrichmentCount = 0;
  let activeRequests = 0;

  function isTmdb(url) {
    return /image\.tmdb\.org\/t\/p\//i.test(String(url || ''));
  }

  function sharpUrl(url, role = 'poster') {
    const value = String(url || '');
    if (!isTmdb(value)) return value;
    const size = role === 'backdrop' ? 'w780' : 'w500';
    return value.replace(/\/t\/p\/[^/]+\//i, `/t/p/${size}/`);
  }

  function srcset(url, role = 'poster') {
    if (!isTmdb(url)) return '';
    const base = String(url);
    const sizes = role === 'backdrop'
      ? [['w500', 500], ['w780', 780]]
      : role === 'land'
        ? [['w300', 300], ['w500', 500]]
      : [['w300', 300], ['w500', 500]];
    return sizes.map(([size, width]) => `${base.replace(/\/t\/p\/[^/]+\//i, `/t/p/${size}/`)} ${width}w`).join(', ');
  }

  function prepareImage(img) {
    if (!(img instanceof HTMLImageElement) || img.dataset.qualityReady === 'true') return;
    img.dataset.qualityReady = 'true';
    img.decoding = 'async';
    const role = img.dataset.imageRole || inferRole(img);
    img.dataset.imageRole = role;

    if (isTmdb(img.currentSrc || img.src)) {
      const original = img.currentSrc || img.src;
      const next = sharpUrl(original, role);
      const candidates = srcset(original, role);
      if (candidates) img.srcset = candidates;
      img.sizes = role === 'backdrop'
        ? '100vw'
        : role === 'land'
          ? '(max-width: 760px) 78vw, 360px'
          : '(max-width: 760px) 50vw, 260px';
      if (next && next !== img.src) img.src = next;
    }

    img.addEventListener('load', () => assessImage(img), { once: true });
    if (img.complete && img.naturalWidth) assessImage(img);
  }

  function inferRole(img) {
    if (img.closest('.media-card-land,.hero,.episode-thumb,.direct-screen')) return 'land';
    return 'poster';
  }

  function assessImage(img) {
    if (!img.dataset.mediaId || enrichmentCount >= MAX_ENRICHMENTS || queued.has(img)) return;
    const renderedWidth = Math.max(img.clientWidth, 180);
    const wantedWidth = renderedWidth * Math.min(window.devicePixelRatio || 1, 2) * 1.15;
    const url = img.currentSrc || img.src;
    const looksSmall = img.naturalWidth < wantedWidth || /\/thumb|\/resize|\/cache|\/poster_|\/w(?:92|154|185|300)\//i.test(url);
    if (!looksSmall || isTmdb(url) && img.naturalWidth >= wantedWidth) return;
    observeForUpgrade(img);
  }

  const visibilityObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        visibilityObserver.unobserve(entry.target);
        enqueue(entry.target);
      });
    }, { rootMargin: '320px' })
    : null;

  function observeForUpgrade(img) {
    queued.add(img);
    if (visibilityObserver) visibilityObserver.observe(img);
    else enqueue(img);
  }

  function enqueue(img) {
    if (enrichmentCount >= MAX_ENRICHMENTS) return;
    pending.push(img);
    drainQueue();
  }

  function drainQueue() {
    while (activeRequests < MAX_CONCURRENCY && pending.length && enrichmentCount < MAX_ENRICHMENTS) {
      const img = pending.shift();
      enrichmentCount += 1;
      activeRequests += 1;
      upgradeFromDetails(img).finally(() => {
        activeRequests -= 1;
        drainQueue();
      });
    }
  }

  async function upgradeFromDetails(img) {
    const id = String(img.dataset.mediaId || '').trim();
    if (!id || !img.isConnected) return;
    const type = String(img.dataset.mediaType || '').toLowerCase().includes('series') ? 'serie' : 'film';
    const key = `${type}:${id}`;
    let request = DETAILS_CACHE.get(key);
    if (!request) {
      request = fetch(`/api/${type}/${encodeURIComponent(id)}`, { cache: 'force-cache' })
        .then((response) => response.ok ? response.json() : null)
        .catch(() => null);
      DETAILS_CACHE.set(key, request);
    }
    const details = await request;
    if (!details || !img.isConnected) return;
    const role = img.dataset.imageRole || 'poster';
    const candidate = role === 'backdrop' || role === 'land'
      ? (details.backdrop || details.poster)
      : (details.poster || details.backdrop);
    if (!candidate) return;
    const next = sharpUrl(candidate, role);
    if (!next || next === img.src) return;
    const candidates = srcset(candidate, role);
    if (candidates) img.srcset = candidates;
    img.src = next;
    img.classList.add('image-upgraded');
  }

  function scan(scope = document) {
    if (scope instanceof HTMLImageElement) prepareImage(scope);
    scope.querySelectorAll?.('img').forEach(prepareImage);
  }

  window.MadradorImages = { sharpUrl, srcset, scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scan());
  else scan();

  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) scan(node);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
