/**
 * Brand-derived surface and ink colours for the v2 login screen.
 *
 * Ported from `improv/portal-side`'s `src/lib/brand-surface.ts`, but kept
 * INSIDE `components/auth-v2/` rather than in `src/lib/`. V2_PLAN §3: v2 code
 * lives beside v1, never inside it, so retiring this area is deleting one
 * directory. `src/lib/` is shared v1 ground.
 *
 * `hexToHSL` is duplicated here rather than imported. The portal already has
 * one, in `src/hooks/use-dynamic-theme.ts`, but it is module-private (`function
 * hexToHSL`, no `export`) and that file is v1 — exporting it would be an edit
 * to a v1 file for a v2 convenience, which is exactly what the strangler rule
 * forbids. The implementation below is a byte-for-byte copy of it, so the two
 * cannot disagree about what a brand colour is.
 *
 * ---
 *
 * Derives a flat, full-bleed surface from a tenant's brand colour — the login
 * hero today, and anything else that hands a whole panel over to the brand.
 *
 * The obvious source is the chart ramp `use-dynamic-theme` already generates,
 * and it is the wrong one. That ramp floors saturation at 45% so chart series
 * stay apart from each other, which means every *achromatic* brand — black,
 * white, silver, near-black — resolves to hue 0 at 45% saturation. Hue 0 is
 * red. Thirteen of the forty-six live tenants brand themselves `#000000`,
 * `#111111`, `#FFFFFF` or `#C0C0C0`, so a ramp-derived panel would have handed
 * more than a quarter of the estate half a screen of red they never picked.
 * The ramp is right for charts and wrong here; this is the "convert the whole
 * map or none of it" rule pointing the other way.
 *
 * So the split is: hue comes from the brand, lightness is ours. `#90EE90` is a
 * pale mint and `#0B1F2A` is nearly black, but a panel has to be one specific
 * value to be readable, and it is the *hue* that makes it theirs.
 *
 * One flat colour, not a ramp. A gradient across a panel this large reads as
 * two colours however tight the stops are, which is the thing the brand is
 * least able to afford here.
 */

/**
 * Convert hex to HSL values (just the numbers, not the full string).
 *
 * Copied verbatim from `src/hooks/use-dynamic-theme.ts` — see the note above
 * for why it is not imported.
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
  /**
   * True when the panel is light and therefore needs dark type on it. Callers
   * must branch on this rather than assume: the surface is a pale tint in light
   * mode and a deep one in dark, so neither text colour is safe unconditionally.
   */
  isLight: boolean;
  /** True when the brand had no usable hue, so the surface is neutral. */
  isNeutral: boolean;
}

/** Below this saturation a colour reads as grey, and its hue is just noise. */
const ACHROMATIC_SATURATION = 12;

/**
 * Light mode: a wash, well clear of the near-white page so the panel still
 * reads as a panel, and light enough that dark type clears contrast at every
 * hue — which is the point of putting the type dark rather than white. White
 * text is what forces a *dark* panel, and it is the reason the greens and
 * yellows were the tight cases before; dark type on a tint has no such problem.
 */
const TINT_LIGHTNESS = 88;

/** Saturation is pulled down for the tint — a hue at full strength this pale goes acid. */
const TINT_SATURATION_CEILING = 58;

/** Dark mode: the same hue, deep, carrying white type. */
const DEEP_LIGHTNESS = 22;

/**
 * A brand-hued colour safe to use as *text on a page background*.
 *
 * `--primary` is the brand hex as given, which is right for a filled button and
 * wrong for a link. Seven tenants brand themselves white, beige, silver or a
 * pastel, so `text-primary` paints their "Forgot password?" and policy links
 * white on a near-white page — invisible, not merely low-contrast. None of the
 * seven has set `light_primary_color` to anything different, so nothing
 * mitigates it today.
 *
 * Hue is kept, so a link still reads as *their* colour; only lightness is
 * pushed into a band that can be read against the surface behind it. For the
 * thirty-nine tenants whose brand is already in that band this returns their
 * colour untouched.
 *
 * Scoped to the login page deliberately. The same flaw runs through every
 * `text-primary` in the portal, but correcting it there means changing
 * `--primary` for those tenants app-wide — a call worth making on its own,
 * not as a side effect of restyling one screen.
 */
export function brandInk(hex: string | null | undefined, isDark: boolean): string {
  const hsl = hex ? hexToHSL(hex) : null;

  if (!hsl || hsl.s < ACHROMATIC_SATURATION) {
    return isDark ? 'hsl(215 16% 76%)' : 'hsl(215 19% 35%)';
  }

  const s = Math.round(Math.min(85, Math.max(35, hsl.s)));
  const l = isDark ? Math.max(hsl.l, 66) : Math.min(hsl.l, 42);
  return `hsl(${hsl.h} ${s}% ${l}%)`;
}

export function brandSurface(
  hex: string | null | undefined,
  isDark = false
): BrandSurface {
  const hsl = hex ? hexToHSL(hex) : null;

  if (!hsl || hsl.s < ACHROMATIC_SATURATION) {
    return isDark
      ? { color: `hsl(222 14% ${DEEP_LIGHTNESS}%)`, isLight: false, isNeutral: true }
      : { color: `hsl(222 16% ${TINT_LIGHTNESS}%)`, isLight: true, isNeutral: true };
  }

  // Hue is kept exactly. Saturation is pulled into a band that is neither muddy
  // (a near-grey brand shouldn't produce a dead panel) nor garish (`#FF0000` at
  // 100% would be a fire alarm).
  const s = Math.round(Math.min(80, Math.max(25, hsl.s)));

  if (isDark) {
    return {
      color: `hsl(${hsl.h} ${s}% ${DEEP_LIGHTNESS}%)`,
      isLight: false,
      isNeutral: false,
    };
  }

  return {
    color: `hsl(${hsl.h} ${Math.min(s, TINT_SATURATION_CEILING)}% ${TINT_LIGHTNESS}%)`,
    isLight: true,
    isNeutral: false,
  };
}
