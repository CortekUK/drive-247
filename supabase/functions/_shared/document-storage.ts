/**
 * Server-side access to files in the `customer-documents` bucket (QA I4.13).
 * The bucket is to go private, so functions must not rely on a stored PUBLIC URL:
 * fetching it (or handing it to an outside service such as an AI model) stops
 * working. Download with the service role, or hand out a short-lived signed URL.
 */
export const DOCUMENT_BUCKET = 'customer-documents';

const MARKERS = [
  '/storage/v1/object/public/customer-documents/',
  '/storage/v1/object/sign/customer-documents/',
  '/storage/v1/object/authenticated/customer-documents/',
  '/storage/v1/object/customer-documents/',
];

/** The storage path inside customer-documents, or null when `value` is not one of ours. */
export function toDocumentPath(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const marker of MARKERS) {
    const at = value.indexOf(marker);
    if (at >= 0) return decodeURIComponent(value.slice(at + marker.length).split('?')[0]);
  }
  if (/^(https?:|data:|blob:)/i.test(value)) return null;
  return value.replace(/^\/+/, '').replace(/^customer-documents\//, '');
}

/** A signed URL (default 1 hour) for a stored reference; other addresses are returned unchanged. */
// deno-lint-ignore no-explicit-any
export async function signedDocumentUrl(supabase: any, value: string | null | undefined, expiresIn = 3600): Promise<string | null> {
  if (!value) return null;
  const path = toDocumentPath(value);
  if (!path) return value;
  const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    console.warn('[document-storage] could not sign', path, error?.message);
    return null;
  }
  return data.signedUrl;
}

/** Download a stored reference with the service role; falls back to fetch() for other addresses. */
// deno-lint-ignore no-explicit-any
export async function downloadDocument(supabase: any, value: string): Promise<Blob | null> {
  const path = toDocumentPath(value);
  if (path) {
    const { data, error } = await supabase.storage.from(DOCUMENT_BUCKET).download(path);
    if (error || !data) {
      console.warn('[document-storage] could not download', path, error?.message);
      return null;
    }
    return data as Blob;
  }
  const res = await fetch(value);
  return res.ok ? await res.blob() : null;
}
