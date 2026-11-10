/** Where Template 3's home lives while it is previewed beside the other designs. */
export const T3_HOME = '/template-3';

/**
 * Template 3 has built its home only. Every other link opens the site's
 * current page for that address until Template 3 has its own; add pages
 * here as they are built (same idea as template-2/links.ts).
 */
export const T3_PAGES: Record<string, string> = {};

export const t3Href = (href: string) => (href === '/' ? T3_HOME : T3_PAGES[href] ?? href);
