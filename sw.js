// Parent Playbook — service worker: installable + offline, network-first so deploys land immediately
const CACHE = 'pp-v31';
// /privacy and /terms are standalone pages, not part of the SPA. Precached so an offline
// navigation to them serves the real page instead of the index.html fallback.
const ASSETS = ['/', '/index.html', '/privacy', '/terms', '/manifest.webmanifest', '/icon.svg', '/css/landing.css', '/css/app.css',
  '/img/brownpig-logo-ondark.png','/js/landing.js',
  '/js/monitoring.js','/js/core.js','/js/offline.js','/js/background.js','/js/reference.js','/js/auth.js','/js/onboarding.js',
  '/js/program.js','/js/shell.js','/js/screen-week.js','/js/cdc-stature.js','/js/maturity.js','/js/screen-growth.js','/js/screen-profile.js','/js/screen-edit.js','/js/screen-activity.js',
  '/js/trainer-onboarding.js','/js/admin.js','/js/admin-drills.js','/js/marketplace.js','/js/trainer-services.js',
  '/js/journey.js','/js/sheets.js','/js/log-game.js','/js/account.js','/js/body-scan.js','/js/invites.js','/js/pwa.js','/js/init.js'];

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
  // cross-origin (fonts, Supabase): pass through untouched. Nothing cross-origin is ever
  // put in the cache, so the old caches.match() here was a guaranteed miss on every
  // single Supabase read. Returning without respondWith lets the browser handle it.
});

// ---- Web Push ----
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Parent Playbook';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: '/icon.svg', badge: '/icon.svg',
    data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) { if ('focus' in w) { w.navigate && w.navigate(url); return w.focus(); } }
    return clients.openWindow(url);
  }));
});
