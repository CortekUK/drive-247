import { hexToHSL } from "@/hooks/use-dynamic-theme";

/**
 * Derives a *dark, full-bleed* surface from a tenant's brand colour — the login
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
 * So the split is: hue and saturation come from the brand, lightness is ours.
 * A panel that carries white text has to be dark no matter how light the brand
 * is — `#90EE90` is a pale mint, but its *hue* is the tenant's, and a deep
 * green panel is recognisably theirs where a mint one is unreadable. And a
 * brand with no hue to give gets a neutral slate rather than a fabricated one.
 *
 * The result is one flat colour, not a ramp. A gradient across a panel this
 * large reads as two colours however tight the stops are, which is the thing
 * the brand is least able to afford here.
 */

export interface BrandSurface {
  /** A single flat colour, ready for `style={{ backgroundColor }}`. */
  color: string;
  /** True when the brand had no usable hue, so the surface is neutral slate. */
  isNeutral: boolean;
}

/** Below this saturation a colour reads as grey, and its hue is just noise. */
const ACHROMATIC_SATURATION = 12;

/**
 * One lightness, not a ramp. Low enough that white text clears 5:1 at every hue
 * in the estate — the yellows and greens are the tight ones, since they carry
 * far more luminance than a blue at the same nominal lightness.
 */
const SURFACE_LIGHTNESS = 26;

const NEUTRAL_SURFACE = `hsl(222 14% ${SURFACE_LIGHTNESS}%)`;

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
    return isDark ? "hsl(215 16% 76%)" : "hsl(215 19% 35%)";
  }

  const s = Math.round(Math.min(85, Math.max(35, hsl.s)));
  const l = isDark ? Math.max(hsl.l, 66) : Math.min(hsl.l, 42);
  return `hsl(${hsl.h} ${s}% ${l}%)`;
}

export function brandSurface(hex: string | null | undefined): BrandSurface {
  const hsl = hex ? hexToHSL(hex) : null;

  if (!hsl || hsl.s < ACHROMATIC_SATURATION) {
    return { color: NEUTRAL_SURFACE, isNeutral: true };
  }

  // Hue is kept exactly. Saturation is pulled into a band that is neither muddy
  // (a near-grey brand shouldn't produce a dead panel) nor garish (`#FF0000` at
  // 100% would be a fire alarm).
  const s = Math.round(Math.min(80, Math.max(25, hsl.s)));

  return {
    color: `hsl(${hsl.h} ${s}% ${SURFACE_LIGHTNESS}%)`,
    isNeutral: false,
  };
}
