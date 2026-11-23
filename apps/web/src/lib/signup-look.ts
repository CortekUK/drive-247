/**
 * The look a new operator picks on the signup's business page (Ghulam,
 * 2026-11-23: "pick the color and the theme ... very natural and subtle").
 *
 * The colours are the v2 portal's own brand swatches (V2_BRAND_PRESETS in
 * apps/portal/src/lib/appearance/presets.ts), so the pick is a swatch the
 * operator will find ticked in Settings → Branding later. `signup-provision`
 * accepts only these values (supabase/functions/_shared/signup-look.ts, the
 * same list; tests/integrations/signup/signup-look.test.ts holds them together)
 * and writes the colour to the portal and booking site, and the theme to the
 * booking site's starting look (`tenants.customer_theme_mode`).
 */

// Relative-import safe: no "@/" here, tests/integrations imports this file.

export const SIGNUP_BRAND_COLORS = [
  // The v2 default. Named for its hue here: "Default" means nothing to
  // someone who has never seen the portal.
  { id: "indigo", name: "Indigo", hex: "#442DD7" },
  { id: "blue", name: "Blue", hex: "#2563EB" },
  { id: "teal", name: "Teal", hex: "#0F766E" },
  { id: "rose", name: "Rose", hex: "#BE123C" },
  { id: "graphite", name: "Graphite", hex: "#1E293B" },
] as const;

export const DEFAULT_BRAND_COLOR = SIGNUP_BRAND_COLORS[0].hex;

export type SiteTheme = "light" | "dark";

/** The column's own default: a new booking site starts dark. */
export const DEFAULT_SITE_THEME: SiteTheme = "dark";

export function isBrandColor(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SIGNUP_BRAND_COLORS.some((c) => c.hex === value.trim().toUpperCase())
  );
}

export function isSiteTheme(value: unknown): value is SiteTheme {
  return value === "light" || value === "dark";
}
