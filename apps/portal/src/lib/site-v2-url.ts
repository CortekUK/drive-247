/**
 * Where the tenant's v2 website (`v2/apps/web`) is served.
 *
 * Separate from `getBookingBaseUrl` on purpose: that resolves the v1 booking
 * app for most tenants, which in dev runs on 4001 (v2 web is on 3000 — see
 * v2/apps/web/package.json). The two must never be confused, because the
 * portal embeds THIS one in an iframe and talks to it by origin; embedding the
 * wrong app is a silent, blank preview.
 *
 * Production: NEXT_PUBLIC_SITE_V2_URL_TEMPLATE if set, else `{slug}.drive-247.com`.
 * Which app answers `{slug}.drive-247.com` is decided by Vercel's domain
 * assignment, not by code. As of 19 Sep 2026 northwind.drive-247.com is still
 * attached to the OLD booking app, so until that domain is moved to the v2
 * project, production needs the template set to the v2 project's address.
 */
/** Must match `next dev --port` in v2/apps/web/package.json. */
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
