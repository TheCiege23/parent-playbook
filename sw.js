// Parent Playbook — service worker: installable + offline, network-first so deploys land immediately
const CACHE = 'pp-v115';
// /privacy, /terms, /datadeletion, /coaches and /organizations are standalone pages, not
// part of the SPA. Precached so an offline navigation to them serves the real page
// instead of the index.html fallback.
const ASSETS = ['/', '/index.html', '/privacy', '/terms', '/datadeletion', '/coaches', '/organizations', '/friday-demo', '/company-persistence-demo', '/company-composition-demo', '/company-sdk-demo', '/sdk-demo.mjs', '/company-persistence-demo.mjs', '/company-composition-demo.mjs', '/manifest.webmanifest', '/icon.svg', '/css/landing.css', '/css/app.css',
  '/js/org-insights.js','/js/body-sdk.mjs','/js/body-sdk-surface.mjs','/js/body-sdk-record.mjs','/js/body-sdk-report.mjs','/js/body-sdk-supabase.mjs','/js/body-sdk-reference-supabase.mjs','/js/body-sdk-reference-import.mjs','/js/body-sdk-reference-history.mjs','/js/body-composition-contract.mjs','/js/body-composition-validation.mjs','/js/body-composition-record.mjs','/js/body-composition-supabase.mjs','/js/reference-cohort.mjs','/js/body-surface-report.mjs','/js/body-surface-repeat.mjs','/js/surface-section.js','/js/body-section-worker.js','/js/mesh-section.js',
  '/js/surface-review.mjs','/js/surface-worker.js','/js/visual-hull.js','/js/device-evidence.js',
  '/js/photo-import.mjs','/js/photo-import-worker.js','/js/heic-decode.js',
  '/img/brownpig-logo-ondark.png','/js/landing.js','/css/body-insights.css','/js/dates.js','/js/reference-cohorts.js','/js/reference-cohort.mjs','/js/body-outputs.js','/js/body-insights.js','/js/composition-import-ui.js','/js/composition-import.mjs','/js/composition-import-supabase.mjs','/js/composition-sharing-ui.js','/js/org-composition.js','/js/body-composition-reference.mjs','/js/scan-record.js','/js/assessment-report.js','/js/photo-quality.js','/js/scan-camera.js','/js/photo-identity.js',
  '/js/monitoring.js','/js/core.js','/js/offline.js','/js/background.js','/js/reference.js','/js/auth.js','/js/onboarding.js',
  '/js/program.js','/js/shell.js','/js/screen-week.js','/js/week-rail.js','/js/cdc-stature.js','/js/maturity.js','/js/pop-warner.js','/js/screen-growth.js','/js/screen-scan.js','/js/screen-coach.js','/js/screen-profile.js','/js/screen-edit.js','/js/screen-activity.js',
  '/js/trainer-onboarding.js','/js/admin.js','/js/admin-drills.js','/js/marketplace.js','/js/camps.js','/js/trainer-services.js',
  '/js/journey.js','/js/sheets.js','/js/org.js','/js/log-game.js','/js/account.js','/js/body-scan.js','/js/pose-measure.js','/js/jump-measure.js','/js/jump-scan.js','/js/speed-measure.js','/js/speed-scan.js','/js/sprint-measure.js','/js/sprint-scan.js','/js/invites.js','/js/pwa.js','/js/init.js'];

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
