/**
 * Logo analysis and repair.
 *
 * Two problems this solves, both reported by real tenants:
 *
 *  1. A logo that looks fine on white vanishes against a dark sidebar (or the
 *     reverse). `dark_logo_url` has always existed, but nobody knows what it is
 *     or when they need it — so we detect it and say so.
 *
 *  2. Operators upload JPGs. A JPG cannot carry transparency, so the logo
 *     arrives welded into a white rectangle that looks broken anywhere except a
 *     white background. We can strip that box client-side.
 *
 * All of this runs in the browser against an already-uploaded URL. Anything
 * that depends on reading pixels degrades to "unknown" rather than throwing
 * when the image is cross-origin and taints the canvas.
 */

import { supabase } from '@/integrations/supabase/client';
import { relativeLuminance, type Rgb } from './color';

const LOGO_BUCKET = 'company-logos';

export interface LogoAnalysis {
  /** Mean luminance (0–1) of the logo's own ink, ignoring transparent padding. */
  luminance: number;
  /** True when the image carries a real alpha channel with transparent pixels. */
  hasTransparency: boolean;
  /**
   * True when the image looks like it has a solid rectangular backdrop — the
   * classic JPG-with-a-white-box case. Detected by sampling the four corners.
   */
  hasSolidBackdrop: boolean;
  /** The colour of that backdrop, when there is one. */
  backdropColor: string | null;
  /** Ink is dark: it will struggle on a dark sidebar. */
  isDarkInk: boolean;
  /** Ink is light: it will struggle on a white background. */
  isLightInk: boolean;
}

/**
 * Inspect an uploaded logo. Returns null when the pixels cannot be read at all
 * (cross-origin without CORS headers) — callers should simply skip the advice
 * rather than showing a scary warning they cannot act on.
 */
export async function analyzeLogo(url: string): Promise<LogoAnalysis | null> {
  const img = await loadImage(url);
  if (!img) return null;

  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }

  let transparentPixels = 0;
  let inkLuminanceSum = 0;
  let inkPixels = 0;

  // Corner samples decide whether there's a solid backdrop behind the mark.
  const corners: Rgb[] = [
    pixelAt(data, size, 1, 1),
    pixelAt(data, size, size - 2, 1),
    pixelAt(data, size, 1, size - 2),
    pixelAt(data, size, size - 2, size - 2),
  ];
  const cornerAlpha = [
    alphaAt(data, size, 1, 1),
    alphaAt(data, size, size - 2, 1),
    alphaAt(data, size, 1, size - 2),
    alphaAt(data, size, size - 2, size - 2),
  ];

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 32) {
      transparentPixels++;
      continue;
    }
    inkLuminanceSum += relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] });
    inkPixels++;
  }

  const hasTransparency = transparentPixels > size * size * 0.05;

  // Opaque corners that agree with each other == a solid rectangular backdrop.
  const cornersOpaque = cornerAlpha.every((a) => a > 200);
  const cornersAgree = corners.every((c) => colorDistance(c, corners[0]) < 24);
  const hasSolidBackdrop = cornersOpaque && cornersAgree;

  const luminance = inkPixels > 0 ? inkLuminanceSum / inkPixels : 0.5;

  return {
    luminance,
    hasTransparency,
    hasSolidBackdrop,
    backdropColor: hasSolidBackdrop ? rgbToHexLocal(corners[0]) : null,
    isDarkInk: luminance < 0.35,
    isLightInk: luminance > 0.72,
  };
}

/**
 * Remove a solid rectangular backdrop, producing a PNG with real transparency.
 *
 * A flood fill from all four corners rather than a global "delete every pixel
 * near white": a global match punches holes through white *inside* the mark
 * (counters of letters, highlights), which looks far worse than the box did.
 * Tolerance is generous because JPG compression smears the backdrop edge.
 */
export async function removeLogoBackdrop(url: string, tolerance = 42): Promise<Blob | null> {
  const img = await loadImage(url);
  if (!img) return null;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || 512;
  canvas.height = img.naturalHeight || 512;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const { width, height, data } = imageData;
  const target = { r: data[0], g: data[1], b: data[2] };

  // Iterative stack-based flood fill — recursion blows the stack on real images.
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    stack.push(idx);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length) {
    const idx = stack.pop()!;
    if (visited[idx]) continue;
    visited[idx] = 1;

    const p = idx * 4;
    const dist = colorDistance(
      { r: data[p], g: data[p + 1], b: data[p + 2] },
      target
    );
    if (dist > tolerance) continue;

    data[p + 3] = 0; // punch it out

    const x = idx % width;
    const y = Math.floor(idx / width);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
}

/**
 * Recolour a logo's ink to a single flat colour, keeping its shape and alpha.
 *
 * This is how the dark-mode counterpart gets made: a dark wordmark becomes a
 * white one that reads cleanly against a dark sidebar. Only works well for
 * single-colour marks — which is why the UI presents it as a suggestion the
 * tenant previews and accepts, never something applied silently.
 */
export async function recolorLogo(url: string, hex: string): Promise<Blob | null> {
  const img = await loadImage(url);
  if (!img) return null;

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || 512;
  canvas.height = img.naturalHeight || 512;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const { data } = imageData;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue; // leave transparency alone
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
}

/** Upload a generated logo variant and return its public URL. */
export async function uploadLogoBlob(
  blob: Blob,
  tenantId: string,
  suffix: string
): Promise<string> {
  const ext = blob.type === 'image/svg+xml' ? 'svg' : 'png';
  const fileName = `${tenantId}/${suffix}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(fileName, blob, { cacheControl: '3600', upsert: false, contentType: blob.type });

  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(fileName);

  return publicUrl;
}

/* ------------------------------------------------------------------ */

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

function pixelAt(data: Uint8ClampedArray, size: number, x: number, y: number): Rgb {
  const p = (y * size + x) * 4;
  return { r: data[p], g: data[p + 1], b: data[p + 2] };
}

function alphaAt(data: Uint8ClampedArray, size: number, x: number, y: number): number {
  return data[(y * size + x) * 4 + 3];
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function rgbToHexLocal({ r, g, b }: Rgb): string {
  return (
    '#' +
    [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase()
  );
}
