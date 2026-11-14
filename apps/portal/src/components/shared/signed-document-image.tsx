"use client";

/**
 * QA I4.13: signed link (bucket going private).
 *
 * A plain <img> for a stored document reference. Files in `customer-documents`
 * (ID-check photos, certificates) are shown through a short-lived signed link;
 * any other address (other buckets, external hosts) is used as given. Nothing
 * is rendered for a customer-documents file until its link is ready.
 */
import type { ImgHTMLAttributes } from "react";
import { toDocumentPath, useSignedDocumentUrl } from "@/lib/document-url";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
};

export function useDocumentSrc(src: string | null | undefined): string | null {
  const signed = useSignedDocumentUrl(src);
  if (!src) return null;
  return toDocumentPath(src) ? signed : src;
}

export function SignedDocumentImage({ src, alt, ...rest }: Props) {
  const shown = useDocumentSrc(src);
  if (!shown) return null;
  return <img src={shown} alt={alt} {...rest} />;
}
