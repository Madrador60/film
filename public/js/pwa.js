(() => {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let installPrompt = null;

  window.MadradorPWA = {
    canInstall: () => Boolean(installPrompt),
    isInstalled: () => matchMedia('(display-mode: standalone)').matches,
    install: async () => {
      if (!installPrompt) return false;
      installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      installPrompt = null;
      window.dispatchEvent(new CustomEvent('madrador:pwa-state'));
      return choice.outcome === 'accepted';
    }
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    window.dispatchEvent(new CustomEvent('madrador:pwa-state'));
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    window.dispatchEvent(new CustomEvent('madrador:pwa-state'));
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      registration.update().catch(() => {});
    } catch (error) {
      console.warn('[Madrador PWA] Service worker indisponible.', error);
    }
  }, { once: true });
})();
