/**
 * Brand-derived surface and ink colours for the customer sign-in v2.
 *
 * A copy of the operator portal v2's `apps/portal/src/components/auth-v2/
 * brand-surface.ts`, so the customer's sign-in wears the same wash, the same
 * dissolve and the same link ink as the operator's. Apps share no code here,
 * so it is copied rather than imported; keep the two in step.
 *
 * Hue comes from the brand, lightness is ours: a pale tint for the panel, and
 * a link colour pushed into a band that reads on white. Achromatic brands
 * (black, white, silver) get a neutral slate rather than hue 0, which is red.
 */

function hexToHSL(hex: string): { h: number; s: number; l: number } | null {
  if (!hex || !hex.startsWith('#')) return null;

  hex = hex.replace('#', '');

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export interface BrandSurface {
  /** A single flat colour, ready for `style={{ backgroundColor }}`. */
  color: string;
  /** True when the panel is light and needs dark type on it. */
  isLight: boolean;
  /** True when the brand had no usable hue, so the surface is neutral. */
  isNeutral: boolean;
}

/** Below this saturation a colour reads as grey, and its hue is just noise. */
const ACHROMATIC_SATURATION = 12;
const TINT_LIGHTNESS = 88;
const TINT_SATURATION_CEILING = 58;
const DEEP_LIGHTNESS = 22;

/** A brand-hued colour safe to use as text on the page. */
export function brandInk(hex: string | null | undefined, isDark: boolean): string {
  const hsl = hex ? hexToHSL(hex) : null;

  if (!hsl || hsl.s < ACHROMATIC_SATURATION) {
    return isDark ? 'hsl(215 16% 76%)' : 'hsl(215 19% 35%)';
  }

  const s = Math.round(Math.min(85, Math.max(35, hsl.s)));
  const l = isDark ? Math.max(hsl.l, 66) : Math.min(hsl.l, 42);
  return `hsl(${hsl.h} ${s}% ${l}%)`;
}

export function brandSurface(hex: string | null | undefined, isDark = false): BrandSurface {
  const hsl = hex ? hexToHSL(hex) : null;

  if (!hsl || hsl.s < ACHROMATIC_SATURATION) {
    return isDark
      ? { color: `hsl(222 14% ${DEEP_LIGHTNESS}%)`, isLight: false, isNeutral: true }
      : { color: `hsl(222 16% ${TINT_LIGHTNESS}%)`, isLight: true, isNeutral: true };
  }

  const s = Math.round(Math.min(80, Math.max(25, hsl.s)));

  if (isDark) {
    return { color: `hsl(${hsl.h} ${s}% ${DEEP_LIGHTNESS}%)`, isLight: false, isNeutral: false };
  }

  return {
    color: `hsl(${hsl.h} ${Math.min(s, TINT_SATURATION_CEILING)}% ${TINT_LIGHTNESS}%)`,
    isLight: true,
    isNeutral: false,
  };
}

/** The wash dissolving into the page, measured against the viewport (smoothstep stops). */
export const WASH_MASK = `linear-gradient(to right,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 34%,
  rgb(0 0 0 / 0.96) 42%,
  rgb(0 0 0 / 0.88) 49%,
  rgb(0 0 0 / 0.74) 56%,
  rgb(0 0 0 / 0.56) 63%,
  rgb(0 0 0 / 0.38) 70%,
  rgb(0 0 0 / 0.22) 77%,
  rgb(0 0 0 / 0.10) 84%,
  rgb(0 0 0 / 0.03) 92%,
  rgb(0 0 0 / 0) 100%)`;

/** The same dissolve for a hero photograph, kept to its own half. */
export const PHOTO_MASK = `linear-gradient(to right,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 55%,
  rgb(0 0 0 / 0.86) 66%,
  rgb(0 0 0 / 0.60) 76%,
  rgb(0 0 0 / 0.32) 86%,
  rgb(0 0 0 / 0.10) 94%,
  rgb(0 0 0 / 0) 100%)`;

/** Phones: the wash comes down from the top edge instead. */
export const MOBILE_WASH_MASK = `linear-gradient(to bottom,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 18%,
  rgb(0 0 0 / 0.88) 34%,
  rgb(0 0 0 / 0.68) 48%,
  rgb(0 0 0 / 0.44) 62%,
  rgb(0 0 0 / 0.22) 76%,
  rgb(0 0 0 / 0.08) 88%,
  rgb(0 0 0 / 0) 100%)`;
