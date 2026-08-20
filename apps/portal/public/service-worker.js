// Portal service worker — Web Push only.
//
// Deliberately has NO fetch/caching handler, unlike the booking app's worker.
// The portal shows live operational state (today's pickups, payment status);
// serving any of that from a cache would mean an operator acting on stale
// numbers. The only reason this worker exists is that a push subscription
// REQUIRES a registered service worker.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
    tag: payload.tag || 'drive247-portal',
    renotify: Boolean(payload.tag),
    requireInteraction: payload.requireInteraction === true,
    data: { url: payload.url || '/', ...(payload.data || {}) },
  };

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
