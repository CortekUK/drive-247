/**
 * Meta Pixel helpers for the trial-signup event (StartTrial).
 *
 * The server half is supabase/functions/_shared/meta-capi.ts (sent by
 * signup-provision). Both use the same event id, `<tenantId>_trial`, so Meta
 * counts each signup once.
 */

export const META_PIXEL_ID = "2196369497442053";

/**
 * Runs inline on every page, before the pixel loads (see app/layout.tsx).
 *
 * A visitor who lands from an ad carries `?fbclid=…`. The pixel turns that
 * into the `_fbc` cookie, but only if the pixel script loads on that page;
 * writing it here as well means the click is still credited when the signup
 * happens a few pages later, or the pixel is blocked on the landing page.
 * Format: fb.1.<landing time in ms>.<fbclid>.
 */
export const FBCLID_CAPTURE_SCRIPT = `(function(){try{
var id=new URLSearchParams(location.search).get('fbclid');if(!id)return;
var m=document.cookie.match(/(?:^|; )_fbc=([^;]*)/);
if(m&&decodeURIComponent(m[1]).split('.').slice(3).join('.')===id)return;
var d=/(^|\\.)drive-247\\.com$/.test(location.hostname)?';domain=.drive-247.com':'';
document.cookie='_fbc='+encodeURIComponent('fb.1.'+Date.now()+'.'+id)+';path=/;max-age=7776000;SameSite=Lax'+d+(location.protocol==='https:'?';Secure':'');
}catch(e){}})();`;

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** The ids the server event needs from the browser. */
export function readMetaTracking(): { fbp?: string; fbc?: string; eventSourceUrl?: string } {
  if (typeof window === "undefined") return {};
  return {
    fbp: readCookie("_fbp") ?? undefined,
    fbc: readCookie("_fbc") ?? undefined,
    eventSourceUrl: window.location.href.split("#")[0],
  };
}

type Fbq = (...args: unknown[]) => void;

/**
 * Browser half of StartTrial. Call once, on the server's success response.
 * Safe when the pixel is blocked (does nothing).
 */
export function trackStartTrial(opts: { tenantId: string; email?: string | null; userId?: string | null }) {
  if (typeof window === "undefined") return;
  const fbq = (window as unknown as { fbq?: Fbq }).fbq;
  if (typeof fbq !== "function") return;

  const eventId = `${opts.tenantId}_trial`;
  // Never twice for the same account in this browser (a reload of the success
  // screen, a second tab). Meta would dedupe it, but there is no reason to send it.
  const key = `d247_meta_starttrial_${opts.tenantId}`;
  try {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage blocked: send anyway, dedupe covers repeats.
  }

  try {
    // Advanced matching: the pixel hashes these before they leave the browser.
    const userData: Record<string, string> = {};
    if (opts.email) userData.em = opts.email.trim().toLowerCase();
    if (opts.userId) userData.external_id = opts.userId;
    if (Object.keys(userData).length) fbq("init", META_PIXEL_ID, userData);
    fbq("track", "StartTrial", { currency: "USD", value: 0 }, { eventID: eventId });
  } catch {
    // Tracking must never break the success screen.
  }
}
