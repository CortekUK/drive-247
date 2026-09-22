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
import { getBrandInitials } from '@/components/shared/layout/brand-logo';
import { hexToRgb, hslToHex, readableForegroundOn, relativeLuminance, rgbToHex, type Rgb } from './color';
import { V2_DEFAULT_BRAND_COLOR } from './presets';

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

/** File extension per uploaded type. Anything unlisted is stored as .png, as before. */
const UPLOAD_EXTENSIONS: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Upload a generated logo variant and return its public URL. */
export async function uploadLogoBlob(
  blob: Blob,
  tenantId: string,
  suffix: string
): Promise<string> {
  // v2 Logos uploads a JPG or WebP as it came when it is already small enough;
  // LogoStudio (v1) only ever sends PNG and SVG, which keep their extensions.
  const ext = UPLOAD_EXTENSIONS[blob.type] ?? 'png';
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
/* v2 Logos: what each slot accepts, and how a file is checked and     */
/* prepared before it is uploaded.                                      */
/*                                                                      */
/*   slot   name         column       where it shows                    */
/*   small  Square icon  favicon_url  browser tab + sidebar badge       */
/*   large  Full logo    logo_url     sign-in page + booking site       */
/*                                                                      */
/* The slot ids are internal. People only ever see the names, never     */
/* "small", "large" or "favicon" (team lead, Sep 2026).                 */
/*                                                                      */
/* Every limit is a constant here so the help text under each card, the */
/* "best results" line and the error messages are built from the same   */
/* numbers the checks use. Each pixel limit is a range with both ends.  */
/* ------------------------------------------------------------------ */

/**
 * Our own ceiling. The live company-logos bucket has no file_size_limit
 * (NULL), so nothing upstream stops a 40 MB upload; this does, before any
 * byte leaves the browser.
 */
export const LOGO_MAX_BYTES = 10 * 1024 * 1024;

export type LogoSlot = 'small' | 'large';
export type LogoFormat = 'PNG' | 'WebP' | 'JPG' | 'SVG' | 'ICO';

/** What each slot is called on screen. */
export const LOGO_SLOT_NAMES: Record<LogoSlot, string> = {
  small: 'Square icon',
  large: 'Full logo',
};

/** The same names mid-sentence ("Replace square icon"). */
export const logoSlotNoun = (slot: LogoSlot) => LOGO_SLOT_NAMES[slot].toLowerCase();

const LOGO_FORMAT_TYPES: Record<LogoFormat, { mime: string[]; extensions: string[] }> = {
  PNG: { mime: ['image/png'], extensions: ['.png'] },
  WebP: { mime: ['image/webp'], extensions: ['.webp'] },
  JPG: { mime: ['image/jpeg'], extensions: ['.jpg', '.jpeg'] },
  SVG: { mime: ['image/svg+xml'], extensions: ['.svg'] },
  ICO: { mime: ['image/x-icon', 'image/vnd.microsoft.icon'], extensions: ['.ico'] },
};

export const SMALL_LOGO_FORMATS: readonly LogoFormat[] = ['PNG', 'WebP', 'JPG', 'SVG', 'ICO'];
export const LARGE_LOGO_FORMATS: readonly LogoFormat[] = ['PNG', 'WebP', 'JPG', 'SVG'];

const acceptFor = (formats: readonly LogoFormat[]) =>
  formats.flatMap((f) => [...LOGO_FORMAT_TYPES[f].extensions, ...LOGO_FORMAT_TYPES[f].mime]).join(',');

/** The file picker's `accept` for each slot. */
export const SMALL_LOGO_ACCEPT = acceptFor(SMALL_LOGO_FORMATS);
export const LARGE_LOGO_ACCEPT = acceptFor(LARGE_LOGO_FORMATS);

/**
 * Square icon: 128 to 4096 px a side, roughly square (width ÷ height within
 * 0.9 to 1.1). Always stored as a 512 × 512 PNG, so 512 is also the size that
 * looks sharpest; anything past 4096 is a photo or a print file, not an icon.
 */
export const SMALL_LOGO_MIN_PX = 128;
export const SMALL_LOGO_MAX_PX = 4096;
export const SMALL_LOGO_RECOMMENDED_PX = 512;
export const SMALL_LOGO_OUTPUT_PX = 512;
export const SMALL_LOGO_MIN_RATIO = 0.9;
export const SMALL_LOGO_MAX_RATIO = 1.1;

/**
 * Full logo: 400 to 6000 px wide and 100 to 3000 px tall, between 1:1 and
 * 8:1, never stored above 1200 px on its longest edge (so 1200 px wide is the
 * size worth sending).
 */
export const LARGE_LOGO_MIN_WIDTH = 400;
export const LARGE_LOGO_MAX_WIDTH = 6000;
export const LARGE_LOGO_MIN_HEIGHT = 100;
export const LARGE_LOGO_MAX_HEIGHT = 3000;
export const LARGE_LOGO_MIN_RATIO = 1;
export const LARGE_LOGO_MAX_RATIO = 8;
export const LARGE_LOGO_MAX_EDGE = 1200;
export const LARGE_LOGO_RECOMMENDED_WIDTH = LARGE_LOGO_MAX_EDGE;

const MB = 1024 * 1024;

/** "PNG, WebP, JPG or SVG" */
export function logoFormatList(formats: readonly LogoFormat[]): string {
  return formats.length > 1 ? `${formats.slice(0, -1).join(', ')} or ${formats[formats.length - 1]}` : formats.join('');
}

/** The line under each card, built from the limits above. */
export function logoHelpText(slot: LogoSlot): string {
  const size = `up to ${LOGO_MAX_BYTES / MB} MB`;
  if (slot === 'small') {
    return `${logoFormatList(SMALL_LOGO_FORMATS)} · ${size} · square, ${SMALL_LOGO_MIN_PX} to ${SMALL_LOGO_MAX_PX} px a side`;
  }
  return `${logoFormatList(LARGE_LOGO_FORMATS)} · ${size} · ${LARGE_LOGO_MIN_WIDTH} to ${LARGE_LOGO_MAX_WIDTH} px wide, ${LARGE_LOGO_MIN_HEIGHT} to ${LARGE_LOGO_MAX_HEIGHT} px tall`;
}

/** The one highlighted line at the top of Logos: what works best for both. */
export function logoBestResultsText(): string {
  return (
    `Best results: a PNG with a transparent background. ` +
    `${LOGO_SLOT_NAMES.small} at least ${SMALL_LOGO_RECOMMENDED_PX} × ${SMALL_LOGO_RECOMMENDED_PX} px; ` +
    `${logoSlotNoun('large')} at least ${LARGE_LOGO_RECOMMENDED_WIDTH} px wide.`
  );
}

/**
 * Which format a file is: by its type, or by its extension only when the
 * browser gave no useful type (an ICO often arrives with none). A GIF renamed
 * to .png is still a GIF.
 */
export function logoFormatOf(file: { name: string; type: string }): LogoFormat | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const formats = Object.keys(LOGO_FORMAT_TYPES) as LogoFormat[];
  const byType = formats.find((f) => LOGO_FORMAT_TYPES[f].mime.includes(type));
  if (byType) return byType;
  if (type && type !== 'application/octet-stream') return null;
  return formats.find((f) => LOGO_FORMAT_TYPES[f].extensions.some((ext) => name.endsWith(ext))) ?? null;
}

/** The type to upload a file under (some systems send a JPG with no type at all). */
export function logoMimeOf(format: LogoFormat): string {
  return LOGO_FORMAT_TYPES[format].mime[0];
}

/** Type and size, checked before the file is even opened. Null when both are fine. */
export function logoFileProblem(slot: LogoSlot, file: { name: string; type: string; size: number }): string | null {
  const allowed = slot === 'small' ? SMALL_LOGO_FORMATS : LARGE_LOGO_FORMATS;
  const format = logoFormatOf(file);
  if (!format || !allowed.includes(format)) {
    return `We can't use this type of file. Upload a ${logoFormatList(allowed)} file.`;
  }
  if (file.size === 0) return 'This file is empty. Choose the logo file again.';
  if (file.size > LOGO_MAX_BYTES) {
    // Rounded up, so a file just over the limit never reads as exactly on it.
    const mb = Math.ceil((file.size / MB) * 10) / 10;
    return `This file is ${mb.toFixed(1)} MB. Logos can be up to ${LOGO_MAX_BYTES / MB} MB, so save a smaller copy and try again.`;
  }
  return null;
}

export interface LogoImageSize {
  width: number;
  height: number;
  /** An SVG: it is drawn at whatever size we need, so it has no pixel minimum. */
  vector: boolean;
}

export interface LogoSizeProblem {
  /** `not-square` is the one a person can fix here, with "Fit into a square". */
  kind: 'too-small' | 'too-large' | 'not-square' | 'too-tall' | 'too-wide';
  message: string;
}

const px = (n: number) => Math.round(n);

/**
 * Pixel size and shape. Null when the image can be used as it is. An SVG has
 * no pixel size of its own (it is drawn at whatever size we need), so only its
 * shape is checked.
 */
export function logoSizeProblem(slot: LogoSlot, { width, height, vector }: LogoImageSize): LogoSizeProblem | null {
  const ratio = width / height;
  const dims = `${px(width)} × ${px(height)} px`;
  if (slot === 'small') {
    if (!vector && (width < SMALL_LOGO_MIN_PX || height < SMALL_LOGO_MIN_PX)) {
      return {
        kind: 'too-small',
        message: `This image is ${dims}. The square icon needs to be at least ${SMALL_LOGO_MIN_PX} × ${SMALL_LOGO_MIN_PX} px, and ${SMALL_LOGO_RECOMMENDED_PX} × ${SMALL_LOGO_RECOMMENDED_PX} px looks sharpest.`,
      };
    }
    if (!vector && (width > SMALL_LOGO_MAX_PX || height > SMALL_LOGO_MAX_PX)) {
      return {
        kind: 'too-large',
        message: `This image is ${dims}. The square icon can be at most ${SMALL_LOGO_MAX_PX} × ${SMALL_LOGO_MAX_PX} px. Save a smaller copy (${SMALL_LOGO_RECOMMENDED_PX} × ${SMALL_LOGO_RECOMMENDED_PX} px is best) and try again.`,
      };
    }
    if (ratio < SMALL_LOGO_MIN_RATIO || ratio > SMALL_LOGO_MAX_RATIO) {
      return {
        kind: 'not-square',
        message: `This image is ${dims}, so it isn't square. We can fit it into a square with a see-through background, or you can choose another file.`,
      };
    }
    return null;
  }
  if (!vector && (width < LARGE_LOGO_MIN_WIDTH || height < LARGE_LOGO_MIN_HEIGHT)) {
    return {
      kind: 'too-small',
      message: `This image is ${dims}. The full logo needs to be at least ${LARGE_LOGO_MIN_WIDTH} px wide and ${LARGE_LOGO_MIN_HEIGHT} px tall.`,
    };
  }
  if (!vector && (width > LARGE_LOGO_MAX_WIDTH || height > LARGE_LOGO_MAX_HEIGHT)) {
    return {
      kind: 'too-large',
      message: `This image is ${dims}. The full logo can be at most ${LARGE_LOGO_MAX_WIDTH} px wide and ${LARGE_LOGO_MAX_HEIGHT} px tall. Save a smaller copy (${LARGE_LOGO_RECOMMENDED_WIDTH} px wide is plenty) and try again.`,
    };
  }
  if (ratio < LARGE_LOGO_MIN_RATIO) {
    return {
      kind: 'too-tall',
      message: `This image is taller than it is wide (${dims}). Use your full logo with its name here, and put a square version under Square icon.`,
    };
  }
  if (ratio > LARGE_LOGO_MAX_RATIO) {
    return {
      kind: 'too-wide',
      message: `This image is more than ${LARGE_LOGO_MAX_RATIO} times wider than it is tall (${dims}), so it would show very small. Crop the empty space around it and try again.`,
    };
  }
  return null;
}

/** Shrink (never grow) a size so its longest edge is at most `maxEdge`. */
export function fitWithinEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Where a `width` × `height` image sits, whole and centred, in a `box` × `box` square. */
export function containInSquare(
  width: number,
  height: number,
  box: number
): { x: number; y: number; width: number; height: number } {
  const scale = box / Math.max(width, height);
  const w = width * scale;
  const h = height * scale;
  return { x: (box - w) / 2, y: (box - h) / 2, width: w, height: h };
}

/**
 * An SVG's own size: its width and height in px, or its viewBox when those are
 * missing (or relative, like 100%). Null when it states neither.
 */
export function parseSvgSize(svg: string): { width: number; height: number } | null {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!tag) return null;
  const attr = (name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const length = (value: string | undefined) => {
    const m = value?.trim().match(/^(\d*\.?\d+)(px)?$/i);
    const n = m ? parseFloat(m[1]) : NaN;
    return n > 0 ? n : null;
  };
  const width = length(attr('width'));
  const height = length(attr('height'));
  if (width && height) return { width, height };
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const boxW = box && box.length === 4 && box[2] > 0 ? box[2] : null;
  const boxH = box && box.length === 4 && box[3] > 0 ? box[3] : null;
  if (!boxW || !boxH) return null;
  if (width) return { width, height: (width * boxH) / boxW };
  if (height) return { width: (height * boxW) / boxH, height };
  return { width: boxW, height: boxH };
}

/**
 * The same SVG with an explicit px width and height (and a viewBox, so its
 * content scales with them). Without them some browsers refuse to draw an SVG
 * onto a canvas at all.
 */
export function withSvgSize(svg: string, width: number, height: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    const hasViewBox = /\sviewBox\s*=/i.test(tag);
    const bare = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
    const viewBox = hasViewBox ? '' : ` viewBox="0 0 ${width} ${height}"`;
    return bare.replace(/^<svg/i, `<svg width="${width}" height="${height}"${viewBox}`);
  });
}

export interface LoadedLogo extends LogoImageSize {
  image: HTMLImageElement;
  format: LogoFormat;
  /** Frees the object URL. Call once the image has been drawn (or dropped). */
  release: () => void;
}

/** Open a picked file as an image and read its size. Null when the browser can't decode it. */
export async function loadLogoFile(file: File): Promise<LoadedLogo | null> {
  const format = logoFormatOf(file);
  if (!format) return null;
  let blob: Blob = file;
  let svgSize: { width: number; height: number } | null = null;
  if (format === 'SVG') {
    const text = await file.text();
    svgSize = parseSvgSize(text);
    if (svgSize) blob = new Blob([withSvgSize(text, svgSize.width, svgSize.height)], { type: 'image/svg+xml' });
  }
  const src = URL.createObjectURL(blob);
  const release = () => URL.revokeObjectURL(src);
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  const width = svgSize?.width ?? image?.naturalWidth ?? 0;
  const height = svgSize?.height ?? image?.naturalHeight ?? 0;
  if (!image || !width || !height) {
    release();
    return null;
  }
  return { image, format, width, height, vector: format === 'SVG', release };
}

/** The square icon: always a 512 × 512 PNG, the image whole and centred on a see-through square. */
export async function renderSmallLogo(loaded: LoadedLogo): Promise<Blob | null> {
  const box = SMALL_LOGO_OUTPUT_PX;
  const canvas = document.createElement('canvas');
  canvas.width = box;
  canvas.height = box;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const at = containInSquare(loaded.width, loaded.height, box);
  ctx.drawImage(loaded.image, at.x, at.y, at.width, at.height);
  return canvasToBlob(canvas);
}

/**
 * The full logo. A PNG, WebP or JPG no longer than 1200 px on its longest edge
 * is uploaded exactly as it came; a longer one is scaled down to 1200 px as a
 * PNG, which keeps any transparency. An SVG is drawn as a PNG with its longest
 * edge at 1200 px: it is vector, so drawing it that large costs no sharpness.
 */
export async function prepareLargeLogo(file: File, loaded: LoadedLogo): Promise<Blob | null> {
  const target = loaded.vector
    ? (() => {
        const scale = LARGE_LOGO_MAX_EDGE / Math.max(loaded.width, loaded.height);
        return { width: Math.round(loaded.width * scale), height: Math.round(loaded.height * scale) };
      })()
    : fitWithinEdge(loaded.width, loaded.height, LARGE_LOGO_MAX_EDGE);
  if (!loaded.vector && target.width === loaded.width && target.height === loaded.height) {
    return new Blob([file], { type: logoMimeOf(loaded.format) });
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(loaded.image, 0, 0, target.width, target.height);
  return canvasToBlob(canvas);
}

/* ------------------------------------------------------------------ */
/* What the browser tab and the sidebar badge show                      */
/*                                                                      */
/*   square icon (favicon_url)                                          */
/*     -> a mark drawn from the portal name's initials, in the tenant's */
/*        brand colour                                                  */
/*     -> the platform icon, only where the mark cannot be drawn        */
/*                                                                      */
/* One chain, in one place, because two copies of it drifted: Settings  */
/* -> Branding -> Logos drew the sidebar badge from the initials while  */
/* the browser-tab picture beside it drew the Drive247 platform icon,   */
/* so removing the square icon looked like it had only half worked      */
/* (team lead, Sep 2026).                                               */
/*                                                                      */
/* The full logo is NOT in this chain. The two slots are independent:   */
/* a wordmark with the company name in it shrinks to an unreadable      */
/* sliver at 16px, and a tenant who uploads one must not find it        */
/* standing in for an icon they never chose.                            */
/* ------------------------------------------------------------------ */

/** The platform's own tab icon: the light one of app/layout.tsx's `PLATFORM_FAVICONS`. */
export const PLATFORM_TAB_ICON = '/icons/favicon-light.png';

/** The mark is drawn this big. A tab shows it at 16px, the sidebar badge at 32. */
export const BRAND_MARK_PX = 64;

/** What `OrgMark` shows for a tenant whose name yields no initials at all. */
export const BRAND_MARK_FALLBACK_INITIALS = 'O';

/** The v2 typeface, for a canvas (which takes a font stack, not a class). */
export const BRAND_MARK_FONT_STACK = "Manrope, system-ui, -apple-system, 'Segoe UI', Roboto, Arial";

/** What to show, and which of the two it is. `src` is null only when the mark could not be drawn. */
export type BrandIcon =
  | { kind: 'icon'; src: string; initials?: undefined }
  | { kind: 'initials'; src: string | null; initials: string };

/** The colours and typeface the mark is drawn with — the sidebar badge's own. */
export interface BrandMarkPaint {
  background: string;
  foreground: string;
  fontFamily: string;
}

export interface BrandIconOptions {
  /**
   * The brand colour to draw the mark in when the running page's `--primary`
   * cannot be read (a server render, or a test with no stylesheet).
   */
  brandColor?: string | null;
  /**
   * Where the v2 brand variables live — `<body>`. Pass null to skip reading
   * them. Left out, `document.body` when there is one.
   */
  root?: HTMLElement | null;
  /** False on a render that cannot draw (no DOM yet); the mark is then null. */
  generate?: boolean;
}

/**
 * The one chain. Returns what to draw for a tenant's tab icon and sidebar
 * badge, so a preview of either cannot disagree with the real thing.
 */
export function resolveBrandIcon(
  iconUrl: string | null | undefined,
  name: string | null | undefined,
  options: BrandIconOptions = {}
): BrandIcon {
  const icon = typeof iconUrl === 'string' ? iconUrl.trim() : '';
  if (icon) return { kind: 'icon', src: icon };

  const initials = getBrandInitials(name ?? '') || BRAND_MARK_FALLBACK_INITIALS;
  if (options.generate === false) return { kind: 'initials', src: null, initials };

  const root =
    options.root !== undefined ? options.root : typeof document === 'undefined' ? null : document.body;
  return { kind: 'initials', src: brandMarkDataUrl(initials, brandMarkPaint(root, options.brandColor)), initials };
}

/**
 * The colours the mark is drawn in.
 *
 * First choice is the page's own `--primary` and `--primary-foreground`, which
 * is literally what `OrgMark`'s `bg-primary` chip paints with: styles/v2-theme.css
 * derives them from `--brand-h/s/l`, and the Branding try-on writes those on
 * `<body>` as the colour is picked. So the drawn mark and the live chip are the
 * same colour, and both follow an unsaved colour straight away.
 *
 * Where there is no stylesheet to read (a server render, a test), the brand hex
 * the caller holds stands in, and failing that the default brand colour — the
 * same one the stylesheet would have fallen back to.
 */
export function brandMarkPaint(
  root: HTMLElement | null | undefined,
  brandColor?: string | null
): BrandMarkPaint {
  let background: string | null = null;
  let foreground: string | null = null;
  let fontFamily = '';

  if (root && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      const style = window.getComputedStyle(root);
      background = hslTripleToHex(style.getPropertyValue('--primary'));
      // PAIRED with the background, deliberately. `--primary-foreground` is the
      // readable text for `--primary` and for nothing else: taking it on its own
      // while the fill fell back to the caller's saved hex paired the ivory meant
      // for the dark-mode primary (42% lightness) with a pale brand colour, and
      // the initials disappeared.
      foreground = background ? hslTripleToHex(style.getPropertyValue('--primary-foreground')) : null;
      fontFamily = style.fontFamily || '';
    } catch {
      // No computed style to read: the caller's hex below.
    }
  }

  const rgb = background ? null : brandColor ? hexToRgb(brandColor) : null;
  const fill = background || (rgb ? rgbToHex(rgb) : V2_DEFAULT_BRAND_COLOR);
  return {
    background: fill,
    // The stylesheet leaves --primary-foreground off for a brand that reads
    // with white on it, so work it out rather than assuming either.
    foreground: foreground || readableForegroundOn(fill),
    fontFamily: fontFamily || BRAND_MARK_FONT_STACK,
  };
}

/**
 * A rounded square in the brand colour with the tenant's initials on it, as a
 * PNG data URL — `OrgMark`'s chip, in a form a `<link rel="icon">` can take.
 * Null where a canvas cannot be used (a server render, jsdom without one), and
 * the platform icon then stands.
 *
 * Cached per drawing, so the same tenant gets the same string every render: an
 * icon link whose href changes makes the browser refetch, and an `<img>` whose
 * src changes flickers.
 */
export function brandMarkDataUrl(initials: string, paint: BrandMarkPaint, size = BRAND_MARK_PX): string | null {
  const key = `${size}|${initials}|${paint.background}|${paint.foreground}|${paint.fontFamily}`;
  const cached = BRAND_MARK_CACHE.get(key);
  if (cached !== undefined) return cached;
  const drawn = drawBrandMark(initials, paint, size);
  // Only a drawing is kept: a null means the environment could not draw at all,
  // and caching that would outlive a canvas arriving later (a test installing one).
  if (drawn) {
    if (BRAND_MARK_CACHE.size > 24) BRAND_MARK_CACHE.clear();
    BRAND_MARK_CACHE.set(key, drawn);
  }
  return drawn;
}

const BRAND_MARK_CACHE = new Map<string, string>();

/**
 * Forget every drawn mark. The cache is module-global and outlives a component,
 * which is the point in the product and a trap in a test: a suite that draws a
 * mark with a stubbed canvas would hand the same string to the next test, which
 * may be checking what happens when nothing can be drawn.
 */
export function clearBrandMarkCache(): void {
  BRAND_MARK_CACHE.clear();
}

function drawBrandMark(initials: string, paint: BrandMarkPaint, size: number): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // `rounded-lg` is 8px on OrgMark's 32px badge: a quarter of the box.
    const radius = size * 0.25;
    ctx.beginPath();
    const withRoundRect = ctx as CanvasRenderingContext2D & {
      roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
    };
    if (typeof withRoundRect.roundRect === 'function') {
      withRoundRect.roundRect(0, 0, size, size, radius);
    } else {
      ctx.moveTo(radius, 0);
      ctx.lineTo(size - radius, 0);
      ctx.quadraticCurveTo(size, 0, size, radius);
      ctx.lineTo(size, size - radius);
      ctx.quadraticCurveTo(size, size, size - radius, size);
      ctx.lineTo(radius, size);
      ctx.quadraticCurveTo(0, size, 0, size - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
    }
    ctx.closePath();
    ctx.fillStyle = paint.background;
    ctx.fill();

    // `text-[12px] font-semibold` in a 32px badge: three eighths of the box, at 600.
    ctx.fillStyle = paint.foreground;
    ctx.font = `600 ${Math.round(size * 0.375)}px ${paint.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, size / 2, size / 2);

    const url = canvas.toDataURL('image/png');
    // jsdom without a canvas hands back "data:," rather than refusing.
    return url.startsWith('data:image/png') ? url : null;
  } catch {
    return null;
  }
}

/**
 * `"175 77% 26%"` — a CSS custom property's value — as a hex. Null if it is not one.
 *
 * A custom property's COMPUTED value keeps any `calc()` unevaluated: it is
 * resolved only in the property that finally consumes it. styles/v2-theme.css
 * writes the dark tokens as `calc(var(--brand-h) - 2) calc(var(--brand-s) - 7%)
 * 42%`, so a plain three-number parse read every dark-mode page as "no colour
 * here" and silently fell back to the caller's saved hex — a mark in the light
 * brand colour beside a sidebar chip in the dark one. One `calc(a ± b)` per
 * component is the whole of what the stylesheet writes, so evaluate exactly
 * that and nothing more.
 */
function hslTripleToHex(value: string): string | null {
  const parts = splitTopLevel(value.trim());
  if (parts.length !== 3) return null;
  const [h, s, l] = parts.map(hslComponent);
  if (h === null || s === null || l === null) return null;
  return hslToHex(h, s, l);
}

/** Split on the spaces BETWEEN components, never on the ones inside a `calc(…)`. */
function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** One HSL component: `248`, `68%`, or `calc(68% - 7%)`. Null for anything else. */
function hslComponent(token: string): number | null {
  const plain = token.match(/^(-?\d*\.?\d+)%?$/);
  if (plain) return Number(plain[1]);
  const calc = token.match(/^calc\(\s*(-?\d*\.?\d+)%?\s*([+-])\s*(-?\d*\.?\d+)%?\s*\)$/);
  if (!calc) return null;
  const left = Number(calc[1]);
  const right = Number(calc[3]);
  return calc[2] === '+' ? left + right : left - right;
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
