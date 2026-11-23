/* PrivateDrive service worker
   - Firebase Cloud Messaging (background push)
   - Notification click routing
   - Minimal app-shell cache (network-first for everything else)
*/

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// Same config as the page. Replace the placeholders.
firebase.initializeApp({
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
});

const messaging = firebase.messaging();

// Fires when a push arrives and no page is open in the foreground.
// If the payload includes a notification block, FCM may already display it,
// so we only show our own notification for data-only messages.
messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || d.title || "PrivateDrive";
  const body = n.body || d.body || "You have a new notification";

  return self.registration.showNotification(title, {
    body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || "privatedrive",
    renotify: true,
    data: { url: d.url || "/?tab=shared" }
  });
});

/* ---------- Notification click: focus an open window or open a new one ---------- */
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/?tab=shared";
  const absolute = new URL(target, self.location.origin).href;

  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) {
        try { await c.navigate(absolute); } catch (_) {}
        return c.focus();
      }
    }
    return clients.openWindow(absolute);
  })());
});

/* ---------- Caching: app shell only, network-first ---------- */
const CACHE = "privatedrive-v2";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  // Only cache same-origin GETs. Never touch Supabase, Firebase or other APIs.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html")))
  );
});
