/**
 * Ledger service worker — makes the installed Android app (and any browser
 * tab) resilient: hashed static assets load from cache first, page loads
 * prefer the network but fall back to the cached shell offline. Convex
 * realtime traffic is never intercepted.
 */

const CACHE = "ledger-v1";
const PRECACHE = [
  "/",
  "/dashboard",
  "/manifest.webmanifest",
  "/logo.svg",
  "/pwa-192.png",
  "/pwa-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never touch Convex or cross-origin traffic — realtime data stays live.
  if (url.origin !== self.location.origin) return;

  // Hashed build assets: cache-first, they are content-addressed.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Pages and misc files: network-first, cached shell as the offline fallback.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached ?? caches.match("/dashboard")),
      ),
  );
});
