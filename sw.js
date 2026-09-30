/* PrivateDrive service worker: offline cache + Web Push */
const V = "pd-v4";
const PRE = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
const ICON = "icons/icon-192.png";

/* ---------- Install / activate ---------- */
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    /* Cache each file separately so one missing file can't break installation. */
    await Promise.all(PRE.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- Fetch strategies ---------- */
async function put(req, res) {
  /* Only full 200 responses can be cached (206 partial video/audio would throw). */
  if (res && res.status === 200) {
    try { const c = await caches.open(V); await c.put(req, res.clone()); } catch (err) {}
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    put(req, res);
    return res;
  } catch (err) {
    const hit = await caches.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      const page = (await caches.match("./")) || (await caches.match("index.html"));
      if (page) return page;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  put(req, res);
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === "cdn.jsdelivr.net") e.respondWith(cacheFirst(req));
  /* Supabase and everything else go straight to the network. */
});

/* ---------- Web Push ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {
    try { d = { body: e.data.text() }; } catch (err2) {}
  }
  e.waitUntil((async () => {
    /* Always show a notification (required on iOS and Chrome for push). */
    await self.registration.showNotification(d.title || "PrivateDrive", {
      body: d.body || "You have a new notification.",
      icon: ICON,
      badge: ICON,
      tag: d.tag || "pd",
      renotify: true,
      data: { tab: d.tab || "shared" }
    });
    try {
      if (typeof d.count === "number" && self.navigator.setAppBadge) {
        if (d.count > 0) await self.navigator.setAppBadge(d.count);
        else await self.navigator.clearAppBadge();
      }
    } catch (err) {}
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || "shared";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    /* Prefer a window that's already visible, otherwise any open one. */
    const target = wins.find(w => w.visibilityState === "visible") || wins[0];
    if (target) {
      try { await target.focus(); } catch (err) {}
      target.postMessage({ type: "open-tab", tab });
      return;
    }
    await self.clients.openWindow("./?tab=" + tab);
  })());
});
