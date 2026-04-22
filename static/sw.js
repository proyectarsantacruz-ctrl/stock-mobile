/* Service worker minimalista para que la app sea instalable como PWA.
   No cacheamos respuestas de la API porque queremos stock fresco siempre. */

const CACHE_NAME = "stock-mobile-v4";
const SHELL = [
  "/",
  "/static/style.css",
  "/static/app.js",
  "/static/logo.png",
  "/static/icon-192.png",
  "/static/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL).catch(() => {})
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Nunca cachear API ni login: siempre network
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/login") || url.pathname.startsWith("/logout")) {
    return;
  }

  // Navegaciones: network first con fallback a shell
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/"))
    );
    return;
  }

  // Assets estáticos: cache first
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req))
    );
  }
});
