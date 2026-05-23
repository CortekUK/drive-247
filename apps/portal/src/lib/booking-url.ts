/**
 * booking-url — Resolves the customer-facing booking app URL for a tenant.
 *
 * In dev (window.location.hostname includes 'localhost'), the booking app runs
 * on port 3000 alongside the portal on 3001. In production, both apps share
 * the subdomain (e.g. acme.drive-247.com) — the portal lives at acme.portal.drive-247.com,
 * the booking app at acme.drive-247.com.
 */
export function getBookingBaseUrl(tenantSlug: string | null | undefined): string {
  if (!tenantSlug) return "";
  if (typeof window === "undefined") return `https://${tenantSlug}.drive-247.com`;

  const host = window.location.hostname;
  if (host.includes("localhost") || host === "127.0.0.1") {
    // Dev: booking app runs on :3000
    return `http://${tenantSlug}.localhost:3000`;
  }
  return `https://${tenantSlug}.drive-247.com`;
}

export function getApplyUrl(tenantSlug: string | null | undefined): string {
  const base = getBookingBaseUrl(tenantSlug);
  return base ? `${base}/apply` : "";
}

export function getOfferUrl(tenantSlug: string | null | undefined, shortCode: string): string {
  const base = getBookingBaseUrl(tenantSlug);
  return base ? `${base}/offer/${shortCode}` : "";
}
