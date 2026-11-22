import { brandHslVars } from '@nw/portal-v2/brand';

/** Template 3's own accent when the tenant's brand colour is unusable: the reference's red. */
export const T3_FALLBACK_ACCENT = '#d4202c';

/**
 * The tenant's brand colour as "#rrggbb", or the fallback. Hex rather than
 * hsl() because framer-motion interpolates hex/rgb colours between keyframes
 * (the hero's letter-by-letter reveal runs through it). Same usability test
 * as every other template: brandHslVars rejects greys and near black/white.
 */
export function t3Accent(hex: string | null | undefined): string {
  if (!hex || !brandHslVars(hex)) return T3_FALLBACK_ACCENT;
  return `#${hex.trim().replace(/^#/, '').toLowerCase()}`;
}
