const CACHE_VERSION = 'madrador-shell-2026-07-v18';
const APP_SHELL = [
  '/',
  '/index.html',
  '/catalog.html',
  '/search.html',
  '/library.html',
  '/settings.html',
  '/admin.html',
  '/diagnostic.html',
  '/direct.html',
  '/player.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/madrador-logo.png',
  '/css/style.css',
  '/css/experience.css',
  '/css/nova.css',
  '/js/storage.js',
  '/js/device-profile.js',
  '/js/image-quality.js',
  '/js/mobile-nav.js',
  '/js/ui-system.js',
  '/js/pwa.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/offline.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
