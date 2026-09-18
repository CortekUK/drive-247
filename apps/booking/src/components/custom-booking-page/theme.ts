/**
 * The Premium Contemporary palette, and the one colour an operator may change.
 *
 * The template ships ONE approved palette, and that is still the default every
 * tenant gets. What it no longer does is read the operator's `primary_color`:
 * that drives the existing booking site and the portal, and pulling it in here
 * turned the approved purple into whatever hue happened to be on file — a blue
 * site for one operator, a green one for the next.
 *
 * Instead there is a single, explicit opt-in: `tenants.custom_site_accent_color`,
 * set by the operator in the portal (Settings → Branding → Custom Site Accent).
 * NULL means the approved default. Nothing else about the design moves.
 *
 * Every shade below — hover, the soft wash, the glow, both gradient stops and
 * the dark-mode set — is DERIVED from that one hex rather than stored, so an
 * operator picks one colour and the whole site stays internally consistent.
 *
 * Contrast, the approved default against white:
 *   #5E3BFF  5.9:1  — AA for text, and AA for white text on the solid fill
 *   #11152A   17:1  — AAA, the midnight ground for footer and CTA banner
 */

export interface CbpTheme {
  /** Accent text, icons, active states. Also the solid button fill. */
  brand: string;
  /** Hover/pressed for the accent. */
  brandInk: string;
  /** Soft wash behind icons, badges, the active tab and the stat band. */
  brandSoft: string;
  /** Shadow colour under brand buttons. */
  brandGlow: string;
  /** Gradient stops, dark end to light end. */
  gradFrom: string;
  gradTo: string;
  /** Midnight — footer and closing banner. White text sits on it. */
  deep: string;
}

/** The approved default. Also the fallback baked into `styles.css`. */
export const APPROVED_ACCENT = "#5E3BFF";

export const APPROVED_THEME: CbpTheme = {
  brand: "#5E3BFF",      // Purple
  brandInk: "#4A2BE0",   // pressed / hover
  brandSoft: "#EEEAFE",  // Lavender
  brandGlow: "rgba(94, 59, 255, .30)",
  gradFrom: "#5E3BFF",
  gradTo: "#8B6BFF",     // the lighter end of the reference's gradient
  deep: "#11152A",       // Midnight
};

/* ------------------------------------------------------------- colour ---
   Just enough colour maths to place one hue at chosen lightnesses. HSL, not
   a perceptual space, on purpose: the derived shades only ever have to look
   like the same colour lighter or darker, and the two readability-critical
   values are pinned to fixed lightness targets rather than left to drift. */

const HEX = /^#([0-9a-f]{6})$/i;

interface Hsl { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return { h, s, l };
}

const hueToRgb = (p: number, q: number, t: number) => {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
};

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, h) * 255),
    Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  ];
}

const toHex = (hsl: Hsl) =>
  "#" + hslToRgb(hsl).map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();

/** "H S% L%" — the shape the app's own tokens are written in. */
const triplet = ({ h, s, l }: Hsl) =>
  `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;

const rgba = (hsl: Hsl, alpha: number) => {
  const [r, g, b] = hslToRgb(hsl);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * A light-mode and a dark-mode theme from one accent.
 *
 * The lightness targets are the load-bearing part. On white, the accent is
 * capped at 58% so a mid-tone brand cannot become unreadable body text, and
 * floored at 26% so a near-black accent still reads as a colour. On the dark
 * ground the accent is pushed to 72% for the same reason in reverse — the
 * approved purple is 3.2:1 there untouched and 5.1:1 lightened, and any other
 * hue has the same problem.
 */
export function deriveTheme(accent: string | null | undefined): { light: CbpTheme; dark: CbpTheme } | null {
  const base = accent ? hexToHsl(accent) : null;
  if (!base) return null;

  // A grey accent has no hue to carry; give the washes a trace of saturation
  // so they read as a tint rather than as dirt.
  const s = Math.max(base.s, 0.08);

  const lightBrand: Hsl = { h: base.h, s, l: clamp(base.l, 0.26, 0.58) };
  const lightInk: Hsl = { h: base.h, s, l: clamp(lightBrand.l - 0.09, 0.18, 0.55) };
  const lightSoft: Hsl = { h: base.h, s: clamp(s * 0.85, 0.12, 0.9), l: 0.94 };
  const gradTo: Hsl = { h: base.h, s, l: clamp(lightBrand.l + 0.16, 0.3, 0.78) };

  const darkBrand: Hsl = { h: base.h, s: clamp(s * 1.05, 0.2, 1), l: clamp(base.l + 0.2, 0.66, 0.78) };
  const darkInk: Hsl = { h: base.h, s: darkBrand.s, l: clamp(darkBrand.l + 0.08, 0.7, 0.88) };
  // The dark wash is the accent dropped almost to the page ground, so a badge
  // reads as tinted rather than as a light patch punched in a dark page.
  const darkSoft: Hsl = { h: base.h, s: clamp(s * 0.75, 0.2, 0.7), l: 0.19 };

  return {
    light: {
      brand: toHex(lightBrand),
      brandInk: toHex(lightInk),
      brandSoft: toHex(lightSoft),
      brandGlow: rgba(lightBrand, 0.3),
      gradFrom: toHex(lightBrand),
      gradTo: toHex(gradTo),
      deep: APPROVED_THEME.deep,
    },
    dark: {
      brand: toHex(darkBrand),
      brandInk: toHex(darkInk),
      brandSoft: toHex(darkSoft),
      brandGlow: rgba(darkBrand, 0.34),
      // The gradient keeps the true accent at its dark end in both modes —
      // white sits on it either way, so it needs no lightening.
      gradFrom: toHex(lightBrand),
      gradTo: toHex(gradTo),
      deep: APPROVED_THEME.deep,
    },
  };
}

/**
 * The derived accent as INPUT custom properties for `styles.css`.
 *
 * Deliberately not `--brand` and friends directly: those are chosen by the
 * mode rules (`.cbp` vs `.cbp[data-theme="dark"]`), and an inline custom
 * property outranks any selector — setting them here would freeze the site in
 * one mode and the light/dark toggle would stop working. Instead the mode
 * rules read `var(--a-*, <approved default>)` for light and `var(--ad-*, …)`
 * for dark, so this only supplies the ingredients and the cascade still picks.
 *
 * Returns nothing when the operator has not set an accent, leaving every token
 * on the approved default with no inline style at all.
 */
/**
 * A tenant's palette configuration: the accent they picked, plus any grounds
 * their brand specifies outright. Everything absent is derived or approved.
 */
export interface CbpThemeConfig {
  accent?: string | null;
  /** The soft wash behind badges, chips and icon plates. */
  soft?: string | null;
  /** The midnight ground under the footer and the closing banner. */
  deep?: string | null;
  /** The card/panel surface in dark mode. */
  surfaceDark?: string | null;
  /**
   * The rest of the palette, for a brand that specifies its grounds and text
   * rather than leaving them to derivation. Every key is optional and every
   * absent key keeps the value the design already had, so a config carrying
   * only an accent behaves exactly as it did before these existed.
   *
   * Each has a light and a dark form because the two are independent choices:
   * a navy brand wants a near-white page in the day and a near-black one at
   * night, and neither can be computed from the other.
   */
  paper?: string | null;        paperDark?: string | null;
  surface?: string | null;
  /** The ground a menu, dropdown or dialog floats on. */
  pop?: string | null;          popDark?: string | null;
  wash?: string | null;         washDark?: string | null;
  line?: string | null;         lineDark?: string | null;
  ink?: string | null;          inkDark?: string | null;
  body?: string | null;         bodyDark?: string | null;
  meta?: string | null;         metaDark?: string | null;
  placeholder?: string | null;  placeholderDark?: string | null;
  /** The accent's hover/pressed step. */
  accentHover?: string | null;  accentHoverDark?: string | null;
  /** An accent pinned for dark mode, instead of the lightened derivation. */
  accentDark?: string | null;
  softDark?: string | null;
}

/** config key → the CSS variable it feeds, per mode. */
const LIGHT_KEYS: [keyof CbpThemeConfig, string][] = [
  ["paper", "--a-paper"], ["surface", "--a-surface"], ["pop", "--a-pop"],
  ["wash", "--a-wash"], ["line", "--a-line"], ["ink", "--a-ink"],
  ["body", "--a-body"], ["meta", "--a-meta"], ["placeholder", "--a-placeholder"],
  ["accentHover", "--a-brand-hover"], ["soft", "--a-brand-soft"],
];
const DARK_KEYS: [keyof CbpThemeConfig, string][] = [
  ["paperDark", "--ad-paper"], ["surfaceDark", "--ad-surface"], ["popDark", "--ad-pop"],
  ["washDark", "--ad-wash"], ["lineDark", "--ad-line"], ["inkDark", "--ad-ink"],
  ["bodyDark", "--ad-body"], ["metaDark", "--ad-meta"], ["placeholderDark", "--ad-placeholder"],
  ["accentHoverDark", "--ad-brand-hover"], ["accentDark", "--ad-brand"], ["softDark", "--ad-brand-soft"],
];

const HEX_ONLY = /^#[0-9a-fA-F]{6}$/;
const hexOr = (v: string | null | undefined) => (v && HEX_ONLY.test(v.trim()) ? v.trim() : null);

export function accentCss(config: CbpThemeConfig | null | undefined): string | null {
  const vars: Record<string, string> = { ...(accentVars(config?.accent) as Record<string, string> | undefined ?? {}) };

  // Anything the brand pins down explicitly, overriding what was derived.
  for (const [key, cssVar] of [...LIGHT_KEYS, ...DARK_KEYS]) {
    const value = hexOr(config?.[key] as string | null | undefined);
    if (value) vars[cssVar] = value;
  }
  // The midnight ground is shared by both modes unless a dark one is given.
  const deep = hexOr(config?.deep);
  if (deep) { vars["--a-deep"] = deep; vars["--ad-deep"] = vars["--ad-deep"] ?? deep; }
  // A pinned dark accent still needs its glow, or the buttons lose their lift.
  const accentDark = hexOr(config?.accentDark);
  if (accentDark) {
    const hsl = hexToHsl(accentDark);
    if (hsl) vars["--ad-brand-glow"] = rgba(hsl, 0.34);
  }

  if (Object.keys(vars).length === 0) return null;
  // Every value here is derived from a hex this module parsed itself — three
  // numbers formatted back out — so there is nothing a stored value could
  // smuggle into the stylesheet. The guard is belt and braces.
  const safe = /^[#a-zA-Z0-9 ,.()%-]+$/;
  const body = Object.entries(vars)
    .filter(([, v]) => typeof v === "string" && safe.test(v))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `:root{${body}}`;
}

function accentVars(accent: string | null | undefined): React.CSSProperties | undefined {
  const derived = deriveTheme(accent);
  if (!derived) return undefined;
  const { light, dark } = derived;
  // The booking engine embedded in the hero paints from the app's own tokens,
  // which are HSL triplets rather than hex. Same accent, same two modes, so the
  // form in the middle of the page cannot end up a different colour from the
  // page around it.
  const base = hexToHsl(accent!)!;
  const s = Math.max(base.s, 0.08);
  const lightHsl: Hsl = { h: base.h, s, l: clamp(base.l, 0.26, 0.58) };
  const darkHsl: Hsl = { h: base.h, s: clamp(s * 1.05, 0.2, 1), l: clamp(base.l + 0.2, 0.66, 0.78) };

  return {
    ["--a-hsl" as string]: triplet(lightHsl),
    ["--a-hsl-lift" as string]: triplet({ ...lightHsl, l: clamp(lightHsl.l + 0.12, 0.3, 0.8) }),
    ["--ad-hsl" as string]: triplet(darkHsl),
    ["--a-brand" as string]: light.brand,
    ["--a-brand-ink" as string]: light.brandInk,
    ["--a-brand-soft" as string]: light.brandSoft,
    ["--a-brand-glow" as string]: light.brandGlow,
    ["--a-grad-from" as string]: light.gradFrom,
    ["--a-grad-to" as string]: light.gradTo,
    ["--ad-brand" as string]: dark.brand,
    ["--ad-brand-ink" as string]: dark.brandInk,
    ["--ad-brand-soft" as string]: dark.brandSoft,
    ["--ad-brand-glow" as string]: dark.brandGlow,
  };
}
