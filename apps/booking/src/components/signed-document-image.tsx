"use client";

/**
 * QA I4.13: signed link (bucket going private).
 * <img> / <BlurredImage> for a stored `customer-documents` reference (public URL
 * or bare path). The stored value is swapped for a short-lived signed link;
 * nothing renders until it is ready (the surrounding box keeps the layout).
 * Any other address (another bucket, an external host) is shown as it is.
 */
import type { ComponentProps, ImgHTMLAttributes } from "react";

import { BlurredImage } from "@/components/ui/blurred-image";
import { useSignedDocumentUrl } from "@/lib/document-url";

type SignedImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | null | undefined;
};

export function SignedImg({ src, alt, ...rest }: SignedImgProps) {
  const signed = useSignedDocumentUrl(src);
  if (!signed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={signed} alt={alt} {...rest} />;
}

type SignedBlurredImageProps = Omit<ComponentProps<typeof BlurredImage>, "src"> & {
  src: string | null | undefined;
};

export function SignedBlurredImage({ src, ...rest }: SignedBlurredImageProps) {
  const signed = useSignedDocumentUrl(src);
  if (!signed) return null;
  return <BlurredImage src={signed} {...rest} />;
}
