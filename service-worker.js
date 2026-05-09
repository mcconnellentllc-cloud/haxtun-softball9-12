// Haxtun Bulldogs PWA service worker
// Strategy: network-first with cache fallback. Offline-friendly.

const CACHE = 'bulldogs-v1';
const BASE = '/haxtun-softball9-12';
const PRECACHE = [
  BASE + '/',
  BASE + '/schedule/',
  BASE + '/roster/',
  BASE + '/league-rules/',
  BASE + '/nfhs-rules/',
  BASE + '/practices/',
  BASE + '/standings/',
  BASE + '/news/',
  BASE + '/contact/',
  BASE + '/assets/css/style.css',
  BASE + '/assets/calendar/haxtun-bulldogs-2026.ics',
  BASE + '/assets/img/icon-192.png',
  BASE + '/assets/img/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(BASE + '/')))
  );
});
