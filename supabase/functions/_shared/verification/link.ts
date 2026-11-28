// feat-003: the renter's link (spec 05.7, 06.1). `/id/<token>` on the company's booking site.

import { deriveBookingOrigin } from "../booking-origin.ts";

/** 32 random bytes, URL-safe base64, no padding: 43 characters (spec 01.12). */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The booking site for a session made by a staff member (spec 05.7).
 *
 * The portal is always `<slug>.portal.<env>drive-247.com`, where <env> is empty (live), `staging.` or
 * `rayN.`. The booking site for the same environment is the same host without `.portal`. Only those exact
 * shapes, for this company's own slug, over https, are accepted: the header is the caller's, and the
 * result is sent to a customer with a bearer token in it. Anything else falls back to the shared rule.
 */
export function bookingOriginFor(tenantSlug: string, req?: Request): string {
  const origin = req?.headers.get("origin") ?? "";
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const slug = tenantSlug.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const m = new RegExp(`^${slug}\\.portal\\.((?:staging|ray\\d{1,2})\\.)?drive-247\\.com$`).exec(host);
    if (url.protocol === "https:" && m) return `https://${slug}.${m[1] ?? ""}drive-247.com`;
  } catch {
    // not a URL: fall through
  }
  return deriveBookingOrigin(tenantSlug, req);
}

export function renterUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/id/${token}`;
}
