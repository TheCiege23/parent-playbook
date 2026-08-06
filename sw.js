// Parent Playbook — service worker: installable + offline, network-first so deploys land immediately
const CACHE = 'pp-v3';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/css/app.css',
  '/js/core.js','/js/background.js','/js/reference.js','/js/auth.js','/js/onboarding.js',
  '/js/program.js','/js/shell.js','/js/screen-week.js','/js/screen-growth.js','/js/screen-profile.js',
  '/js/journey.js','/js/sheets.js','/js/invites.js','/js/pwa.js','/js/init.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin === self.location.origin) {
    // same-origin (app shell + modules): network-first so a new deploy lands immediately,
    // fall back to cache when offline. Runtime-cache each success so offline works.
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
    );
    return;
  }
  // cross-origin (fonts, Supabase): pass through — never cache API/data or private media
  e.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
