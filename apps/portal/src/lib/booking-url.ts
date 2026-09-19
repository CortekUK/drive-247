import { SITE_V2_DEV_PORT, getSiteV2BaseUrl } from "./site-v2-url";

/**
 * booking-url — Resolves the customer-facing booking app URL for a tenant.
 *
 * In dev (window.location.hostname includes 'localhost'), the old booking app
 * (apps/booking) runs on OLD_BOOKING_APP_DEV_PORT. In production, both apps share
 * the subdomain (e.g. acme.drive-247.com) — the portal lives at acme.portal.drive-247.com,
 * the booking app at acme.drive-247.com.
 *
 * Tenants in NEW_BOOKING_APP_TENANTS are the exception: their booking site is
 * the new booking app (v2/apps/web).
 */

/**
 * Port the OLD booking app (apps/booking) runs on in development — its own
 * `next dev --port 4001`. Not 3000: that port belongs to the new booking app
 * (v2/apps/web), and a link to {slug}.localhost:3000 would show any tenant the
 * new app instead of its own site.
 */
export const OLD_BOOKING_APP_DEV_PORT = 4001;

/**
 * Where the NEW booking app is opened in development: plain localhost on its
 * port (3000), with no tenant subdomain. v2/apps/web/.env.development makes
 * `northwind` that app's development default tenant, which is what this
 * address shows.
 */
export const NEW_BOOKING_APP_DEV_URL = `http://localhost:${SITE_V2_DEV_PORT}`;

/**
 * Tenants whose booking site is the NEW booking app (v2/apps/web) instead of
 * the old one (apps/booking). Every booking link built here for them goes to
 * the new app: NEW_BOOKING_APP_DEV_URL in development, and in production
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
 * Only ONE tenant can open on plain localhost:3000 — the new app's development
 * default (v2/apps/web/.env.development). A second tenant added here would need
 * its own subdomain URL in development.
 *
 * MIRROR: apps/admin/lib/booking-site-url.ts holds the same list for the super
 * admin (the two apps cannot share a module). Change both together.
 */
export const NEW_BOOKING_APP_TENANTS: readonly string[] = ["northwind"];

export function usesNewBookingApp(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return NEW_BOOKING_APP_TENANTS.includes(tenantSlug);
}

const isLocalBrowser = (): boolean => {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host.includes("localhost") || host === "127.0.0.1";
};

export function getBookingBaseUrl(tenantSlug: string | null | undefined): string {
  if (!tenantSlug) return "";
  if (usesNewBookingApp(tenantSlug)) {
    // An explicit template wins in every environment, as it does for the CMS preview.
    if (!process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE && isLocalBrowser()) return NEW_BOOKING_APP_DEV_URL;
    return getSiteV2BaseUrl(tenantSlug);
  }
  if (typeof window === "undefined") return `https://${tenantSlug}.drive-247.com`;

  if (isLocalBrowser()) {
    // Dev: the old booking app runs on :4001
    return `http://${tenantSlug}.localhost:${OLD_BOOKING_APP_DEV_PORT}`;
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
