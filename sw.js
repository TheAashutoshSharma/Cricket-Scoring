// Cricket Scorer PWA - Service Worker
const CACHE_NAME = 'cricket-scorer-v5';

// Only cache third-party CDN libraries (they never change)
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/9.22.2/firebase-app-compat.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/9.22.2/firebase-database-compat.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/firebase/9.22.2/firebase-auth-compat.min.js'
];

// Install — only cache CDN libs, NOT app.js / index.html
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CDN_ASSETS))
  );
  self.skipWaiting(); // activate immediately
});

// Activate — clean old caches, claim clients, reload all tabs
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
     .then(() => {
       return self.clients.matchAll({ type: 'window' }).then(clients => {
         clients.forEach(client => client.navigate(client.url));
       });
     })
  );
});

// Fetch strategy:
// - local files (app.js, index.html) → network-first, no-store
// - CDN libs → cache-first
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isLocal = url.origin === self.location.origin;
  const isCDN   = url.hostname === 'cdnjs.cloudflare.com';

  if (isLocal) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(response => {
          const path = url.pathname;
          if (path.startsWith('/icons/')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
  } else if (isCDN) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return response;
        });
      })
    );
  }
});
