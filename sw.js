const V = "pd-v3";
const PRE = ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(PRE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(req, copy)); }
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
  if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(req, copy)); }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (url.hostname === "cdn.jsdelivr.net") e.respondWith(cacheFirst(req));
  /* Supabase and everything else go straight to the network. */
});

/* ---------- Web Push ---------- */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || "PrivateDrive", {
      body: d.body || "You have a new notification.",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
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
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) { await w.focus(); w.postMessage({ type: "open-tab", tab }); return; }
    }
    await clients.openWindow("./?tab=" + tab);
  })());
});
