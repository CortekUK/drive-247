/**
 * Server-safe half of `document-url.ts` (QA I4.13): turns a stored reference into
 * the object path inside the `customer-documents` bucket. No "use client", so API
 * routes can import it; the browser helpers re-export it from `document-url.ts`.
 */
export const DOCUMENT_BUCKET = "customer-documents";
/** Long enough to read and save; short enough that a forwarded link goes stale. */
export const SIGNED_DOCUMENT_SECONDS = 60 * 10;

const MARKERS = [
  "/storage/v1/object/public/customer-documents/",
  "/storage/v1/object/sign/customer-documents/",
  "/storage/v1/object/authenticated/customer-documents/",
  "/storage/v1/object/customer-documents/",
];

/** The storage path inside customer-documents, or null when `value` is not one of ours. */
export function toDocumentPath(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const marker of MARKERS) {
    const at = value.indexOf(marker);
    if (at >= 0) return decodeURIComponent(value.slice(at + marker.length).split("?")[0]);
  }
  if (/^(https?:|data:|blob:)/i.test(value)) return null;
  return value.replace(/^\/+/, "").replace(/^customer-documents\//, "");
}
