/**
 * Where the tenant's v2 website is served. The v2 design lives in the booking
 * app (apps/booking/src/northwind-site), so in dev that is the booking app's
 * port, 3000; its middleware picks the v2 design for canary tenants.
 *
 * Kept separate from `getBookingBaseUrl` because the portal embeds THIS one in
 * an iframe and talks to it by origin.
 *
 * Production: `{slug}.drive-247.com`, served by the booking app for every
 * tenant; its middleware routes the canary to the v2 design.
 */
export const SITE_V2_DEV_PORT = 3000;

export function getSiteV2BaseUrl(tenantSlug: string | null | undefined): string {
  if (!tenantSlug) return "";
  const override = process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE;
  if (override) return override.replace("{slug}", tenantSlug);
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("localhost") || host === "127.0.0.1") {
      return `http://${tenantSlug}.localhost:${SITE_V2_DEV_PORT}`;
    }
  }
  return `https://${tenantSlug}.drive-247.com`;
}
