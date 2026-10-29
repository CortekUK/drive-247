/**
 * Which booking design a request gets. Used by src/middleware.ts.
 *
 * The booking app serves every tenant on one port and one domain pattern
 * ({slug}.drive-247.com; {slug}.localhost:3000 in development). It holds two
 * designs:
 *
 *   original  src/app/(legacy)/...                       every tenant, unchanged
 *   new       src/app/(northwind)/northwind-site/...       NEW_DESIGN_TENANTS only
 *   new v2    src/app/(northwind-v2)/northwind-site-v2/... NEW_DESIGN_TENANTS, when the
 *             super admin's Developer-tab switch (or a ?site=v2 preview) says v2
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

/** Where the new design's v2 (the redesign of the redesign) lives. Never shown to a visitor. */
export const NEW_DESIGN_V2_PREFIX = '/northwind-site-v2';

/**
 * 'v1' = the new design as it is today; 'v2' = its redesign, being built beside
 * it. Chosen by the super admin's Developer tab (admin_settings.northwind_site_version)
 * or a `?site=v1|v2` preview. Anything unreadable is 'v1'.
 */
export type SiteVersion = 'v1' | 'v2';

/**
 * First path segments v2 has a page for that still follow the Developer-tab
 * switch: served from v2 only when it says v2, from v1 otherwise. Empty since
 * Oct 18 2026, when every page v2 had built moved to V2_ONLY_SEGMENTS. A page
 * v2 has not built is served by v1, so a visitor never lands on a dead link.
 */
export const V2_BUILT_SEGMENTS: readonly string[] = [];

/**
 * First path segments that open from v2 whatever the Developer-tab switch says.
 * Since Oct 18 2026 (Ghulam: the new design "on the normal link") that is the
 * whole public site and the customer portal: Northwind's visitors get the v2
 * page at the normal address. '' is the home page; `portal` is the customer
 * portal (its folder is `portal-v2`, see V2_SEGMENT_FOLDERS). Only `admin`, a
 * v1 placeholder, still opens from v1.
 *
 * `template-2` is the booking site's second design ("Glass", Oct 29 2026) on a
 * temporary preview link while it is built — see src/northwind-site/template-2.
 */
export const V2_ONLY_SEGMENTS: readonly string[] = [
  '',
  'about',
  'blog',
  'booking',
  'contact',
  'fleet',
  'forgot-password',
  'login',
  'portal',
  'privacy',
  'promotions',
  'register',
  'reviews',
  'signup',
  'template-2',
  'terms',
];

/**
 * v2 pages whose folder is named differently from the address the visitor sees.
 * The customer portal v2 is built in `northwind-site-v2/portal-v2/` beside v1's
 * `(portal)/portal/`, but it is served at the normal `/portal` link:
 * `/portal/...` renders from `portal-v2/...` with the address unchanged.
 */
export const V2_SEGMENT_FOLDERS: Readonly<Record<string, string>> = { portal: 'portal-v2' };

/**
 * Addresses that are no longer shown to anyone, and where the browser goes
 * instead (307): the portal v2's old preview link `/portal-v2/...` lands on the
 * same screen at `/portal/...`, so a bookmark or a sent link keeps working.
 */
export const RETIRED_ADDRESSES: Readonly<Record<string, string>> = { 'portal-v2': 'portal' };

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
  // 'register' (customer invite links) moved to the new design for northwind
  // on Oct 2 2026 — (northwind)/northwind-site/register/[token]. Every other
  // tenant never reads this list and keeps (legacy)/register.
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
  | { action: 'not-found' }
  /** A retired address: send the browser to the one that replaced it (307). */
  | { action: 'redirect'; path: string };

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
  siteVersion: SiteVersion = 'v1',
): BookingDesignRoute {
  if (usesNewDesign(tenantSlug)) {
    // Already inside the new design (an internal request, or someone who typed it).
    if (isUnder(pathname, NEW_DESIGN_PREFIX)) return { action: 'original' };
    if (isUnder(pathname, NEW_DESIGN_V2_PREFIX)) return { action: 'original' };
    if (ORIGINAL_ONLY_SEGMENTS.includes(firstSegment(pathname))) return { action: 'original' };
    const segment = firstSegment(pathname);
    const rest = pathname.slice(segment.length + 1);
    if (Object.hasOwn(RETIRED_ADDRESSES, segment)) {
      return { action: 'redirect', path: `/${RETIRED_ADDRESSES[segment]}${rest}` };
    }
    const fromV2 =
      V2_ONLY_SEGMENTS.includes(segment) || (siteVersion === 'v2' && V2_BUILT_SEGMENTS.includes(segment));
    if (fromV2 && Object.hasOwn(V2_SEGMENT_FOLDERS, segment)) {
      return { action: 'new-design', path: `${NEW_DESIGN_V2_PREFIX}/${V2_SEGMENT_FOLDERS[segment]}${rest}` };
    }
    const prefix = fromV2 ? NEW_DESIGN_V2_PREFIX : NEW_DESIGN_PREFIX;
    return { action: 'new-design', path: pathname === '/' ? prefix : `${prefix}${pathname}` };
  }

  // Every other tenant, and requests with no tenant at all.
  if (isUnder(pathname, NEW_DESIGN_PREFIX)) return { action: 'not-found' };
  if (isUnder(pathname, NEW_DESIGN_V2_PREFIX)) return { action: 'not-found' };
  // Moved here from next.config.ts `redirects()`, which runs before the
  // middleware and so could not tell tenants apart. Same paths, same 307.
  if (isUnder(pathname, '/booking')) return { action: 'redirect-home' };
  return { action: 'original' };
}
