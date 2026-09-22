/**
 * agreements-v2 edge function — the PDF the browser drew and sent. PURE.
 *
 * The browser renders the PDF from the exact final html its preview shows
 * (apps/portal/src/lib/agreements-v2/pdf.ts) and sends it as base64. Nothing
 * here trusts that: the value must be non-empty base64 that decodes, the bytes
 * must start with `%PDF`, and the document may be at most 10 MB. The size is
 * checked on the base64 length BEFORE decoding, so an oversized body is
 * refused without allocating it twice.
 */

export const PDF_MAX_BYTES = 10 * 1024 * 1024;

export interface PdfInputResult {
  ok: boolean;
  bytes?: Uint8Array;
  error?: string;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL_PREFIX = /^data:application\/pdf;base64,/i;

export function decodePdfBase64(value: unknown): PdfInputResult {
  const fail = (error: string): PdfInputResult => ({ ok: false, error });
  if (typeof value !== 'string' || !value.trim()) return fail('The agreement PDF is missing.');

  const b64 = value.trim().replace(DATA_URL_PREFIX, '').replace(/\s+/g, '');
  if (!b64) return fail('The agreement PDF is missing.');
  if (b64.length % 4 !== 0 || !BASE64.test(b64)) return fail('The agreement PDF could not be read.');

  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const size = (b64.length / 4) * 3 - padding;
  if (size > PDF_MAX_BYTES) return fail('The agreement PDF is larger than 10 MB. Shorten it and try again.');

  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return fail('The agreement PDF could not be read.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // %PDF
  if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return fail('The agreement PDF is not a PDF.');
  }
  return { ok: true, bytes };
}

/** Bytes as base64, in chunks so a multi-megabyte signed PDF never overflows the call stack. Deno has no Buffer. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
