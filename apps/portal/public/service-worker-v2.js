// Portal service worker, v2 — northwind canary only (notifications v2, D14).
//
// WHO GETS THIS FILE
//   `components/push/service-worker-registrar.tsx` registers this script
//   INSTEAD of /service-worker.js when the tenant is on v2 chrome
//   (`useV2('chrome')`). Every other tenant keeps /service-worker.js, which is
//   unchanged. Both use scope '/', so registering this script replaces the v1
//   worker for that one tenant's origin only. Push subscriptions belong to the
//   registration, not the script, so they carry over; switching the tenant
//   back to v1 registers /service-worker.js again and swaps back the same way.
//
// SAME AS V1 (copied, keep them in step)
//   install/activate (skipWaiting + clients.claim), the navigation-only fetch
//   handler with its offline page and NO caching (Chrome only offers to install
//   a site whose worker has a fetch handler), the malformed-payload fallback,
//   and pushsubscriptionchange.
//
// ADDED IN V2
//   push
//    - `actions` from the payload: the "Open in app" button. Chromium only;
//      Safari and Firefox ignore them. Only { action, title } strings are kept,
//      capped at Notification.maxActions where the browser says what that is.
//    - `silent` from the payload: no sound or vibration.
//    - `renotify` as its own field. It only applies with a tag the SENDER chose
//      (Chromium throws on renotify without a tag). A payload that does not
//      mention renotify keeps v1's rule, "re-alert whenever a tag was sent",
//      because send-push always sends a tag and never renotify: without this
//      every repeat test would replace the last one silently.
//    - `data.notificationKey`, next to `data.url`.
//    - if the browser refuses the richer options, a plain notification is
//      shown instead. iOS revokes push permission from a site that receives a
//      push without showing anything, so nothing here may end silently.
//   notificationclick
//    - only opens pages on this portal's own origin; anything else opens '/'.
//    - event.action '' (a tap on the body) or 'open' (the button): focus a
//      window of this portal and navigate it, or open one if there is none.
//      navigate() rejects on a window this worker does not control, so that
//      falls back to openWindow instead of doing nothing.
//    - any other action: open the page in a new window.

const OFFLINE_HTML = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;
min-height:100vh;margin:0;background:#f8fafc;color:#0f172a;text-align:center;padding:24px}
h1{font-size:20px;font-weight:600;margin:0 0 8px}p{color:#64748b;margin:0;font-size:14px}</style>
<h1>You're offline</h1><p>Reconnect to load the portal.</p>`;

const DEFAULT_TAG = 'drive247-portal';

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

/** Keep only well-formed { action, title } pairs, capped at what the browser can show. */
function pickActions(raw) {
  if (!Array.isArray(raw)) return [];
  const list = [];
  for (const item of raw) {
    if (
      item &&
      typeof item.action === 'string' &&
      item.action !== '' &&
      typeof item.title === 'string' &&
      item.title !== ''
    ) {
      list.push({ action: item.action, title: item.title });
    }
  }
  const max =
    typeof Notification !== 'undefined' && typeof Notification.maxActions === 'number'
      ? Notification.maxActions
      : list.length;
  return list.slice(0, Math.max(0, max));
}

/** The showNotification() options for one push payload. */
function buildNotificationOptions(payload) {
  const ownTag = typeof payload.tag === 'string' && payload.tag !== '' ? payload.tag : null;
  const renotify = ownTag ? (typeof payload.renotify === 'boolean' ? payload.renotify : true) : false;

  const extra = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const data = Object.assign({ url: payload.url || '/' }, extra);
  const notificationKey =
    typeof payload.notificationKey === 'string' && payload.notificationKey !== ''
      ? payload.notificationKey
      : typeof extra.notificationKey === 'string' && extra.notificationKey !== ''
        ? extra.notificationKey
        : null;
  if (notificationKey) data.notificationKey = notificationKey;

  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: ownTag || DEFAULT_TAG,
    renotify,
    requireInteraction: payload.requireInteraction === true,
    silent: payload.silent === true,
    timestamp: Date.now(),
    data,
  };
  // Ignored by browsers that do not support it, so it needs no feature check.
  if (payload.image) options.image = payload.image;
  const actions = pickActions(payload.actions);
  if (actions.length > 0) options.actions = actions;
  return options;
}

self.addEventListener('push', (event) => {
  // iOS revokes push permission from sites that receive a push without showing
  // a notification, so every path here ends in showNotification() — including
  // the malformed-payload fallback and a refused set of options.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    const raw = event.data ? event.data.text() : '';
    payload = { title: 'Drive247', body: raw.slice(0, 200) };
  }
  if (!payload || typeof payload !== 'object') payload = {};

  const title = payload.title || 'Drive247';
  const options = buildNotificationOptions(payload);

  event.waitUntil(
    Promise.resolve()
      .then(() => self.registration.showNotification(title, options))
      .catch((err) => {
        console.error('[SW v2] showNotification refused the options, showing a plain one:', err);
        return self.registration.showNotification(title, {
          body: options.body,
          icon: options.icon,
          badge: options.badge,
          tag: options.tag,
          data: options.data,
        });
      })
  );
});

/** An absolute URL on this portal's own origin; '/' for anything else or anything malformed. */
function sameOriginTarget(raw) {
  const origin = self.location.origin;
  try {
    const url = new URL(typeof raw === 'string' && raw !== '' ? raw : '/', origin);
    if (url.origin === origin) return url.href;
  } catch (err) {
    // Malformed: fall through to the home page.
  }
  return new URL('/', origin).href;
}

function openTarget(targetUrl) {
  return self.clients.openWindow ? self.clients.openWindow(targetUrl) : Promise.resolve(null);
}

/** A window of this portal: the focused one, else a visible one, else the first. */
function pickClient(clientList) {
  const origin = self.location.origin;
  const mine = clientList.filter((client) => {
    try {
      return new URL(client.url).origin === origin;
    } catch (err) {
      return false;
    }
  });
  return (
    mine.find((client) => client.focused) ||
    mine.find((client) => client.visibilityState === 'visible') ||
    mine[0] ||
    null
  );
}

async function focusOrOpen(targetUrl) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = pickClient(clientList);
  if (!client) return openTarget(targetUrl);

  // Focus first, while the click still allows it; navigating can take a while.
  try {
    if (typeof client.focus === 'function') await client.focus();
  } catch (err) {
    // Not allowed to focus: navigating (or opening) below still gets them there.
  }
  // Already on that page: don't reload it (it may hold unsaved work).
  if (client.url === targetUrl) return client;
  if (typeof client.navigate !== 'function') return openTarget(targetUrl);
  try {
    const navigated = await client.navigate(targetUrl);
    return navigated || client;
  } catch (err) {
    // navigate() rejects on a window this worker does not control.
    return openTarget(targetUrl);
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = sameOriginTarget(data.url);
  const action = event.action || '';

  if (action === '' || action === 'open') {
    event.waitUntil(focusOrOpen(targetUrl));
    return;
  }
  // A button this worker does not know: still take them somewhere useful.
  event.waitUntil(openTarget(targetUrl));
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
