/**
 * Where a tenant's customer booking site lives — admin-console mirror.
 *
 * MIRROR — the tenant list is duplicated on purpose; admin cannot import from
 * the portal. Canonical: apps/portal/src/lib/booking-url.ts (NEW_BOOKING_APP_TENANTS)
 * and apps/portal/src/lib/site-v2-url.ts (the new app's address). Change both.
 *
 * Tenants in NEW_BOOKING_APP_TENANTS use the NEW booking app (v2/apps/web):
 *   - development: http://localhost:3000 — the new app's port, no subdomain;
 *     v2/apps/web/.env.development makes northwind its default tenant there
 *   - production:  NEXT_PUBLIC_SITE_V2_URL_TEMPLATE if set, else https://{slug}.drive-247.com
 * Every other tenant opens the OLD booking app (apps/booking): {slug}.localhost:4001
 * in development, https://{slug}.drive-247.com in production.
 *
 * Keyed on tenant SLUG, not id: the same tenant has a different id in every
 * environment (see lib/lean-tenants.ts).
 */
export const NEW_BOOKING_APP_TENANTS: readonly string[] = ['northwind'];

/** Where the new booking app (v2/apps/web, `next dev --port 3000`) opens in development. */
export const NEW_BOOKING_APP_DEV_URL = 'http://localhost:3000';

/**
 * Port the OLD booking app (apps/booking, `next dev --port 4001`) runs on in
 * development. Not 3000: that is the new app, and sending another tenant there
 * would show it the new app instead of its own site.
 */
export const OLD_BOOKING_APP_DEV_PORT = 4001;

const IS_DEV = process.env.NODE_ENV === 'development';

export function usesNewBookingApp(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return NEW_BOOKING_APP_TENANTS.includes(tenantSlug);
}

/**
 * The production address — for the "Access URLs" card and anything handed to a
 * tenant. Never localhost, in any environment.
 */
export function publicBookingUrl(tenantSlug: string): string {
  if (usesNewBookingApp(tenantSlug)) {
    const template = process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE;
    if (template) return template.replace('{slug}', tenantSlug);
  }
  return `https://${tenantSlug}.drive-247.com`;
}

/**
 * Where a click-through button OPENS the site: the copy running on localhost in
 * development, the production address otherwise.
 */
export function openBookingUrl(tenantSlug: string, isDev: boolean = IS_DEV): string {
  if (usesNewBookingApp(tenantSlug)) {
    // Same order as the portal's getBookingBaseUrl: an explicit template wins.
    if (process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE) return publicBookingUrl(tenantSlug);
    return isDev ? NEW_BOOKING_APP_DEV_URL : publicBookingUrl(tenantSlug);
  }
  return isDev
    ? `http://${tenantSlug}.localhost:${OLD_BOOKING_APP_DEV_PORT}`
    : `https://${tenantSlug}.drive-247.com`;
}
