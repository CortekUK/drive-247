/**
 * Which booking design a request gets. Used by src/middleware.ts.
 *
 * The booking app serves every tenant on one port and one domain pattern
 * ({slug}.drive-247.com; {slug}.localhost:3000 in development). It holds two
 * designs:
 *
 *   original  src/app/(legacy)/...                 every tenant, unchanged
 *   new       src/app/(northwind)/northwind-site/... NEW_DESIGN_TENANTS only
 *
 * For a new-design tenant the middleware REWRITES (not redirects) the request
 * into the new design's routes, so the address in the browser never changes:
 * northwind.localhost:3000/fleet renders (northwind)/northwind-site/fleet.
 *
 * No Next.js imports: this is plain logic so it can be tested directly.
 */

/**
 * Tenants who get the new design. Keyed on the tenant SLUG — the value the
 * middleware already resolves from the subdomain or custom domain — not on a
 * database id, which differs per environment (northwind is 6e5c544f-… in
 * production and 8e6bc88f-… on staging), and not on a display name.
 */
export const NEW_DESIGN_TENANTS: readonly string[] = ['northwind'];

/** Where the new design's routes live inside the booking app. Never shown to a visitor. */
export const NEW_DESIGN_PREFIX = '/northwind-site';

/**
 * Pages only the original booking app has, which a new-design tenant still
 * needs: payment and checkout links, payment results, customer invites, and
 * verification and sign-in callbacks. They are addresses other systems send
 * people to (emails, SMS, Stripe), not part of the site's design, so a
 * new-design tenant keeps getting the original page for them.
 */
export const ORIGINAL_ONLY_SEGMENTS: readonly string[] = [
  'auth',
  'apply',
  'booking-cancelled',
  'booking-enquiry-submitted',
  'booking-pending',
  'booking-success',
  'checkout',
  'offer',
  'pay',
  'register',
  'sms-opt-in',
  'verify',
];

export type BookingDesignRoute =
  /** Serve this path from the new design's routes (rewrite, same address). */
  | { action: 'new-design'; path: string }
  /** Serve the request exactly as the original booking app always has. */
  | { action: 'original' }
  /** The original design's retired multi-page /booking flow: back to the home page. */
  | { action: 'redirect-home' }
  /** A request for the new design's internal routes from anyone else: 404. */
  | { action: 'not-found' };

export function usesNewDesign(tenantSlug: string | null | undefined): boolean {
  if (!tenantSlug) return false;
  return NEW_DESIGN_TENANTS.includes(tenantSlug);
}

const firstSegment = (pathname: string): string => pathname.split('/')[1] ?? '';

const isUnder = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function routeBookingRequest(
  tenantSlug: string | null | undefined,
  pathname: string,
): BookingDesignRoute {
  if (usesNewDesign(tenantSlug)) {
    // Already inside the new design (an internal request, or someone who typed it).
    if (isUnder(pathname, NEW_DESIGN_PREFIX)) return { action: 'original' };
    if (ORIGINAL_ONLY_SEGMENTS.includes(firstSegment(pathname))) return { action: 'original' };
    return { action: 'new-design', path: pathname === '/' ? NEW_DESIGN_PREFIX : `${NEW_DESIGN_PREFIX}${pathname}` };
  }

  // Every other tenant, and requests with no tenant at all.
  if (isUnder(pathname, NEW_DESIGN_PREFIX)) return { action: 'not-found' };
  // Moved here from next.config.ts `redirects()`, which runs before the
  // middleware and so could not tell tenants apart. Same paths, same 307.
  if (isUnder(pathname, '/booking')) return { action: 'redirect-home' };
  return { action: 'original' };
}
