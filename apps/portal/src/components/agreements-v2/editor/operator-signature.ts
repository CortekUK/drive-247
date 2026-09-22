/**
 * Agreements v2: the one rule for the operator's signature image (build-spec D9).
 *
 * An agreement can carry exactly one kind of image, the operator's own
 * signature, as
 *   <img data-operator-signature="true" src="data:image/png;base64,…" alt="Signature">
 * The PDF renderers draw that element and ignore every other `<img>`, so the
 * editor (which parses it) and the preview (which sanitises it) must agree on
 * exactly what counts. Both import this file, which pulls in nothing else, so
 * the preview does not drag the editor's Tiptap bundle in with it.
 *
 * The rule is the same as `isValidOperatorSignature`
 * (hooks/use-operator-signature-v2.ts) and the CHECK on
 * `agreement_operator_signatures_v2.image_data` (ops/agreements_v2.sql): a PNG
 * or JPEG base64 data URL of at most 512 000 characters. It is repeated here
 * rather than imported so neither the preview nor the editor pulls the
 * Supabase client in; a test pins the two together.
 */

import { OPERATOR_SIGNATURE_ATTR } from "@/lib/agreements-v2/types";

export { OPERATOR_SIGNATURE_ATTR };

export const OPERATOR_SIGNATURE_MAX_LENGTH = 512_000;

const OPERATOR_SIGNATURE_SRC = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Is this a PNG or JPEG base64 data URL within the size cap? Nothing else is. */
export function isOperatorSignatureSrc(src: unknown): src is string {
  return typeof src === "string" && src.length <= OPERATOR_SIGNATURE_MAX_LENGTH && OPERATOR_SIGNATURE_SRC.test(src);
}

/** The exact element "Save and use" / "Use my signature" puts into the document. */
export function operatorSignatureHtml(src: string): string {
  if (!isOperatorSignatureSrc(src)) throw new Error("The signature must be a PNG or JPEG image.");
  return `<img ${OPERATOR_SIGNATURE_ATTR}="true" src="${src}" alt="Signature">`;
}
