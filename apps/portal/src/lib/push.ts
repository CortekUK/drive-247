/**
 * Shared Web Push client helpers.
 *
 * Platform reality this file exists to absorb:
 *  - Android/Chrome: push works from a normal browser tab. No install needed.
 *  - iOS/Safari: push works ONLY from a PWA added to the Home Screen (16.4+).
 *    In a normal Safari tab `PushManager` is missing entirely, so a naive
 *    "is push supported?" check reports false and the user is told their phone
 *    cannot do it — when in fact they just have not installed it yet. That
 *    distinction is `needsInstall`.
 */

export type PushPlatform = 'ios' | 'android' | 'desktop' | 'unknown';

// Portal-specific key: the operator app and the customer app can be installed
// on the SAME phone, and sharing a device id would let one overwrite the other's
// subscription row.
const DEVICE_ID_KEY = 'd247_portal_push_device_id';

/**
 * A subscription outlives any login, so it is keyed to a device id that is
 * generated once and never cleared on logout — that is what lets a signed-out
 * browser stay reachable and get re-linked when the same person signs back in.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage blocked — a per-session id still beats failing.
    return crypto.randomUUID();
  }
}

export function detectPlatform(): PushPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac; the touch-point count is the standard
  // way to tell a real Mac from an iPad, which needs the iOS install path.
  const isIpadOS = /Macintosh/.test(ua) && typeof document !== 'undefined' && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(ua) || isIpadOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Mobile/.test(ua)) return 'unknown';
  return 'desktop';
}

/** True when the page is running as an installed PWA rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export interface PushCapability {
  /** Push can be enabled right now on this device. */
  supported: boolean;
  /** iOS in a browser tab — capable, but only after "Add to Home Screen". */
  needsInstall: boolean;
  platform: PushPlatform;
  standalone: boolean;
}

export function getPushCapability(): PushCapability {
  const platform = detectPlatform();
  const standalone = isStandalone();

  if (typeof window === 'undefined') {
    return { supported: false, needsInstall: false, platform, standalone };
  }

  const hasApis =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // On iOS the push APIs are absent until the site is installed, so "missing
  // APIs + iOS + not installed" means "install first", never "unsupported".
  if (!hasApis && platform === 'ios' && !standalone) {
    return { supported: false, needsInstall: true, platform, standalone };
  }

  return { supported: hasApis, needsInstall: false, platform, standalone };
}

/**
 * The push service wants the VAPID key as raw bytes, not base64url text.
 *
 * Built over an EXPLICIT ArrayBuffer so the result types as
 * `Uint8Array<ArrayBuffer>` rather than `Uint8Array<ArrayBufferLike>`. Since
 * TS 5.7 the latter is not assignable to `BufferSource` (it could be backed by a
 * SharedArrayBuffer), which `pushManager.subscribe` rejects.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Registers the service worker once per page load.
 *
 * `navigator.serviceWorker.ready` is deliberately awaited rather than trusting
 * the registration object: a freshly registered worker may still be `installing`,
 * and calling `pushManager.subscribe()` on one that is not yet active throws.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register('/service-worker.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .catch((error) => {
      console.error('[push] Service worker registration failed:', error);
      return null;
    });

  return registrationPromise;
}

/**
 * Recover the real error message from a failed `supabase.functions.invoke`.
 *
 * supabase-js reports ANY non-2xx from an edge function as a generic
 * "Edge Function returned a non-2xx status code" and leaves `data` null — so the
 * server's own explanation is discarded and a precise 400 reaches the user as
 * "edge function error", which is unactionable. The original Response is hanging
 * off `error.context`; this digs the message back out of it.
 */
export async function readEdgeFunctionError(
  fnError: unknown,
  fallback = 'Request failed',
): Promise<string> {
  const context = (fnError as { context?: unknown } | null)?.context;

  if (context && typeof (context as Response).clone === 'function') {
    try {
      // Cloned so the caller can still read the body if it wants to.
      const body = await (context as Response).clone().json();
      if (body?.error) return String(body.error);
    } catch {
      try {
        const text = await (context as Response).clone().text();
        if (text) return text.slice(0, 300);
      } catch {
        // Body already consumed or not readable — fall through to the message.
      }
    }
  }

  const message = (fnError as { message?: string } | null)?.message;
  return message || fallback;
}

// ---------------------------------------------------------------------------
// PWA install
//
// Why this matters for push specifically: in a browser TAB, Android attributes
// the notification to the browser — you get Chrome's icon and an origin line
// ("test.por…"), and no payload field can change that; it is Chrome's
// anti-spoofing rule. Once the site is INSTALLED, Android builds a WebAPK and
// the notification carries our icon and app name instead. So "install" is not a
// nice-to-have here, it is the only way to control how the notification looks.
// ---------------------------------------------------------------------------

/** Chrome's non-standard install event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<(available: boolean) => void>();

/**
 * Must be armed at app start.
 *
 * Chrome fires `beforeinstallprompt` ONCE, early, and only if nothing has
 * listened yet — if we wait until the user opens a settings screen the event has
 * long since passed and the install button can never light up. So we capture and
 * park it globally, then hand it to whichever component asks.
 */
export function capturePwaInstallPrompt(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onBeforeInstall = (event: Event) => {
    // Suppress Chrome's own mini-infobar so the install happens from OUR button,
    // in a place where we can explain why it is worth doing.
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    installListeners.forEach((fn) => fn(true));
  };

  const onInstalled = () => {
    deferredInstallPrompt = null;
    installListeners.forEach((fn) => fn(false));
  };

  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('appinstalled', onInstalled);

  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

export function isInstallPromptAvailable(): boolean {
  return deferredInstallPrompt !== null;
}

export function subscribeToInstallAvailability(fn: (available: boolean) => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

/**
 * Shows the native install dialog. Returns true if the user accepted.
 *
 * The parked event is single-use — Chrome refuses a second `prompt()` on the
 * same event — so it is cleared either way.
 */
export async function promptPwaInstall(): Promise<boolean> {
  const event = deferredInstallPrompt;
  if (!event) return false;
  deferredInstallPrompt = null;
  installListeners.forEach((fn) => fn(false));

  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  } catch (error) {
    console.error('[push] Install prompt failed:', error);
    return false;
  }
}

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
