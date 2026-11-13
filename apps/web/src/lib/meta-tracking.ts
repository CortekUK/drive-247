/**
 * Meta (Facebook ads) tracking, browser side.
 *
 * Two jobs:
 *   1. Remember which ad a visitor came from. An ad link carries `?fbclid=...`;
 *      it is on the first page only, and signup happens pages later (after a
 *      Google sign-in or a Stripe redirect, both of which drop the query string).
 *   2. Send `StartTrial` once a new account exists.
 *
 * The server sends the same event through the Conversions API
 * (supabase/functions/_shared/meta-conversions.ts) under the same id, so Meta
 * counts one signup. The pixel itself is loaded in app/layout.tsx.
 *
 * Every function here is browser-only and never throws: tracking must not be
 * able to break the page or the signup.
 */

export const META_PIXEL_ID = "2196369497442053";

/** Our own copy of the ad click id, in Meta's `_fbc` format. */
const CLICK_COOKIE = "d247_fbc";
const CLICK_COOKIE_DAYS = 90;
const SENT_KEY_PREFIX = "d247_start_trial_sent:";

type Fbq = (...args: unknown[]) => void;

function fbq(): Fbq | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { fbq?: Fbq }).fbq;
  return typeof fn === "function" ? fn : null;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find(c => c.startsWith(`${name}=`));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(name.length + 1)) || null;
  } catch {
    return null;
  }
}

/**
 * Call on every page load. When the address carries an ad click id, keep it for
 * 90 days as `fb.1.<landing time in ms>.<fbclid>`, which is the form Meta expects.
 * A newer click replaces an older one.
 */
export function captureAdClick(): void {
  try {
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (!fbclid || fbclid.length > 400 || !/^[\w.-]+$/.test(fbclid)) return;
    const current = readCookie(CLICK_COOKIE);
    if (current?.endsWith(`.${fbclid}`)) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CLICK_COOKIE}=${encodeURIComponent(`fb.1.${Date.now()}.${fbclid}`)}; Max-Age=${CLICK_COOKIE_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* cookies blocked: the signup simply goes uncredited */
  }
}

/** What the signup sends to the server so its event can be tied to the ad click. */
export interface MetaBrowserSignals {
  fbp?: string;
  fbc?: string;
  sourceUrl?: string;
}

/** Meta's own cookies, with our saved click id as the fallback for `_fbc`. */
export function readMetaSignals(): MetaBrowserSignals {
  try {
    const signals: MetaBrowserSignals = {};
    const fbp = readCookie("_fbp");
    if (fbp) signals.fbp = fbp;
    const fbc = readCookie("_fbc") ?? readCookie(CLICK_COOKIE);
    if (fbc) signals.fbc = fbc;
    signals.sourceUrl = `${window.location.origin}${window.location.pathname}`;
    return signals;
  } catch {
    return {};
  }
}

/**
 * Send `StartTrial` from the browser, once per account on this browser.
 *
 * `eventId` must be the id the server used. The email and user id are handed to
 * the pixel for matching; it hashes them itself before anything leaves the page.
 */
export function trackStartTrial(input: { eventId: string; userId: string; email: string }): void {
  try {
    const send = fbq();
    if (!send) return;
    const sentKey = `${SENT_KEY_PREFIX}${input.eventId}`;
    try {
      if (window.localStorage.getItem(sentKey)) return;
      window.localStorage.setItem(sentKey, "1");
    } catch {
      /* storage blocked: Meta still deduplicates on the event id */
    }
    const email = input.email.trim().toLowerCase();
    send("init", META_PIXEL_ID, { ...(email ? { em: email } : {}), external_id: input.userId });
    send("track", "StartTrial", { currency: "USD", value: 0 }, { eventID: input.eventId });
  } catch {
    /* never let tracking break the success screen */
  }
}
