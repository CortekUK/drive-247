/** Where Template 2's home lives while it is previewed beside the first design. */
export const T2_HOME = '/template-2';

/**
 * The pages Template 2 has built so far, by the address the first design uses.
 * Links to these open Template 2's own page; every other link still opens the
 * first design's until its glass page exists. Plain module (no 'use client'),
 * so the server-rendered footer can use it too.
 */
export const T2_PAGES: Record<string, string> = {
  '/fleet': '/template-2/fleet',
  '/promotions': '/template-2/promotions',
  '/reviews': '/template-2/reviews',
  '/about': '/template-2/about',
  '/contact': '/template-2/contact',
  '/privacy': '/template-2/privacy',
  '/terms': '/template-2/terms',
  '/blog': '/template-2/blog',
  '/booking': '/template-2/booking',
  '/login': '/template-2/login',
  '/signup': '/template-2/signup',
  '/forgot-password': '/template-2/forgot-password',
};
export const t2Href = (href: string) =>
  T2_PAGES[href] ?? (href.startsWith('/blog/') ? `${T2_HOME}${href}` : href);

/** A car's own page (`vehicleHref`, /booking/<id>?trip) on Template 2's preview link. */
export const t2CarHref = (href: string) => (href.startsWith('/booking/') ? `${T2_HOME}${href}` : href);
