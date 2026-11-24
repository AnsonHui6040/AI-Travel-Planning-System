/* global self, caches */
// T35：service worker（D11）。
// - /trips/<行程>/today：先連網，成功時更新快取；離線時以 /offline-today（從 IndexedDB 讀取當日包）回應
// - /_next/static：先用快取
// - /api/photos：先用快取（成員本人的裝置，離線照片）
// - 其他請求（含 API、Server Action）一律直接連網，不快取
const CACHE = "atps-v1";
const SHELL = "/offline-today";

async function cacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch(SHELL, { credentials: "same-origin" });
  if (!response.ok) return;
  await cache.put(SHELL, response.clone());
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.all([...new Set(assets)].map((url) => cache.add(url).catch(() => undefined)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && /^\/trips\/[0-9a-f-]{36}\/today$/.test(url.pathname)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(SHELL)) ?? Response.error();
      }),
    );
    return;
  }

  if (url.pathname === SHELL) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(SHELL, response.clone());
            const html = await response.clone().text();
            const assets = [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1]);
            await Promise.all([...new Set(assets)].map((asset) => cache.add(asset).catch(() => undefined)));
          }
          return response;
        })
        .catch(async () => (await (await caches.open(CACHE)).match(SHELL)) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/api/photos/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
