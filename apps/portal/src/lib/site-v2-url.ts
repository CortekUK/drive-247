/**
 * Where the tenant's v2 website (`v2/apps/web`) is served.
 *
 * Separate from `getBookingBaseUrl` on purpose: that resolves the v1 booking
 * app, and in dev it hardcodes port 3000, which is not where either app runs
 * here (v2 web is on 4006 — see the root dev scripts). The two must never be
 * confused, because the portal embeds THIS one in an iframe and talks to it by
 * origin; embedding the wrong app is a silent, blank preview.
 *
 * Production: `{slug}.drive-247.com`. Which app answers there is decided by
 * Vercel's domain assignment, not by code — the canary's subdomain is attached
 * to the v2 project, everyone else's stays on v1.
 */
export const SITE_V2_DEV_PORT = 4006;

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
