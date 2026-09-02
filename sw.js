// Best Excel — service worker
//
// CACHE VERSION: bump this string (e.g. v3, v4...) every time you upload a
// new index.html if the site ever seems to be showing an old/stale version
// again in the future — that forces every visitor's browser to throw away
// its old cached copy and fetch the new one.
const CACHE_VERSION = 'best-excel-v4';

const STATIC_ASSETS = [
  './manifest.json',
  './launchericon-192x192.png',
  './launchericon-512x512.png',
  './poster-bg.jpg',
  './header-bg.jpg',
];

self.addEventListener('install', (event) => {
  // Take over immediately instead of waiting for the old service worker to
  // fully stop being used — this is part of what makes updates show up
  // right away instead of needing multiple reloads/tab closes.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      // Best-effort — if an icon/manifest file is missing this shouldn't
      // block the service worker from installing.
      return Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)));
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete every cache that isn't this version — this is the actual
      // fix for "still showing the old site": old cached copies of
      // index.html under a previous CACHE_VERSION are wiped out here.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests — never touch Firestore/Google
  // API calls, EmailJS, or anything cross-origin. Those always go straight
  // to the network untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // NETWORK-FIRST for the main page itself (index.html / the root "/").
  // This is the critical part for staying up to date: every time the app
  // is opened with internet available, it always tries to fetch the LATEST
  // index.html from GitHub Pages first. Only if that fetch fails (genuinely
  // offline) does it fall back to whatever was last cached, so the app can
  // still open with no internet — but it never PREFERS the stale copy over
  // a fresh one the way "cache-first" would.
  const isHtmlRequest =
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    new URL(req.url).pathname.endsWith('index.html') ||
    new URL(req.url).pathname === '/' ||
    new URL(req.url).pathname.endsWith('/best-excel/');

  if (isHtmlRequest) {
    event.respondWith(
      // 'no-cache' (not 'no-store'): the browser still revalidates with the
      // server on every load, but a conditional GET can come back as a tiny
      // 304 Not Modified when index.html hasn't changed, instead of always
      // re-downloading the whole file. 'no-store' was forcing a full fresh
      // download of index.html (hundreds of KB) on every single page view,
      // which was the main cause of the site feeling slow to open.
      fetch(req, { cache: 'no-cache' })
        .then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return networkResponse;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (icons, manifest, etc): cache-first, network fallback —
  // fine for these since they rarely change and this keeps the app fast/
  // usable offline for its supporting files.
  event.respondWith(
    caches.match(req).then((cached) => {
      return (
        cached ||
        fetch(req).then((networkResponse) => {
          const copy = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return networkResponse;
        })
      );
    })
  );
});
