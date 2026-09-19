import { getSiteV2BaseUrl } from "./site-v2-url";

/**
 * booking-url — Resolves the customer-facing booking app URL for a tenant.
 *
 * In dev (window.location.hostname includes 'localhost'), the booking app runs
 * on port 3000 alongside the portal on 3001. In production, both apps share
 * the subdomain (e.g. acme.drive-247.com) — the portal lives at acme.portal.drive-247.com,
 * the booking app at acme.drive-247.com.
 *
 * Tenants in NEW_BOOKING_APP_TENANTS are the exception: their booking site is
 * the new booking app (v2/apps/web), resolved by `getSiteV2BaseUrl`.
 */

/**
 * Tenants whose booking site is the NEW booking app (v2/apps/web) instead of
 * the old one (apps/booking). Every booking link built here for them goes to
 * the new app: http://{slug}.localhost:4006 in development, and in production
 * NEXT_PUBLIC_SITE_V2_URL_TEMPLATE if set, otherwise https://{slug}.drive-247.com.
 *
 * Keyed on tenant SLUG, not id, for the same reason as the lean gate: the same
 * tenant has a different id in every environment (northwind is 6e5c544f-… in
 * production and 8e6bc88f-… on staging), so an id here would silently match
 * nothing on localhost.
 *
 * Deliberately its own list rather than LEAN_TENANTS: the lean list can grow
 * for reasons that have nothing to do with which booking app a tenant uses, and
 * a tenant added there must not be moved to a different site by accident.
 *
 * MIRROR: apps/admin/lib/booking-site-url.ts holds the same list for the super
 * admin (the two apps cannot share a module). Change both together.
 */
export const NEW_BOOKING_APP_TENANTS: readonly string[] = ["northwind"];

export function usesNewBookingApp(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return NEW_BOOKING_APP_TENANTS.includes(tenantSlug);
}

export function getBookingBaseUrl(tenantSlug: string | null | undefined): string {
  if (!tenantSlug) return "";
  if (usesNewBookingApp(tenantSlug)) return getSiteV2BaseUrl(tenantSlug);
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
