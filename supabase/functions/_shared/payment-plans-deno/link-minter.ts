// Payment plans — the Deno LinkMinter (engine seam, providers.ts), and the
// token hashing payment-plan-pay uses to find an occurrence from a link.
//
// A plan's emailed link is a STABLE URL on the tenant's booking site —
// `https://{slug}.drive-247.com/pay/plan/<token>` — not a Stripe `cs_…` URL,
// which dies after 24 hours while a due date is known days ahead (design D8).
// Clicking it asks payment-plan-pay to mint (or reuse) a Checkout Session for
// what is owed at that moment.
//
// The token is 32 random bytes (base64url). Only its SHA-256 is stored
// (payment_plan_occurrences.link_token_hash, UNIQUE), so a database read
// cannot be turned into a working payment link. A new token replaces the old
// one; the newest email's link is the one that works.
//
// The booking origin follows the rule every other customer-facing link in
// the edge functions uses (send-payg-reminders, installment-pay-link,
// auto-extend-rentals): BOOKING_BASE_URL overrides for single-domain setups,
// otherwise https://{tenant slug}.{BOOKING_BASE_DOMAIN || drive-247.com}.

import type { LinkMinter } from "../payment-plans/providers.ts";

export function deriveBookingOrigin(tenantSlug: string): string {
  const fullOverride = Deno.env.get("BOOKING_BASE_URL");
  if (fullOverride) return fullOverride.replace(/\/+$/, "");
  const baseDomain = Deno.env.get("BOOKING_BASE_DOMAIN") || "drive-247.com";
  return `https://${tenantSlug}.${baseDomain}`;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 of a link token, lowercase hex — what link_token_hash stores. */
export async function hashLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A token as the booking page hands it over: base64url, 43 characters for 32 bytes. */
export function isWellFormedLinkToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export class DenoLinkMinter implements LinkMinter {
  constructor(private readonly tenantSlug: string) {
    if (!tenantSlug) throw new Error("DenoLinkMinter needs the tenant slug to build the booking-site URL");
  }

  async mint(_occurrenceId: string): Promise<{ token: string; tokenHash: string; url: string }> {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = base64url(bytes);
    const tokenHash = await hashLinkToken(token);
    return { token, tokenHash, url: `${deriveBookingOrigin(this.tenantSlug)}/pay/plan/${token}` };
  }
}
