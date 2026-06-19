// Service Worker v9.4 - skip anthropic API requests
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { 
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  return self.clients.claim();
});
self.addEventListener("fetch", e => {
  if(e.request.url.includes("api.anthropic.com") || e.request.url.includes("api.github.com")) return;
  e.respondWith(fetch(e.request, {cache: "no-store"}).catch(() => caches.match(e.request)));
});
