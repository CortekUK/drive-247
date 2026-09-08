/**
 * Neutral fallbacks for a tenant who has not filled a field in yet.
 *
 * ── the bug this exists to end ──────────────────────────────────────────────
 *
 * The customer site was written with `settings.company_name || "Drive247"`, in
 * the footer, the navigation, the customer portal header and sidebar, the
 * service highlights, the SEO title and the site-settings defaults themselves.
 *
 * That is not a placeholder. On a multi-tenant platform it means an operator
 * who has not yet typed their company name publishes OUR brand on THEIR
 * website — to their customers, under their domain. The same shape leaked a
 * copyright line reading "© 2026 Drive 247. All rights reserved." onto every
 * unconfigured tenant's footer.
 *
 * A missing tenant value must never resolve to another business's identity.
 * The order is always: the tenant's own value, then a global site setting,
 * then something neutral from this file.
 *
 * ── why these particular strings ────────────────────────────────────────────
 *
 * They have to survive being seen by a real customer, because on a brand-new
 * tenant they will be. So they read as a site mid-setup rather than as a bug:
 * "Your Rental Company" is obviously a placeholder to the operator and
 * harmless to a visitor, where "Drive247" is confidently wrong.
 *
 * Nothing here names a city, a phone number, an address or a person. Those
 * fields fall back to EMPTY instead — an absent phone number renders nothing,
 * which is honest, where an invented one is a support call at best.
 */

/** Used wherever the operator's business name would go. */
export const FALLBACK_COMPANY_NAME = 'Your Rental Company';

/** Alt text for a logo that has not been uploaded. */
export const FALLBACK_LOGO_ALT = 'Company logo';

/** The footer line. Takes the resolved company name so it is never our brand. */
export function fallbackCopyright(companyName?: string | null): string {
  const name = companyName?.trim() || FALLBACK_COMPANY_NAME;
  return `© ${new Date().getFullYear()} ${name}. All rights reserved.`;
}

/**
 * Section headings that named the brand in the template's own copy.
 * Generic, and still sensible on a configured tenant's site.
 */
export const FALLBACK_SERVICE_HIGHLIGHTS_TITLE = 'Why choose us';

/**
 * A page title for SEO. `appName` is resolved first; this is only the last
 * resort, and it deliberately describes the SERVICE rather than a company.
 */
export const FALLBACK_APP_NAME = 'Car Rental';
