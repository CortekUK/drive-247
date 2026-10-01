"use client";

import { useEffect, useState } from "react";

/**
 * How a tenant's square icon should sit on the DARK sidebar.
 *
 * Tenants upload whatever they have, and plenty of icons are drawn for a white
 * page: a navy ring, a black wordmark, a dark glyph on transparency. On the
 * dark sidebar those parts vanish and the mark reads as a smudge. Light mode
 * never needs help, and neither do icons with enough light in them, so the
 * icon is measured once in the browser and only the ones that need it get it:
 *
 *   "none"   readable on dark as it is — sits straight on the ground
 *   "plate"  mostly dark ink on transparency — a soft light plate behind it
 *   "ring"   a mostly dark, full-bleed square — a faint outline for its edge
 *
 * The team lead asked for no tile of ours around the logo (Sep 2026), which
 * holds everywhere a logo does not need one; this only steps in, in dark
 * mode, for an icon that would otherwise disappear.
 *
 * Measured from a 32 × 32 draw of the image (tenant icons are public storage
 * URLs served with open CORS). If the image cannot be read — a tainted canvas,
 * a failed load — the answer is "ring": the cheapest treatment that is never
 * wrong. Results are cached per URL for the life of the page.
 */
export type LogoTone = "none" | "plate" | "ring";

const cache = new Map<string, LogoTone>();
const SIZE = 32;

function channel(v: number) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Classify raw RGBA pixels. Exported for tests. */
export function classifyLogoPixels(data: Uint8ClampedArray): LogoTone {
  let opaque = 0;
  let visible = 0;
  let transparent = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) {
      transparent++;
      continue;
    }
    opaque++;
    const lum = 0.2126 * channel(data[i]) + 0.7152 * channel(data[i + 1]) + 0.0722 * channel(data[i + 2]);
    // 0.08 is about 2.6:1 against the 10% dark page — the point where a shape
    // stops reading as a shape.
    if (lum > 0.08) visible++;
  }
  if (opaque === 0) return "ring";
  const readable = visible / opaque >= 0.5;
  if (readable) return "none";
  return transparent / (opaque + transparent) > 0.1 ? "plate" : "ring";
}

function measure(src: string): Promise<LogoTone> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve("ring");
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        resolve(classifyLogoPixels(ctx.getImageData(0, 0, SIZE, SIZE).data));
      } catch {
        resolve("ring");
      }
    };
    img.onerror = () => resolve("ring");
    img.src = src;
  });
}

/** The dark-mode treatment for a logo URL; "none" until measured. */
export function useLogoTone(src: string | null | undefined): LogoTone {
  const [tone, setTone] = useState<LogoTone>(() => (src && cache.get(src)) || "none");
  useEffect(() => {
    if (!src) return setTone("none");
    const hit = cache.get(src);
    if (hit) return setTone(hit);
    let live = true;
    measure(src).then((t) => {
      cache.set(src, t);
      if (live) setTone(t);
    });
    return () => {
      live = false;
    };
  }, [src]);
  return tone;
}

/** Classes for each tone. Dark-only: light mode is never touched. */
export const LOGO_TONE_CLASS: Record<LogoTone, string> = {
  none: "",
  plate: "dark:bg-neutral-100 dark:p-[3px]",
  ring: "dark:ring-1 dark:ring-white/15",
};

/**
 * The same treatment, unconditionally — for previews that are always drawn on
 * a dark surface (Settings → Branding's dark-mode cards), whatever mode the
 * portal itself is in.
 */
export const LOGO_TONE_CLASS_ON_DARK: Record<LogoTone, string> = {
  none: "",
  // A literal hex, not `bg-neutral-100`: the dark safety net in
  // styles/v2-theme.css repaints that class dark, which would turn the plate
  // into the very dark ground it exists to lift the icon off.
  plate: "bg-[#f5f5f5] p-[3px]",
  ring: "ring-1 ring-white/15",
};
