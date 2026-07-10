const CACHE_NAME = "aurum-campo-v1";
const ASSETS = [
  "./index.html",
  "./app.js",
  "./styles.css",
  "./manifest.json",
  "./malha.json",
  "./logo_vertical.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-192-maskable.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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

// Cache-first: garante que o app abre mesmo com zero sinal.
// Chamadas para o Apps Script (sincronização) NÃO passam por aqui como cache,
// vão direto pra rede porque a URL é diferente da origem do app.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
