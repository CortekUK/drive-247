/**
 * Rewrites a Supabase Storage *public object* URL to the on-the-fly image
 * transformation endpoint so we serve a resized/compressed image instead of
 * the multi-megabyte original. Browsers that accept WebP automatically get it.
 *
 * Example:
 *   .../storage/v1/object/public/vehicle-photos/abc.jpg
 *   -> .../storage/v1/render/image/public/vehicle-photos/abc.jpg?width=800&quality=65
 *
 * Non-Supabase URLs (or already-transformed ones) are returned untouched.
 */
export interface OptimizeImageOptions {
  width?: number;
  height?: number;
  /** 1-100, defaults to 70 */
  quality?: number;
  /** how the image fits the target box; defaults to "contain" */
  resize?: "cover" | "contain" | "fill";
}

const PUBLIC_MARKER = "/storage/v1/object/public/";

export function optimizedImageUrl(
  url: string | null | undefined,
  opts: OptimizeImageOptions = {},
): string {
  if (!url) return url ?? "";
  // Already transformed, or not a Supabase public object URL — leave as-is.
  if (url.includes("/render/image/")) return url;
  const idx = url.indexOf(PUBLIC_MARKER);
  if (idx === -1) return url;

  const base = url.slice(0, idx);
  const rest = url.slice(idx + PUBLIC_MARKER.length); // "<bucket>/<path>"

  const params = new URLSearchParams();
  if (opts.width) params.set("width", String(opts.width));
  if (opts.height) params.set("height", String(opts.height));
  params.set("quality", String(opts.quality ?? 70));
  params.set("resize", opts.resize ?? "contain");

  return `${base}/storage/v1/render/image/public/${rest}?${params.toString()}`;
}
