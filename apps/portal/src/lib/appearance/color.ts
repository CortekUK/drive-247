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
 * Pull the dominant brand colours out of an uploaded logo.
 *
 * Deliberately crude — it is a *suggestion* engine, not colour science. Pixels
 * are bucketed into a coarse grid so near-identical shades collapse together,
 * then near-white / near-black / near-grey are dropped: a logo is mostly
 * background and outline, and neither makes a brand colour.
 *
 * Runs entirely client-side against an already-uploaded URL. Returns [] rather
 * than throwing if the image is cross-origin and the canvas ends up tainted.
 */
export async function extractLogoColors(url: string, take = 5): Promise<string[]> {
  if (typeof document === "undefined") return [];

  const img = await loadImage(url);
  if (!img) return [];

  const size = 64; // downsampling is the point — we want dominant, not exact
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, size, size);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // Tainted canvas — the logo is served from an origin without CORS headers.
    return [];
  }

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];

    if (alpha < 200) continue; // transparent padding

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    if (max > 240 && saturation < 0.15) continue; // near-white
    if (max < 28) continue; // near-black
    if (saturation < 0.12) continue; // grey — outlines and shadows

    // 24 levels per channel: close shades of the same ink collapse into one bucket
    const key = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(b / 24)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.r += r;
      existing.g += g;
      existing.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, take)
    .map((bucket) =>
      rgbToHex({
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
      })
    );
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
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
