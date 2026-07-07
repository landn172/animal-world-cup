// Service Worker. In PRODUCTION it precaches all game assets on install so
// subsequent navigations to /match load instantly from cache (the deployed host
// has slow TTFB), serving cache-first (see the fetch handler).
// CACHE_VERSION is stamped at BUILD time (script/stamp-sw-version.mjs) with a
// content hash of the shipped assets. So a deploy whose assets changed ships a
// new cache name → the activate step purges the old cache and the next install
// re-precaches the current build → users get the latest with NO manual refresh.
// The hash is opaque (not a date), so no version fingerprint. "dev" is the
// unstamped placeholder; the build re-stamps it. (A SWR rewrite was tried and
// reverted: re-downloading every asset each load wedged boot on the slow host —
// so we keep cache-first speed + content-hash invalidation.)
const CACHE_VERSION = "143769361d3c";
const CACHE_NAME = "animal-cup-" + CACHE_VERSION;
const MANIFEST_URL = "/__sw-manifest.json";

// On localhost the SW is a NO-OP: local dev must always serve the latest from
// the dev server, never a cached copy. The precache + cache-first below are a
// production-only optimisation. (This is exactly why local edits used to need a
// hard refresh — the prod cache was wrongly active in dev too.)
const IS_LOCAL =
  self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

// On install: fetch the manifest and precache everything in the background
self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (IS_LOCAL) return; // dev: don't precache — serve live from the dev server
  event.waitUntil(
    fetch(MANIFEST_URL)
      .then((r) => r.json())
      .then((urls) => {
        return caches.open(CACHE_NAME).then((cache) => {
          // Don't let a single failed fetch abort the whole precache.
          // Use individual add() calls so failures are isolated.
          let loaded = 0;
          const total = urls.length;
          const batchSize = 20; // concurrent fetches
          let i = 0;

          function nextBatch() {
            const batch = urls.slice(i, i + batchSize);
            i += batchSize;
            if (batch.length === 0) return Promise.resolve();
            return Promise.allSettled(
              batch.map((url) =>
                fetch(url).then((response) => {
                  if (response.ok && response.status !== 206) {
                    return cache.put(url, response);
                  }
                }).then(() => {
                  loaded++;
                  if (loaded % 100 === 0) {
                    self.clients.matchAll().then((clients) => {
                      clients.forEach((c) =>
                        c.postMessage({ type: "sw-precache-progress", loaded, total })
                      );
                    });
                  }
                })
              )
            ).then(nextBatch);
          }

          return nextBatch();
        });
      })
      .catch((e) => console.warn("[sw] precache failed:", e))
  );
});

// On activate: drop stale caches (ALL of them on localhost, since the SW is
// inert there), then claim clients.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => IS_LOCAL || k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch strategy: cache-first for game assets (production only).
self.addEventListener("fetch", (event) => {
  if (IS_LOCAL) return; // dev: never intercept — always hit the live dev server
  const url = new URL(event.request.url);

  // Only intercept same-origin GET requests for game assets
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  const isGameAsset =
    url.pathname.startsWith("/match-runtime-min/") ||
    url.pathname.startsWith("/animal-cup/") ||
    url.pathname === "/__sw-manifest.json";

  if (!isGameAsset) return;

  // Cache-first: serve from cache, fall back to network (and cache the response).
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok && response.status !== 206) cache.put(event.request, response.clone());
          return response;
        });
      })
    )
  );
});
