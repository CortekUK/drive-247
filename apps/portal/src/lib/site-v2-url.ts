import { isV2 } from "./v2";

/**
 * Where a tenant's customer website is served.
 *
 * Separate from `getBookingBaseUrl` on purpose: that resolves the v1 booking
 * app, and in dev it hardcodes port 3000, which is not where either app runs
 * here (v2 web is on 4006 — see the root dev scripts). The two must never be
 * confused, because the portal embeds THIS one in an iframe and talks to it by
 * origin; embedding the wrong app is a silent, blank preview.
 *
 * ── why production needed a per-tenant answer ───────────────────────────────
 *
 * This used to return `{slug}.drive-247.com` for everybody, with a comment
 * saying which app answers there "is decided by Vercel's domain assignment,
 * not by code". That is true of a tenant's OWN domain, and it is why the two
 * builders were indistinguishable in production — so "Open website" handed the
 * browser a correct URL and Vercel served v1, on a screen whose whole purpose
 * was editing v2.
 *
 * The domain assignment cannot be the switch here, because it is one hostname
 * per tenant and the canary needs both apps reachable at once: the v2 site to
 * edit, and the live v1 site the tenant's customers are still on.
 *
 * So the canary gets a SECOND hostname. `{slug}.v2.drive-247.com` is parsed
 * correctly by the v2 site's own middleware without any change to it — it
 * strips the base domain and takes the first label, so `northwind.v2` resolves
 * to `northwind` — and it leaves `{slug}.drive-247.com` untouched and still
 * serving v1 to real customers.
 *
 * ── the two things that must be true ────────────────────────────────────────
 *
 * 1. the tenant is on the `site` area in `lib/v2.ts` (northwind only today);
 * 2. `*.v2.drive-247.com`, or that tenant's exact host, is attached to the v2
 *    Vercel project, with that project's Supabase env vars set.
 *
 * Miss (2) and the link points at a hostname that does not resolve. That is
 * why `V2_SITE_HOST` is overridable: set `NEXT_PUBLIC_SITE_V2_HOST` to whatever
 * the v2 project is actually reachable at, and no code has to change.
 *
 * Every tenant NOT on the list keeps exactly what they have today.
 */
export const SITE_V2_DEV_PORT = 4006;

/**
 * The domain the v2 project answers on, for canary tenants.
 *
 * A subdomain OF the platform domain rather than a separate one, so it inherits
 * the existing wildcard certificate and the middleware parses it unchanged.
 */
const V2_SITE_HOST = process.env.NEXT_PUBLIC_SITE_V2_HOST || "v2.drive-247.com";

/** The v1 booking app, and every tenant not on the canary. */
const BASE_HOST = "drive-247.com";

export function getSiteV2BaseUrl(tenantSlug: string | null | undefined): string {
  if (!tenantSlug) return "";

  /* An explicit template wins over everything, including the canary check: it
     exists so a preview deployment or a one-off host can be pointed at without
     editing code. */
  const override = process.env.NEXT_PUBLIC_SITE_V2_URL_TEMPLATE;
  if (override) return override.replace("{slug}", tenantSlug);

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host.includes("localhost") || host === "127.0.0.1") {
      return `http://${tenantSlug}.localhost:${SITE_V2_DEV_PORT}`;
    }
  }

  /* Fails to v1 on every unknown, the same way `isV2` does everywhere else: a
     tenant we cannot identify gets the site they already had. */
  return isV2("site", tenantSlug)
    ? `https://${tenantSlug}.${V2_SITE_HOST}`
    : `https://${tenantSlug}.${BASE_HOST}`;
}
