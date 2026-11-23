/**
 * The look a new operator picks on the signup's business page (Ghulam,
 * 2026-11-23): a brand colour and a light or dark booking site.
 *
 * The colours are the v2 portal's own brand swatches (V2_BRAND_PRESETS in
 * apps/portal/src/lib/appearance/presets.ts), so whatever is picked here is a
 * swatch the operator will find ticked in Settings → Branding later. The form
 * keeps the same list in apps/web/src/lib/signup-look.ts; a test holds the two
 * together (tests/integrations/signup/signup-look.test.ts).
 *
 * Only these values are accepted. Anything else reads as "not chosen", and the
 * build uses its defaults (the v2 indigo, and the column's own theme default).
 */

/** The v2 default first: what an operator gets who leaves it alone. */
export const SIGNUP_BRAND_COLORS = ["#442DD7", "#2563EB", "#0F766E", "#BE123C", "#1E293B"] as const;

export type SignupSiteTheme = "light" | "dark";

/** An allowed brand colour, upper-cased, or null. */
export function readBrandColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.trim().toUpperCase();
  return (SIGNUP_BRAND_COLORS as readonly string[]).includes(hex) ? hex : null;
}

/**
 * "light" or "dark", or null. Written to `tenants.customer_theme_mode`, the
 * booking site's starting theme; visitors can still switch it (the `_only`
 * values, which lock it, are a Settings choice, not a signup one).
 */
export function readSiteTheme(raw: unknown): SignupSiteTheme | null {
  return raw === "light" || raw === "dark" ? raw : null;
}
