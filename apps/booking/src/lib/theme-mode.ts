/**
 * Per-tenant customer-site theme mode (tenants.customer_theme_mode).
 *
 * - 'dark'       — default dark, customer can toggle (today's behavior for all tenants)
 * - 'light'      — default light, customer can toggle
 * - 'light_only' — forced light, no toggle
 * - 'dark_only'  — forced dark, no toggle
 */
export type CustomerThemeMode = 'dark' | 'light' | 'light_only' | 'dark_only';

/** The four values that hide the theme toggle and force a single theme. */
export function isForcedThemeMode(
  mode: CustomerThemeMode | null | undefined,
): mode is 'light_only' | 'dark_only' {
  return mode === 'light_only' || mode === 'dark_only';
}

/**
 * Decide the effective dark/light for a tenant, honoring the SERVER-known theme
 * mode over next-themes' resolvedTheme.
 *
 * Why not just trust resolvedTheme: the booking app pins next-themes 0.3.0,
 * whose context does NOT fold `forcedTheme` into `resolvedTheme`. So a returning
 * customer who once picked dark keeps resolvedTheme==='dark' even when the layout
 * forces light — which would otherwise paint the dark palette/logo onto a light
 * page. Deriving from the mode for the forced states fixes that.
 */
export function isDarkForMode(
  mode: CustomerThemeMode | null | undefined,
  resolvedTheme: string | undefined,
): boolean {
  if (mode === 'light_only') return false;
  if (mode === 'dark_only') return true;
  return resolvedTheme === 'dark';
}
