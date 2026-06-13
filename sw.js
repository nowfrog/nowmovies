const CACHE_NAME = 'nowmovies-v1';
const ASSETS = [
  './',
  './index.html',
  './scripts.js',
  './styles.css',
  './stats.html',
  './manifest.json',
  './favicon.ico',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API and admin calls: network only
  if (url.pathname.includes('update_list.php') || url.pathname.includes('/admin/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // List JSON files: network first, cache fallback (for offline viewing)
  if (url.pathname.endsWith('.json') && url.pathname.includes('/liste/')) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // TMDB images: network first, cache fallback
  if (url.hostname.includes('tmdb.org') || url.pathname.includes('/screenshots/')) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) {
            const clone = r.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App shell: cache first
  e.respondWith(
    caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
