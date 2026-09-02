import type { CbpThemeConfig } from "./theme";

/**
 * The tenant identity used for the FIRST paint.
 *
 * `TenantContext` resolves the tenant in the browser, from `window.location`,
 * after mount — so on the server render and the first client render there is
 * no tenant, and the branding hook answers with the platform's defaults. On a
 * site whose whole purpose is to be the operator's own, that means their
 * customers would see the platform name in the header, in the headline and in
 * the copyright until the round trip lands, then watch it change.
 *
 * The middleware has already identified the tenant by then: it puts the slug
 * in `x-tenant-slug`, which is where the root layout gets its metadata and its
 * theme. This does the same for this site's identity and colours, so the
 * markup is correct before a single byte of JavaScript runs.
 *
 * Deliberately a plain module with no server imports, so the server pages that
 * build a seed and the client components that consume one can share it.
 */

/**
 * A tenant row's palette, as the theme layer wants it. The overrides live in a
 * jsonb column so a brand that pins its own grounds needs no schema change;
 * anything missing or malformed simply falls back to the derived value.
 */
export function toThemeConfig(row: Record<string, unknown> | null | undefined): CbpThemeConfig | null {
  if (!row) return null;
  const accent = (row.custom_site_accent_color as string | null) ?? null;
  const extra = (row.custom_site_theme ?? null) as Record<string, unknown> | null;

  // Every string key of the stored object is carried through. It used to name
  // three keys explicitly, which meant a palette could be saved in full and
  // silently arrive with most of itself missing — the grounds and text applied,
  // the borders and placeholders did not. `accentCss` validates each value as
  // a hex and ignores anything it does not recognise, so passing them all on is
  // safe and adding a key later needs no change here.
  const config: CbpThemeConfig = { accent };
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (typeof value === "string") (config as Record<string, unknown>)[key] = value;
  }
  return Object.values(config).some(Boolean) ? config : null;
}

export interface CbpSeed {
  name: string;
  logoUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  /** The operator's palette: accent plus any grounds their brand pins down. */
  theme: CbpThemeConfig | null;
}

/**
 * Columns a seed needs, as one string so a caller already querying `tenants`
 * can fold it into that select rather than making a second round trip.
 */
// One colour column, and only one: the template's palette is fixed apart from
// the accent the operator sets for this site. Seeded so a tenant on a custom
// accent does not paint in the default purple and then swap.
export const CBP_SEED_COLUMNS =
  "app_name, company_name, logo_url, meta_title, meta_description, " +
  "custom_site_accent_color, custom_site_theme";

/** Narrow a `tenants` row to a seed. Returns null when the row is unusable. */
export function toCbpSeed(row: Record<string, unknown> | null | undefined): CbpSeed | null {
  if (!row) return null;
  const name = (row.app_name || row.company_name) as string | null;
  if (!name) return null;
  return {
    name,
    logoUrl: (row.logo_url as string | null) ?? null,
    metaTitle: (row.meta_title as string | null) ?? null,
    metaDescription: (row.meta_description as string | null) ?? null,
    theme: toThemeConfig(row),
  };
}
