/**
 * Agreements v2: what a brand-new agreement starts with (build-spec, "Details
 * from the video frames", 12:19), and the ONE definition of its signatures
 * section, shared by the editor, the templates section and the send dialog.
 *
 * The lead's signature block has two sides: FOR THE COMPANY (the operator's
 * own signature, name, title, date) and FOR THE CUSTOMER (the signer's
 * Signature field and Date signed). The PDF renderer has no columns, so the
 * two sides are written one after the other, the company first, which reads
 * correctly as one column in the PDF and in the preview.
 */
import { DEFAULT_AGREEMENT_TEMPLATE } from "@/lib/default-agreement-template";
import { SIGNATURE_FIELDS } from "@/lib/agreements-v2/types";

/**
 * The signatures section a new template ends with (the lead's frame at 12:19):
 * FOR THE COMPANY (the operator's own signature, name, title and date), then
 * FOR THE CUSTOMER (the signer's Signature and Date signed fields).
 *
 * ONE COLUMN IN THE SOURCE, on purpose. The PDF renderers have no columns, so
 * the section is written in reading order, the company block first and then
 * the customer block, and reads correctly as one column; drawing the two side
 * by side is the preview's presentation, not the document's structure.
 *
 * The company "Signature:" line is where the editor's "Your signature" puts
 * the operator's saved signature. Until something is put there, it and the
 * empty "Name:" and "Title:" lines are dropped from the preview and the sent
 * PDF alike (both remove a bold label with nothing after it), so an unfilled
 * line never prints as a blank to sign. `{{@sig1}}` and `{{@date1}}` are the
 * signing provider's text tags and appear exactly once.
 */
export const SIGNATURES_SECTION_V2 = [
  "<h2>Signatures</h2>",
  "<h3>FOR THE COMPANY</h3>",
  "<p><strong>Company:</strong> {{company_name}}</p>",
  "<p><strong>Signature:</strong> </p>",
  "<p><strong>Name:</strong> </p>",
  "<p><strong>Title:</strong> </p>",
  "<p><strong>Date:</strong> {{agreement_date}}</p>",
  "<h3>FOR THE CUSTOMER</h3>",
  "<p><strong>Name:</strong> {{customer_name}}</p>",
  "<p><strong>Signature:</strong> {{@sig1}}</p>",
  "<p><strong>Date signed:</strong> {{@date1}}</p>",
].join("\n");

/**
 * The sign-off line the clause injection anchors on
 * (lib/agreement-injection.ts `insertBeforeSignature`): terms, the Bonzah
 * addendum and the handover times go above it, so they can never land between
 * the company block and the customer block.
 */
const ACKNOWLEDGEMENT_V2 = "<p><strong>By signing below, both parties agree to the terms of this agreement.</strong></p>";
const BY_SIGNING_BELOW = /<p>\s*<strong>\s*By signing below/i;
/** Any of the three signer-1 text tags. */
const SIGNER_TAG = /\{\{@(?:sig1|init1|date1)\}\}/;

/** Markup compared without the whitespace and empty paragraphs an editor round trip changes. */
const squash = (html: string) =>
  html
    .replace(/<p>(?:\s|&nbsp;|\u00a0)*<\/p>/gi, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();

/** The built-in standard agreement's own closing section: underscore lines, no fields. */
const BUILT_IN_SIGNATURES = squash(DEFAULT_AGREEMENT_TEMPLATE.slice(DEFAULT_AGREEMENT_TEMPLATE.lastIndexOf("<hr")));

/**
 * End `html` with the signatures section, never twice and never over wording
 * the operator wrote:
 *  - a document that already carries a signer field is returned unchanged
 *    (each field may be placed once, and its signing section is its own);
 *  - the built-in agreement's underscore-line signatures section, when the
 *    document still ends with it word for word, is replaced by this one;
 *  - otherwise the section is appended, after a "By signing below" line when
 *    the document has none.
 */
export function withSignaturesSectionV2(html: string): string {
  const doc = html ?? "";
  if (SIGNER_TAG.test(doc)) return doc;
  let body = doc;
  const lastHr = body.lastIndexOf("<hr");
  if (lastHr !== -1 && squash(body.slice(lastHr)) === BUILT_IN_SIGNATURES) body = body.slice(0, lastHr);
  body = body.trimEnd();
  const acknowledgement = BY_SIGNING_BELOW.test(body) ? "" : `${ACKNOWLEDGEMENT_V2}\n`;
  return `${body}${body ? "\n\n" : ""}${acknowledgement}<hr>\n${SIGNATURES_SECTION_V2}\n`;
}

/** The editor's names for the same section, kept so the two can never differ. */
export const AGREEMENT_SIGNATURES_SECTION_V2 = SIGNATURES_SECTION_V2;
export const withSignaturesSection = withSignaturesSectionV2;

/**
 * A blank agreement: a title, an opening line to write the terms after, and
 * the signatures (with the "By signing below" sign-off the clause injection
 * anchors on, so terms can never land under the signatures).
 */
export const AGREEMENT_STARTER_V2 = withSignaturesSectionV2(
  "<h1>Agreement</h1><p>This agreement is made on {{agreement_date}} between {{company_name}} and {{customer_name}}.</p>",
);

/* -------------------------------------------------------------------------- */
/* Each signer field once                                                      */
/* -------------------------------------------------------------------------- */

/** How many times a tag appears in the document. Plain text search: the tag is text. */
export function countTag(content: string, tag: string): number {
  if (!tag) return 0;
  const doc = content ?? "";
  let count = 0;
  for (let at = doc.indexOf(tag); at !== -1; at = doc.indexOf(tag, at + tag.length)) count++;
  return count;
}

/** The signer fields (`{{@sig1}}`, `{{@init1}}`, `{{@date1}}`) that appear more than once, with how often. */
export function duplicatedSignerFieldsV2(content: string): Array<{ label: string; tag: string; count: number }> {
  return SIGNATURE_FIELDS.map((f) => ({ label: f.label, tag: f.tag, count: countTag(content, f.tag) })).filter((f) => f.count > 1);
}

/**
 * Why this document cannot be saved or sent as it is, or null. The send path
 * defines each signer tag ONCE, for signer 1; a document with a tag in it
 * twice can confuse the signing service, so the editor's Save and the send
 * dialog's Send both refuse it until only one of each is left.
 */
export function duplicateSignerFieldsReasonV2(content: string): string | null {
  const dupes = duplicatedSignerFieldsV2(content);
  if (dupes.length === 0) return null;
  const why = "a signer field that appears more than once can confuse the signing service.";
  if (dupes.length === 1) return `${dupes[0].label} is in the agreement ${dupes[0].count} times. Keep one — ${why}`;
  const labels = dupes.map((d) => d.label);
  const list = `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${list} are each in the agreement more than once. Keep one of each — ${why}`;
}
