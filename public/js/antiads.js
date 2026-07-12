(() => {
  const prefs = typeof MadradorStorage !== 'undefined' ? MadradorStorage.getPrefs() : {};
  if (prefs.antiPopupEnabled === false) return;

  const POPUP_ALLOW_WINDOW_MS = 1200;
  const SAFE_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation';
  const AD_SELECTORS = [
    '.adsbygoogle', '[id^="google_ads"]', '[id*="google_ads"]', '[class*="ad-container"]',
    '[class*="advertisement"]', '[data-ad-slot]', '[data-ad-client]', 'iframe[src*="doubleclick.net"]',
    'iframe[src*="googlesyndication.com"]', 'iframe[src*="adservice.google"]'
  ].join(',');
  let popupAllowanceUntil = 0;
  let toastTimer = null;

  function markTrustedClick(event) {
    if (!event.isTrusted) return;
    const explicit = event.target.closest?.('[data-allow-popup="true"], #directOpen, #openSource, #trailerExternal');
    if (explicit) popupAllowanceUntil = Date.now() + POPUP_ALLOW_WINDOW_MS;
  }

  function isTrustedWindow() {
    return Date.now() < popupAllowanceUntil;
  }

  function showAntiAdToast(message = 'Popup bloquée') {
    let toast = document.getElementById('antiAdToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'antiAdToast';
      toast.className = 'antiad-toast hidden';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<i class="fa-solid fa-shield-halved"></i><span>${escapeHtml(message)}</span>`;
    toast.classList.remove('hidden');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 1800);
  }

  function protectIframe(iframe) {
    if (!(iframe instanceof HTMLIFrameElement)) return;
    iframe.setAttribute('sandbox', SAFE_IFRAME_SANDBOX);
    iframe.setAttribute('referrerpolicy', iframe.getAttribute('referrerpolicy') || 'no-referrer');
    iframe.setAttribute('allow', iframe.getAttribute('allow') || 'fullscreen; autoplay; encrypted-media; picture-in-picture');
  }

  function protectExistingIframes() {
    document.querySelectorAll('iframe').forEach(protectIframe);
  }

  function installPopupGuard() {
    const nativeOpen = window.open.bind(window);

    window.open = function guardedOpen(url, target, features) {
      if (isTrustedWindow()) {
        popupAllowanceUntil = 0;
        return nativeOpen(url, target, features);
      }

      console.warn('[Madrador Anti-Pub] Popup bloquée:', url || '');
      showAntiAdToast('Popup bloquée');
      return null;
    };

    document.addEventListener('click', (event) => {
      markTrustedClick(event);
      const link = event.target.closest?.('a[target="_blank"]');
      if (!link) return;

      if (link.dataset.allowPopup === 'true') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      link.setAttribute('rel', 'noopener noreferrer');
      showAntiAdToast('Ouverture externe bloquée');
    }, true);
  }

  function removeInjectedAds(scope = document) {
    if (scope instanceof Element && scope.matches(AD_SELECTORS) && !scope.closest('.direct-screen, .screen')) {
      scope.remove();
      return;
    }
    scope.querySelectorAll?.(AD_SELECTORS).forEach((element) => {
      if (element.closest('.direct-screen, .screen')) return;
      element.remove();
    });
  }

  function installIframeObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLIFrameElement) protectIframe(node);
          node.querySelectorAll?.('iframe').forEach(protectIframe);
          if (node instanceof Element) removeInjectedAds(node);
        });
      });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }

  document.addEventListener('DOMContentLoaded', () => {
    protectExistingIframes();
    removeInjectedAds();
    installPopupGuard();
    installIframeObserver();
  });
})();
