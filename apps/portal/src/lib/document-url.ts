"use client";

/**
 * Signed links for files in the `customer-documents` storage bucket (QA I4.13).
 *
 * The bucket is PUBLIC today, so anyone holding a file's address can download it:
 * another customer's insurance certificate, licence photos, selfies. It is to be
 * made private (supabase/migrations/GO_LIVE_customer_documents_private.sql.txt)
 * once every reader opens files through a short-lived signed link instead of the
 * stored public address. Use these helpers for every stored document reference:
 * a stored public URL or a bare storage path both work; any other address (a
 * different bucket, an external host) is returned unchanged.
 *
 * Signing is decided by the storage policies (staff of the owning tenant, the
 * customer it belongs to, an open ID-check session, an open booking-documents
 * link), so a signed link is only ever issued to someone allowed to see the file.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

/**
 * A short-lived link for a stored document reference. Returns the value unchanged
 * when it is not a customer-documents file, and null when signing is refused.
 */
export async function signedDocumentUrl(
  value: string | null | undefined,
  options: { expiresIn?: number; download?: string | boolean } = {}
): Promise<string | null> {
  if (!value) return null;
  const path = toDocumentPath(value);
  if (!path) return value;
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(path, options.expiresIn ?? SIGNED_DOCUMENT_SECONDS, options.download ? { download: options.download } : undefined);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Sign many at once (lists of images); keeps the input order, nulls where refused. */
export async function signedDocumentUrls(values: Array<string | null | undefined>): Promise<Array<string | null>> {
  return Promise.all(values.map((v) => signedDocumentUrl(v)));
}

/** For <img src> and links: the signed link, refreshed before it expires. */
export function useSignedDocumentUrl(value: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ["signed-document-url", value ?? null],
    queryFn: () => signedDocumentUrl(value),
    enabled: !!value,
    staleTime: (SIGNED_DOCUMENT_SECONDS - 60) * 1000,
    refetchInterval: (SIGNED_DOCUMENT_SECONDS - 60) * 1000,
  });
  return data ?? null;
}

/**
 * Open a stored document in a new tab. The tab is opened first (inside the click,
 * so popup blockers allow it) and pointed at the signed link once it is ready.
 */
export async function openDocument(value: string | null | undefined, options: { download?: string | boolean } = {}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const tab = window.open("", "_blank");
  const url = await signedDocumentUrl(value, options);
  if (!url) {
    tab?.close();
    return false;
  }
  if (tab && !tab.closed) tab.location.href = url;
  else window.open(url, "_blank");
  return true;
}
