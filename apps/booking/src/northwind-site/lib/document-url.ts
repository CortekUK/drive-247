"use client";

/**
 * Signed links for the `customer-documents` bucket on the Northwind sites
 * (QA I4.13: the bucket is going private). Same API as `@/lib/document-url`, but
 * signs with the Northwind client (`@nw/integrations/supabase/client`) so these
 * pages never construct the legacy app's second Supabase auth client.
 *
 * A stored public URL or a bare storage path both work; any other address (a
 * different bucket, an external host) is returned unchanged; null when refused.
 */
import { useQuery } from "@tanstack/react-query";

import { DOCUMENT_BUCKET, SIGNED_DOCUMENT_SECONDS, toDocumentPath } from "@/lib/document-path";
import { supabase } from "@nw/integrations/supabase/client";

export { DOCUMENT_BUCKET, SIGNED_DOCUMENT_SECONDS, toDocumentPath };

export async function signedDocumentUrl(
  value: string | null | undefined,
  options: { expiresIn?: number; download?: string | boolean } = {},
): Promise<string | null> {
  if (!value) return null;
  const path = toDocumentPath(value);
  if (!path) return value;
  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(
      path,
      options.expiresIn ?? SIGNED_DOCUMENT_SECONDS,
      options.download ? { download: options.download } : undefined,
    );
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function signedDocumentUrls(
  values: Array<string | null | undefined>,
): Promise<Array<string | null>> {
  return Promise.all(values.map((v) => signedDocumentUrl(v)));
}

/** For <img src> and links: the signed link, refreshed before it expires. */
export function useSignedDocumentUrl(value: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ["nw-signed-document-url", value ?? null],
    queryFn: () => signedDocumentUrl(value),
    enabled: !!value,
    staleTime: (SIGNED_DOCUMENT_SECONDS - 60) * 1000,
    refetchInterval: (SIGNED_DOCUMENT_SECONDS - 60) * 1000,
  });
  return data ?? null;
}

/**
 * Open a stored document in a new tab. The tab is opened inside the click (so
 * popup blockers allow it) and pointed at the signed link once it is ready.
 */
export async function openDocument(
  value: string | null | undefined,
  options: { download?: string | boolean } = {},
): Promise<boolean> {
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
