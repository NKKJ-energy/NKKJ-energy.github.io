const CACHE_NAME = "energy-coffee-shell-20260923-7";
const APP_SHELL = [
  "./index.html",
  "./styles.css?v=7",
  "./vendor/supabase-2.117.1.min.js?v=7",
  "./config.js?v=7",
  "./standards-data.js?v=7",
  "./app.js?v=7",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map(async (asset) => {
        const response = await fetch(new Request(asset,{cache:"reload"}));
        if (!response.ok) throw new Error(`${asset} 返回 ${response.status}`);
        await cache.put(asset,response);
      })))
      .then((results) => {
        const failed = results.filter((result) => result.status === "rejected");
        if (failed.length) console.warn(`有 ${failed.length} 个静态资源将在后续访问时重试缓存`);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(caches.match("./index.html").then((cached) => cached || fetch(request)));
    return;
  }

  if (!["image", "script", "style"].includes(request.destination)) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
      }
      return response;
    }))
  );
});
