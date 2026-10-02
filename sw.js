// OneSignal service worker must be imported FIRST, before any other code.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Bump this version string when you want to invalidate old caches.
const CACHE_VERSION = "privatedrive-v1";
const CACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

/* ---------------- Install ---------------- */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(CACHE_ASSETS))
  );
  self.skipWaiting();
});

/* ---------------- Activate ---------------- */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ---------------- Fetch ---------------- */
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache Supabase or OneSignal requests — always go to network.
  if (
    url.hostname.includes("supabase.co") ||
    url.hostname.includes("onesignal.com") ||
    req.method !== "GET"
  ) {
    return; // fall through to network
  }

  // Cache-first for same-origin GET requests.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        return (
          cached ||
          fetch(req)
            .then(res => {
              // Cache successful responses.
              if (res.ok && res.type === "basic") {
                const clone = res.clone();
                caches.open(CACHE_VERSION).then(c => c.put(req, clone));
              }
              return res;
            })
            .catch(() => cached)
        );
      })
    );
  }
});

/* ---------------- Message handler (MUST be at top level) ---------------- */
self.addEventListener("message", event => {
  if (!event.data) return;
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
  // Allow the page to ask the SW to open a specific tab.
  if (event.data.type === "open-tab" && event.data.tab) {
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then(clients => {
        clients.forEach(client => client.postMessage(event.data));
      })
    );
  }
});
