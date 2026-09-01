/**
 * Where this tenant's customer-facing booking site lives.
 *
 * WHY THIS IS NOT JUST `https://${slug}.${BASE_DOMAIN}`
 *
 * That formula is right in production and wrong everywhere else. Running the
 * portal locally on acme.portal.localhost:3001, it still produced
 * https://acme.drive-247.com — so a checkout button opened a tab on PRODUCTION,
 * which 404s because the local build is the only place the new page exists. The
 * operator sees a broken checkout and has no way to tell that the tab simply
 * went to the wrong deployment.
 *
 * The portal and booking apps share a tenant subdomain and differ only by the
 * `.portal` label and the port, so the local origin can be derived from the
 * browser's own location rather than guessed from an env var that describes
 * production.
 *
 * Order of preference:
 *   1. NEXT_PUBLIC_BOOKING_BASE_URL — an explicit override always wins.
 *   2. A local host — derive it, so localhost stays on localhost.
 *   3. https://{slug}.{NEXT_PUBLIC_BOOKING_BASE_DOMAIN || drive-247.com}.
 */

/** Port the booking app runs on in development. Matches `npm run dev:booking`. */
const LOCAL_BOOKING_PORT = "3000";

export function bookingOriginFor(tenantSlug: string | null | undefined): string {
  const explicit = process.env.NEXT_PUBLIC_BOOKING_BASE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;

  const slug = tenantSlug || "app";

  if (typeof window !== "undefined") {
    const host = window.location.hostname; // no port
    // `.localhost` as a suffix, not an equality test: tenant resolution puts the
    // slug in front of it, so the bare-host check that works for a single-tenant
    // app is never true here.
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) {
      // acme.portal.localhost -> acme.localhost
      const bookingHost = host.replace(/\.portal\./, ".");
      return `${window.location.protocol}//${bookingHost}:${LOCAL_BOOKING_PORT}`;
    }
  }

  const baseDomain = process.env.NEXT_PUBLIC_BOOKING_BASE_DOMAIN || "drive-247.com";
  return `https://${slug}.${baseDomain}`;
}
