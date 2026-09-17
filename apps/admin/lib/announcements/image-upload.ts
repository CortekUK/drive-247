/**
 * Announcement image checks: file type, size, pixel dimensions and the storage
 * path. The upload itself lives in ./api.ts (it needs the Supabase client).
 *
 * RELATIVE imports only: the scratchpad node tests bundle this file without the
 * app's `@/` alias. `readImageDimensions` needs a browser; everything else is
 * pure.
 */

import {
  IMAGE_GUIDANCE,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  IMAGE_WARN_BYTES,
  announcementImagePath,
  isOneOf,
  type AnnouncementImageMime,
  type ImageSlot,
} from './contract';

export const IMAGE_ACCEPT = IMAGE_MIME_TYPES.join(',');

export const IMAGE_ERRORS = {
  type: 'Use PNG, JPG or WebP.',
  size: 'Images must be 2 MB or smaller.',
  unreadable: 'This file could not be opened as an image.',
  address: 'Unexpected storage address; image not used.',
} as const;

export type ImageFileCheck = { ok: true; mime: AnnouncementImageMime } | { ok: false; error: string };

/**
 * Blocking checks, before anything is uploaded. SVG is refused on purpose: it
 * can carry script, and the bucket is public. `file.type` is what the bucket's
 * allowed_mime_types checks too, so the two agree.
 */
export function checkImageFile(file: { type: string; size: number }): ImageFileCheck {
  if (!isOneOf(IMAGE_MIME_TYPES, file.type)) return { ok: false, error: IMAGE_ERRORS.type };
  if (file.size > IMAGE_MAX_BYTES) return { ok: false, error: IMAGE_ERRORS.size };
  return { ok: true, mime: file.type };
}

export interface ImageDimensions {
  width: number;
  height: number;
}

/** Non-blocking advice shown under the uploader after a successful upload. */
export function imageWarnings(slot: ImageSlot, dims: ImageDimensions | null, bytes: number): string[] {
  const out: string[] = [];
  const min = IMAGE_GUIDANCE[slot].minimum;
  if (dims && (dims.width < min.width || dims.height < min.height)) {
    out.push(
      'This image is ' + dims.width + '×' + dims.height + ' px. Use at least ' + min.width + '×' + min.height +
        ' px so it stays sharp.',
    );
  }
  if (bytes > IMAGE_WARN_BYTES) {
    out.push('Large file (' + Math.round(bytes / 1024) + ' KB). Under 600 KB loads faster for tenants.');
  }
  return out;
}

/** "feature/card/<uuid>.png". The id is lower-cased because the URL CHECK only accepts lowercase hex. */
export function newAnnouncementImagePath(slot: ImageSlot, mime: AnnouncementImageMime, id: string): string {
  return announcementImagePath(slot, id.toLowerCase(), mime);
}

/** "Square (1:1) · 1200×1200 px recommended · at least 800×800 px". */
export function imageGuidanceSummary(slot: ImageSlot): string {
  const g = IMAGE_GUIDANCE[slot];
  return (
    g.ratioLabel + ' · ' + g.recommended.width + '×' + g.recommended.height + ' px recommended · at least ' +
    g.minimum.width + '×' + g.minimum.height + ' px'
  );
}

/** Natural size of an image file, or null when the browser cannot decode it. Browser only. */
export function readImageDimensions(file: Blob): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
