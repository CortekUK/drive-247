const CACHE_NAME = 'supreme-drive-v5';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.error('Cache addAll failed:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET responses are ever cacheable.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // A service worker intercepts EVERY request the page makes, cross-origin
  // included. Without this check the Supabase REST API fell past the guards
  // below into the cache-first branch, so tenant settings were answered from
  // the cache indefinitely — entries are only evicted when CACHE_NAME changes.
  // The visible effect: an operator switched the security deposit off, and the
  // booking site kept showing and charging the old amount on every reload,
  // because that request never reached the network again. Never touch another
  // origin, and never cache anybody's API.
  if (url.origin !== self.location.origin) return;

  // Skip admin routes, API calls, and JavaScript files from caching
  if (url.pathname.startsWith('/admin') ||
      url.pathname.includes('/api/') ||
      url.pathname.includes('node_modules') ||
      url.pathname.includes('/src/')) {
    return;
  }

  // HTML: network-first (fresh content)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then((m) => m || caches.match('/'))
        )
    );
    return;
  }

  // Static assets only: cache-first (images, fonts, icons). Deliberately an
  // allow-list — the previous denylist cached everything it had not been told
  // to skip, so any new data endpoint became cacheable by default.
  if (!/\.(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|css)$/i.test(url.pathname)) return;

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
    )
  );
});


// ---------------------------------------------------------------------------
// Web Push
//
// These handlers run in the service worker, which the OS wakes on an incoming
// push EVEN WHEN NO TAB IS OPEN and the phone is locked. That is what makes
// this a real notification rather than an in-app banner.
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  // iOS enforces this strictly: a push that resolves WITHOUT showing a
  // notification counts as a violation, and Safari revokes the site's push
  // permission after a few of them. So every branch below must end in a
  // showNotification() call — including the malformed-payload path.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    const raw = event.data ? event.data.text() : '';
    payload = { title: 'New notification', body: raw.slice(0, 200) };
  }

  const title = payload.title || 'New notification';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    // Collapses repeats of the same notification instead of stacking duplicates.
    tag: payload.tag || 'drive247',
    renotify: Boolean(payload.tag),
    requireInteraction: payload.requireInteraction === true,
    timestamp: Date.now(),
    data: {
      url: payload.url || '/',
      ...(payload.data || {}),
    },
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
      // Focus an already-open window rather than spawning another one — on iOS a
      // second window replaces the PWA's whole session and loses any
      // in-progress booking.
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

// Push services rotate subscription keys unilaterally. Without this handler the
// old endpoint keeps 410-ing and the device goes quiet with nothing in the UI to
// explain why, so we re-register against the same VAPID key immediately.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey =
          (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) ||
          null;
        if (!applicationServerKey) return;

        const fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        // The SW has no access to the page's env vars, so the re-registration
        // details are handed to any open window, which owns the API call.
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
