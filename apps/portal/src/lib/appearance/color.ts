/**
 * Colour maths for the Appearance settings screen.
 *
 * The runtime theming engine (`use-dynamic-theme.ts`) already turns a single
 * brand hex into the ~23 CSS variables the portal paints with. Everything here
 * sits *in front* of that: it decides whether a colour is safe to hand over in
 * the first place, and helps a tenant arrive at one without design skills.
 *
 * Nothing in this file writes to the DOM or the database.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Accepts `#RGB`, `#RRGGBB`, with or without the hash. Returns null if unparseable. */
export function hexToRgb(hex: string): Rgb | null {
  const cleaned = hex.trim().replace(/^#/, "");
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/**
 * Relative luminance per WCAG 2.1. Used for contrast ratios, NOT for perceived
 * brightness — the two disagree badly on saturated colours (pure yellow reads
 * "bright" but has a luminance close to mid-grey).
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours: 1 (identical) → 21 (black on white). */
export function contrastRatio(a: string, b: string): number | null {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return null;
  const la = relativeLuminance(ca);
  const lb = relativeLuminance(cb);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Which of white / near-black should sit *on top* of this colour.
 *
 * This is the guard that stops a tenant making their own portal unreadable:
 * whatever brand colour they choose, the label on their buttons is picked for
 * legibility rather than left to chance.
 */
export function readableForegroundOn(background: string): "#FFFFFF" | "#0A0A0A" {
  const onWhite = contrastRatio(background, "#FFFFFF") ?? 1;
  const onBlack = contrastRatio(background, "#0A0A0A") ?? 1;
  return onWhite >= onBlack ? "#FFFFFF" : "#0A0A0A";
}

export type ContrastGrade = "excellent" | "good" | "poor";

export interface ContrastVerdict {
  ratio: number;
  grade: ContrastGrade;
  foreground: string;
  /** Plain-language line for a rental operator — never mentions "WCAG". */
  message: string;
}

/**
 * Judge a brand colour and say something useful about it.
 *
 * Thresholds follow WCAG AA for large text (3:1) and normal text (4.5:1),
 * because the colour is used for both button labels and small badge text.
 */
export function judgeBrandColor(hex: string): ContrastVerdict | null {
  const foreground = readableForegroundOn(hex);
  const ratio = contrastRatio(hex, foreground);
  if (ratio === null) return null;

  if (ratio >= 4.5) {
    return {
      ratio,
      foreground,
      grade: "excellent",
      message:
        foreground === "#FFFFFF"
          ? "Text on this colour will be white and easy to read."
          : "Text on this colour will be dark and easy to read.",
    };
  }
  if (ratio >= 3) {
    return {
      ratio,
      foreground,
      grade: "good",
      message:
        "Readable, though small text on this colour will be a little soft. A slightly deeper shade would be crisper.",
    };
  }
  return {
    ratio,
    foreground,
    grade: "poor",
    message:
      "Text on this colour will be hard to read. We'd suggest a deeper or more saturated shade.",
  };
}

/** Nudge a colour darker (amount < 0) or lighter (amount > 0) by a 0–1 fraction. */
export function shade(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return rgbToHex({
    r: rgb.r + (target - rgb.r) * t,
    g: rgb.g + (target - rgb.g) * t,
    b: rgb.b + (target - rgb.b) * t,
  });
}

/**
 * Darken a colour just far enough to clear the given contrast ratio against
 * white. Used by "fix it for me" when a tenant picks something too pale.
 * Gives up after 20 steps and returns the best it reached.
 */
export function deepenUntilReadable(hex: string, target = 4.5): string {
  let current = hex;
  for (let i = 0; i < 20; i++) {
    const ratio = contrastRatio(current, "#FFFFFF");
    if (ratio !== null && ratio >= target) return current;
    current = shade(current, -0.06);
  }
  return current;
}

/**
 * Convert a hex to the `"H S% L%"` triplet the portal's CSS variables carry.
 *
 * The whole theme is variable-driven, so emitting this format lets a preview
 * container override `--primary` and friends and have *real* components repaint
 * — no parallel styling to keep in sync.
 */
export function hexToHslTriplet(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** True when two hexes are the same colour, ignoring case and the leading hash. */
export function sameColor(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const norm = (v: string) => {
    const rgb = hexToRgb(v);
    return rgb ? rgbToHex(rgb) : null;
  };
  const na = norm(a);
  const nb = norm(b);
  return na !== null && na === nb;
}

/** A hex as whole-number HSL: hue 0–359, saturation and lightness 0–100. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return { h: h % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** The hex for an HSL colour. Hue in degrees (wraps); saturation and lightness 0–100 (clamped). */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];

  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

/**
 * Every custom property `v2BrandVars` can return. The theming hook removes all
 * of them before writing a new set, so an option that no longer applies (a
 * pale brand's deeper link, say) cannot linger from the previous colour.
 */
export const V2_BRAND_VAR_NAMES = [
  "--brand-h",
  "--brand-s",
  "--brand-l",
  "--brand-link-l",
  "--brand-fg",
  "--brand-fg-dark",
] as const;

/**
 * Whether a brand colour has enough hue to theme the v2 portal.
 *
 * Every v2 token keeps the brand's hue and saturation at its own lightness, so
 * a brand with almost no saturation paints the whole portal grey, and one at
 * the lightness extremes has a hue too unstable to trust (northwind's saved
 * #020303 is 180 20% 1%: a rounding step away from any hue). Those fall back to
 * the default indigo. The bounds still let a deep slate like #1E293B (217 33%
 * 17%) or a pale yellow like #FDE68A (48 97% 77%) through.
 */
export function isUsableV2Brand({ s, l }: { s: number; l: number }): boolean {
  return s >= 15 && l >= 12 && l <= 92;
}

/** `--foreground` in styles/v2-theme.css: the near-black that reads on a pale brand. */
const V2_DARK_TEXT = "0 0% 3.9%";

/**
 * The inline custom properties that re-theme the v2 portal from one brand hex.
 *
 * styles/v2-theme.css derives every brand-coloured token from `--brand-h`,
 * `--brand-s` and `--brand-l` (see the comment at its top), so these three are
 * the whole palette. The optional extras cover what CSS cannot work out:
 *   --brand-link-l   when the brand is too pale for link text on white (under
 *                    4.5:1), the lightness at which the same hue first clears it;
 *   --brand-fg       near-black button text when the light-mode primary (the
 *                    brand itself) reads better with dark text than white;
 *   --brand-fg-dark  the same for the dark-mode primary, which the stylesheet
 *                    paints at 42% lightness, 2° and 7 points off the brand.
 * Left out, each falls back to the stylesheet's default.
 *
 * Null for anything that is not a 6- or 3-digit hex, so a caller can remove the
 * vars and let the stylesheet's indigo stand. Also null for a colour that
 * cannot carry a palette (see `isUsableV2Brand`): a near-black, near-white or
 * grey brand would turn buttons black, the active nav grey and the page wash
 * colourless, so the default indigo stands for those too.
 */
export function v2BrandVars(hex: string | null | undefined): Record<string, string> | null {
  if (!hex) return null;
  const hsl = hexToHsl(hex);
  if (!hsl || !isUsableV2Brand(hsl)) return null;
  const { h, s, l } = hsl;

  const vars: Record<string, string> = {
    "--brand-h": String(h),
    "--brand-s": `${s}%`,
    "--brand-l": `${l}%`,
  };

  const onWhite = (lightness: number) => contrastRatio(hslToHex(h, s, lightness), "#FFFFFF") ?? 21;
  let linkL = l;
  while (linkL > 0 && onWhite(linkL) < 4.5) linkL -= 1;
  if (linkL !== l) vars["--brand-link-l"] = `${linkL}%`;

  if (readableForegroundOn(hslToHex(h, s, l)) !== "#FFFFFF") {
    vars["--brand-fg"] = V2_DARK_TEXT;
  }
  if (readableForegroundOn(hslToHex(h - 2, s - 7, 42)) !== "#FFFFFF") {
    vars["--brand-fg-dark"] = V2_DARK_TEXT;
  }

  return vars;
}
