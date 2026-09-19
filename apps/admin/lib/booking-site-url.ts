/**
 * Where a tenant's customer booking site lives — admin-console mirror.
 *
 * MIRROR — the tenant list is duplicated on purpose; admin cannot import from
 * the portal. Canonical: apps/portal/src/lib/booking-url.ts (NEW_BOOKING_APP_TENANTS)
 * and apps/portal/src/lib/site-v2-url.ts (the new app's address). Change both.
 *
 * Tenants in NEW_BOOKING_APP_TENANTS use the NEW booking app (v2/apps/web):
 *   - development: http://{slug}.localhost:4006 (the new app needs the subdomain
 *     to know the tenant; bare localhost:4006 serves no tenant)
 *   - production:  NEXT_PUBLIC_SITE_V2_URL_TEMPLATE if set, else https://{slug}.drive-247.com
 * Every other tenant resolves exactly as before this file existed.
 *
 * Keyed on tenant SLUG, not id: the same tenant has a different id in every
 * environment (see lib/lean-tenants.ts).
 */
export const NEW_BOOKING_APP_TENANTS: readonly string[] = ['northwind'];

/** Port the new booking app (v2/apps/web) runs on in development. */
export const NEW_BOOKING_APP_DEV_PORT = 4006;

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
    // Same order as the portal's getSiteV2BaseUrl: an explicit template wins.
    if (process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE) return publicBookingUrl(tenantSlug);
    return isDev ? `http://${tenantSlug}.localhost:${NEW_BOOKING_APP_DEV_PORT}` : publicBookingUrl(tenantSlug);
  }
  return isDev ? `http://${tenantSlug}.localhost:3000` : `https://${tenantSlug}.drive-247.com`;
}
