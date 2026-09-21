/**
 * Where an old-site page lives on a tenant's custom site. Used by src/middleware.ts.
 *
 * A tenant with the custom site switched on in Super Admin (`booking_v2_enabled`
 * AND `custom_site_eligible`) must not keep a second, older website running
 * beside it. Their home page (`/`) already serves the custom site — see
 * src/app/(legacy)/custom-booking-page/tenant-site.ts — and every other public
 * page of the old site is sent to its counterpart here.
 *
 * Only the old site's own PAGES move. The booking funnel the custom site embeds
 * (checkout, payment results, pay/offer links, verification, sign-in callbacks)
 * and the customer portal are shared by both sites and are left alone: they are
 * the addresses Stripe, emails and SMS send people to.
 *
 * No Next.js imports: this is plain logic so it can be tested directly.
 */

/** Where the custom site's routes live inside the booking app. */
export const CUSTOM_SITE_PREFIX = '/custom-booking-page';

/** Old-site section (first path segment) → the custom site's page for it. */
export const OLD_PAGE_TO_CUSTOM: Readonly<Record<string, string>> = {
  about: 'about',
  blog: 'blog',
  contact: 'contact',
  faq: 'faq',
  fleet: 'fleet',
  privacy: 'privacy',
  promotions: 'promotions',
  terms: 'terms',
  testimonials: 'reviews',
};

/**
 * The custom-site path an old-site page moves to, or null when the path is not
 * an old-site page (the home page, the booking funnel, the customer portal,
 * the custom site itself, or anything unknown).
 */
export function customSitePathFor(pathname: string): string | null {
  const [first = '', ...rest] = pathname.split('/').filter(Boolean);
  const target = OLD_PAGE_TO_CUSTOM[first];
  if (!target) return null;

  // A blog post keeps its slug — the custom site has the same posts. Any other
  // deeper old address folds into its section page.
  if (first === 'blog' && rest.length === 1) {
    return `${CUSTOM_SITE_PREFIX}/blog/${rest[0]}`;
  }
  return `${CUSTOM_SITE_PREFIX}/${target}`;
}

/** The two switches, as the booking site reads them. Both must be on. */
export function isCustomSiteOn(
  row: { booking_v2_enabled?: boolean | null; custom_site_eligible?: boolean | null } | null | undefined,
): boolean {
  return !!row?.booking_v2_enabled && !!row?.custom_site_eligible;
}
