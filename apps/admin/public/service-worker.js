// Admin (super admin) service worker — Web Push, and the bare minimum to be
// installable.
//
// Deliberately does NOT cache, unlike the booking app's worker. The portal shows
// live operational state (today's pickups, payment status); serving any of that
// from a cache would mean an operator acting on stale numbers.
//
// It exists for two reasons:
//  1. A push subscription requires a registered service worker.
//  2. Chrome only offers to INSTALL a site whose worker has a `fetch` handler —
//     and installing is what stops Android showing Chrome's icon and the origin
//     line on every notification. Without the handler below the install button
//     never appears, and the branding problem is unfixable.

const OFFLINE_HTML = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;
min-height:100vh;margin:0;background:#f8fafc;color:#0f172a;text-align:center;padding:24px}
h1{font-size:20px;font-weight:600;margin:0 0 8px}p{color:#64748b;margin:0;font-size:14px}</style>
<h1>You're offline</h1><p>Reconnect to load the admin dashboard.</p>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  // Navigations only, and nothing is ever stored. On a network failure the user
  // gets an honest offline shell instead of a stale dashboard.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    )
  );
});

self.addEventListener('push', (event) => {
  // iOS revokes push permission from sites that receive a push without showing
  // a notification, so every path here ends in showNotification() — including
  // the malformed-payload fallback.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    const raw = event.data ? event.data.text() : '';
    payload = { title: 'Drive247', body: raw.slice(0, 200) };
  }

  const title = payload.title || 'Drive247';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: payload.tag || 'drive247-admin',
    renotify: Boolean(payload.tag),
    requireInteraction: payload.requireInteraction === true,
    timestamp: Date.now(),
    data: { url: payload.url || '/', ...(payload.data || {}) },
  };
  // Ignored by browsers that do not support it, so it needs no feature check.
  if (payload.image) options.image = payload.image;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && targetUrl) {
            return client.navigate(targetUrl).then((c) => (c ? c.focus() : client.focus()));
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Push services rotate keys unilaterally; without this the device goes silent
// with nothing in the UI to explain why.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey =
          (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || null;
        if (!applicationServerKey) return;
        const fresh = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: fresh.toJSON() });
        }
      } catch (err) {
        console.error('[SW] pushsubscriptionchange re-subscribe failed:', err);
      }
    })()
  );
});
