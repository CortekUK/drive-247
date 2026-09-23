/**
 * The Drive247 promo / referral code a visitor carries.
 *
 * Set by /r/{code} (and by typing a code), read by the landing banner, the
 * signup dialog and the payment-link page. A cookie rather than a query string
 * because two redirects in the signup journey drop the query string: Google
 * OAuth (?signup=google) and the Stripe return (/?signup=resume).
 *
 * Deliberately NOT httpOnly: the signup dialog runs in the browser and reads it.
 * It holds nothing secret — a code is something people share on WhatsApp.
 */
export const REFERRAL_COOKIE = "d247_ref";

/** How long a referral link is remembered (the programme default). */
export const REFERRAL_COOKIE_DAYS = 90;

/** Letters, digits and single dashes, uppercased — or null. Matches the server's rule. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  if (!code || code.length > 64) return null;
  return /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code) ? code : null;
}

/** Browser only: the code in the cookie, if any. */
export function readReferralCodeFromDocument(): string | null {
  if (typeof document === "undefined") return null;
  const hit = document.cookie.split("; ").find(c => c.startsWith(`${REFERRAL_COOKIE}=`));
  return hit ? normalizeReferralCode(decodeURIComponent(hit.slice(REFERRAL_COOKIE.length + 1))) : null;
}

/** Browser only: forget the code (it was refused, or the visitor removed it). */
export function clearReferralCodeInDocument(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${REFERRAL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/**
 * Browser only: remember a code — one typed into the signup dialog, or a
 * landing that carried ?ref= without passing through /r/{code}.
 */
export function writeReferralCodeInDocument(code: string): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; Max-Age=${REFERRAL_COOKIE_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax${secure}`;
}
