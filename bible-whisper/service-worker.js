/* ============================================================ */
/* === Bible Whisper — Service Worker (Cache-First)          === */
/* ============================================================ */

const CACHE_NAME = 'bible-whisper-v6';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './idb-helper.js',
  './bible-reader.js',
  './bible-tts.js',
  './bible.json',
  './historical_refs.json',
  './app-icon.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Serif+TC:wght@400;500;700&display=swap'
];

/* Install — pre-cache all assets */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .catch(err => console.warn('[SW] Pre-cache partial failure:', err))
  );
  self.skipWaiting();
});

/* Activate — purge old caches */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* Fetch — Cache-First strategy */
self.addEventListener('fetch', event => {
  // Skip non-GET and cross-origin (except Google Fonts)
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
