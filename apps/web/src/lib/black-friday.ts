/**
 * Black Friday 2026: BF30, 30% off the first 3 monthly payments.
 *
 * Neema's offer (24 Nov 2026). It runs from the moment it is deployed until
 * Mon 30 Nov, 11:59pm Eastern (Tue 1 Dec 04:59:59 UTC), and switches itself
 * off by the clock: the banner goes, auto-apply stops and the exit popup is
 * WELCOME20 again. Nobody has to remember to turn it off. The code itself
 * (platform_promo_codes.expires_at) expires at the same moment on the server,
 * so a stale cookie or a wrong device clock can never get the discount late:
 * the card step drops a refused code and carries on at the full price.
 *
 * During the window every new signup gets BF30, wherever they came from. It
 * replaces any other code (DRIVE20, WELCOME20, a referral): one discount per
 * account, never stacked.
 *
 * Testing (staging, local): add `?bf_now=2026-12-02T00:00:00Z` to any page to
 * pretend it is that moment. It is remembered for the tab and ignored on
 * drive-247.com itself.
 */

export const BLACK_FRIDAY_CODE = "BF30";
export const BLACK_FRIDAY_PERCENT = 30;
export const BLACK_FRIDAY_MONTHS = 3;

/** Inclusive start. Before the deploy anyway, so "live" means "deployed". */
export const BLACK_FRIDAY_START = Date.parse("2026-11-24T00:00:00Z");
/** Mon 30 Nov 2026, 11:59:59pm Eastern. Same instant as the code's expires_at. */
export const BLACK_FRIDAY_END = Date.parse("2026-12-01T04:59:59Z");

/** The codes BF30 replaces by name in the copy ("one discount per account"). */
export const BLACK_FRIDAY_REPLACES = ["WELCOME20", "DRIVE20"] as const;

export const BLACK_FRIDAY_BANNER_TEXT = "Black Friday: 30% off your first 3 months. Ends Monday 30 Nov.";
export const BLACK_FRIDAY_HEADLINE = "Black Friday: 30% off your first 3 months";
export const BLACK_FRIDAY_FINE_PRINT =
  "30% off your first 3 monthly payments after the 14-day free trial. New accounts only. Offer ends Mon 30 Nov 2026, 11:59pm ET.";

export const BF_NOW_PARAM = "bf_now";
const BF_NOW_STORAGE_KEY = "d247.bfNow";

/** drive-247.com itself never honours the test clock. */
export function isProductionHost(host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase().split(":")[0];
  return h === "drive-247.com" || h === "www.drive-247.com";
}

/** A `?bf_now=` value as epoch ms, or null. */
export function parseBlackFridayNow(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const t = Date.parse(value.trim());
  return Number.isFinite(t) ? t : null;
}

/** Is the offer on at this instant? */
export function isBlackFridayAt(nowMs: number): boolean {
  return nowMs >= BLACK_FRIDAY_START && nowMs <= BLACK_FRIDAY_END;
}

/**
 * Browser only: "now" for the offer. The real clock, unless this tab carries a
 * test clock (`?bf_now=`, staging and local only).
 */
export function blackFridayNowInBrowser(): number {
  if (typeof window === "undefined") return Date.now();
  if (isProductionHost(window.location.hostname)) return Date.now();
  try {
    const fromUrl = parseBlackFridayNow(new URLSearchParams(window.location.search).get(BF_NOW_PARAM));
    if (fromUrl !== null) {
      window.sessionStorage.setItem(BF_NOW_STORAGE_KEY, String(fromUrl));
      return fromUrl;
    }
    const stored = Number(window.sessionStorage.getItem(BF_NOW_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : Date.now();
  } catch {
    return Date.now();
  }
}

/** Browser only: is the offer on for this visitor right now? */
export function isBlackFridayInBrowser(): boolean {
  return isBlackFridayAt(blackFridayNowInBrowser());
}

/**
 * The code a new signup uses. During the offer always BF30, whatever was
 * carried; outside it, whatever was carried (a BF30 left in a cookie after the
 * end is refused by the server and dropped at the card step).
 */
export function signupCodeFor(carried: string | null, offerOn: boolean): string | null {
  return offerOn ? BLACK_FRIDAY_CODE : carried;
}

/**
 * 30% off in whole cents, half up: a PREVIEW for plans the server has not been
 * asked about yet (the "Change plan" list). The card step shows the server's
 * figure (feat-001 spec 08.12). Same rule as `promoBillCents` in
 * supabase/functions/_shared/platform-promo-rules.ts; the spec 08 eval checks
 * the two agree. (It used to return a fraction of a cent for odd amounts.)
 */
export function blackFridayCents(amountCents: number): number {
  return Math.floor((amountCents * (100 - BLACK_FRIDAY_PERCENT) + 50) / 100);
}

/** "$160.30" / "$229" from cents. */
export function formatUsdCents(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}
