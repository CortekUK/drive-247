"use client";

/**
 * Agreements v2: the agreement preview (build-spec D6, D8, D9, D11).
 *
 * "The preview must be very good — we've suffered a lot in v1 on this" (04:22).
 * v1 drew the template as web prose, which is not what the customer signs: the
 * signed document is a PDF our own renderer draws (app/api/esign/route.ts:
 * `parseHtmlToBlocks` + `renderBlocksToPdf`). This preview draws the same page
 * that renderer draws, so it never promises what the PDF lacks:
 *
 *  - An A4 sheet (595 × 842 pt) with the renderer's 50 pt margins, white, on a
 *    muted backdrop. Every size is in PDF points scaled to the sheet's width
 *    (container query units), so a line wraps here where it wraps there.
 *  - Helvetica, black. Body 10/14 pt; h1 16/22, h2 13/18 with the thin grey
 *    rule under it, h3 11/15, all bold. Bold, italic and underline are the only
 *    inline styles the PDF draws; links, strike-through, code and colour are
 *    drawn as plain text, so they are plain text here too.
 *  - Tables: equal-width columns, one line per cell (the PDF truncates a long
 *    cell, it never wraps it), a grey header row when the row has a `<th>`.
 *  - Lists with the renderer's bullet and number positions, rules, and left /
 *    centre / right alignment on paragraphs and headings. Empty paragraphs are
 *    dropped, as the PDF drops them.
 *  - `banner`: the indigo type banner the PDF draws above everything, uppercase
 *    (route.ts ~1473-1505; the individual send uses the document title).
 *  - The platform disclaimer, appended after the agreement exactly as the PDF
 *    appends it to every HTML agreement (route.ts ~1561-1564; the text below is
 *    pinned to `PLATFORM_DISCLAIMER_BLOCKS` by a test).
 *  - The signature block both send paths add when the agreement has no
 *    Signature field (`ensureSignatureTag`), marked as added automatically.
 *
 * Signer fields `{{@sig1}}` `{{@init1}}` `{{@date1}}` are drawn as labelled,
 * dashed boxes at the size the signing provider gives them (route.ts
 * TextTagDefinitions: 250 × 50, 100 × 40, 150 × 30 pt). The operator's own
 * signature image is drawn where it sits. Names nothing fills in (marked by
 * `renderAgreementHtml` in preview mode) are highlighted, so the operator sees
 * what the sent document will leave blank.
 *
 * SANITISED. The HTML is rebuilt from an allowlist before it is injected: no
 * scripts, styles, frames, event handlers, links or URLs survive, and the only
 * image allowed is the operator's signature as a PNG/JPEG data URL carrying
 * `data-operator-signature="true"`, and not inside a table cell or a list item
 * (the PDF drops it there). The HTML itself is never modified in a way
 * that leaks back: this component only reads it.
 */

import { useMemo, useSyncExternalStore } from "react";
import { SIGNATURE_FIELDS } from "@/lib/agreements-v2/types";
import { ensureSignatureTag, UNRESOLVED_ATTR } from "@/lib/agreements-v2/render";
import { OPERATOR_SIGNATURE_ATTR, isOperatorSignatureSrc } from "@/components/agreements-v2/editor/operator-signature";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* The fixed text the PDF adds                                                 */
/* -------------------------------------------------------------------------- */

/**
 * `PLATFORM_DISCLAIMER_BLOCKS` in app/api/esign/route.ts, word for word: a
 * rule, a bold heading paragraph and two paragraphs. A test lifts the route's
 * declaration and compares, so the two cannot drift.
 */
export const PLATFORM_DISCLAIMER_TITLE_V2 = "Platform Disclaimer";
export const PLATFORM_DISCLAIMER_PARAGRAPHS_V2: readonly string[] = [
  "The parties acknowledge that Drive247 is a software platform operated by Cortek Systems Ltd, which provides technology services solely to facilitate booking, documentation, and administrative processes for vehicle rental companies. Drive247 and Cortek Systems Ltd are not a party to this Rental Agreement and do not own, lease, manage, insure, or control any vehicles listed on the platform.",
  "All contractual obligations, responsibilities, and liabilities relating to the rental transaction, including vehicle condition, insurance coverage, payment collection, disputes, and claims, exist solely between the Rental Company and the Renter. Drive247 and Cortek Systems Ltd shall have no liability for any losses, damages, claims, disputes, or obligations arising from or relating to this rental transaction.",
];

/** What a signer-field box says under its label. */
export const FIELD_BOX_HINT_V2 = "Signer completes this";

/* -------------------------------------------------------------------------- */
/* Sanitising                                                                  */
/* -------------------------------------------------------------------------- */

/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "noembed",
  "noframes", "template", "svg", "math", "form", "input", "button", "textarea", "select", "option",
  "datalist", "link", "meta", "base", "title", "head", "audio", "video", "canvas", "picture", "source",
  "track", "map", "area", "xmp", "plaintext", "dialog", "slot", "portal",
]);

/** Kept as themselves (with no attributes unless listed below). Anything else is unwrapped. */
const KEEP = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "br", "hr", "ul", "ol",
  "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "span", "blockquote", "div", "sub", "sup",
  "code", "pre", "mark",
]);

/** The PDF reads `text-align` from these tags only (route.ts `extractAlign`). */
const ALIGNABLE = new Set(["p", "h1", "h2", "h3"]);
const ALIGN = /text-align:\s*(left|center|right)/i;
const IDENTIFIER = /^[A-Za-z_]\w*$/;
const TAG_SPLIT = /(\{\{@\w+\}\})/;
const TAG_EXACT = /^\{\{@\w+\}\}$/;

const FIELD_BY_TAG = new Map<string, (typeof SIGNATURE_FIELDS)[number]>(SIGNATURE_FIELDS.map((f) => [f.tag, f]));

function fieldBox(doc: Document, tag: string): HTMLElement {
  const field = FIELD_BY_TAG.get(tag);
  const box = doc.createElement("span");
  box.className = "agr-field";
  if (!field) {
    box.setAttribute("data-field", "unknown");
    box.setAttribute("title", "Not one of the signer fields (Signature, Initials, Date signed). It is left blank.");
    box.textContent = tag;
    return box;
  }
  box.setAttribute("data-field", field.key);
  box.setAttribute("role", "img");
  box.setAttribute("aria-label", `${field.label} field. ${FIELD_BOX_HINT_V2}.`);
  const label = doc.createElement("span");
  label.className = "agr-field-label";
  label.textContent = field.label;
  const hint = doc.createElement("span");
  hint.className = "agr-field-hint";
  hint.textContent = FIELD_BOX_HINT_V2;
  box.append(label, hint);
  return box;
}

/** Text, with each `{{@tag}}` turned into its box. */
function appendText(doc: Document, parent: Node, text: string, boxes: boolean) {
  if (!boxes || text.indexOf("{{@") === -1) {
    parent.appendChild(doc.createTextNode(text));
    return;
  }
  for (const part of text.split(TAG_SPLIT)) {
    if (!part) continue;
    parent.appendChild(TAG_EXACT.test(part) ? fieldBox(doc, part) : doc.createTextNode(part));
  }
}

/** Copy `from`'s children into `to`, keeping only what the allowlist allows. */
function copyClean(doc: Document, from: Node, to: Node, boxes: boolean) {
  from.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      appendText(doc, to, node.nodeValue ?? "", boxes);
      return;
    }
    if (node.nodeType !== 1) return; // comments, processing instructions
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) return;

    if (tag === "img") {
      const src = el.getAttribute("src");
      if (el.getAttribute(OPERATOR_SIGNATURE_ATTR) !== "true" || !isOperatorSignatureSrc(src)) return;
      // Both PDF renderers draw the signature only as a block of its own and
      // DROP it inside a table cell or a list item, so the preview drops it
      // there too rather than show what the signed document lacks.
      if (el.closest("td, th, li")) return;
      const img = doc.createElement("img");
      img.setAttribute(OPERATOR_SIGNATURE_ATTR, "true");
      img.setAttribute("src", src);
      img.setAttribute("alt", "Signature");
      to.appendChild(img);
      return;
    }

    if (!KEEP.has(tag)) {
      copyClean(doc, el, to, boxes); // unwrap: <a>, <font>, <section>, …
      return;
    }

    const clean = doc.createElement(tag);
    if (ALIGNABLE.has(tag)) {
      const align = (el.getAttribute("style") ?? "").match(ALIGN)?.[1]?.toLowerCase();
      if (align && align !== "left") clean.setAttribute("data-align", align);
    }
    // route.ts `parseTableRows`: a row with any <th> is a header row, drawn grey and bold.
    if (tag === "tr" && Array.from(el.children).some((c) => c.tagName.toLowerCase() === "th")) {
      clean.setAttribute("data-header", "true");
    }
    if (tag === "span") {
      const name = el.getAttribute(UNRESOLVED_ATTR);
      if (name && IDENTIFIER.test(name)) {
        clean.setAttribute(UNRESOLVED_ATTR, name);
        clean.setAttribute("title", "Nothing fills this in. It is left blank when the agreement is sent.");
      }
    }
    copyClean(doc, el, clean, boxes);
    // route.ts drops a paragraph with no words (`runs.some(r => r.text.trim())`).
    if (tag === "p" && !clean.textContent?.trim() && !clean.querySelector("img, .agr-field")) return;
    to.appendChild(clean);
  });
}

/**
 * Rebuild `html` from the allowlist. With `fieldBoxes` (the default) the
 * signer tags become boxes; without it they stay as text.
 *
 * Browser only: it parses with an inert `<template>`, where nothing executes
 * and no image loads.
 */
export function sanitizeAgreementHtmlV2(html: string, { fieldBoxes = true }: { fieldBoxes?: boolean } = {}): string {
  const template = document.createElement("template");
  template.innerHTML = html ?? "";
  const doc = template.content.ownerDocument ?? document;
  const out = doc.createElement("div");
  copyClean(doc, template.content, out, fieldBoxes);
  return out.innerHTML;
}

/** No words, no signer field and no signature image: nothing to show. */
export function isBlankAgreementHtml(html: string): boolean {
  const source = html ?? "";
  if (/<img\b[^>]*data-operator-signature/i.test(source)) return false;
  return (
    source
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;| /g, " ")
      .trim() === ""
  );
}

export interface PreparedAgreementPreviewV2 {
  empty: boolean;
  /** The agreement, sanitised, fields as boxes. */
  body: string;
  /** The signature block the send path adds because the agreement has no Signature field, or "". */
  autoSignature: string;
  /** How many names nothing fills in. */
  unresolved: number;
}

export function prepareAgreementPreviewV2(html: string): PreparedAgreementPreviewV2 {
  const source = html ?? "";
  if (isBlankAgreementHtml(source)) return { empty: true, body: "", autoSignature: "", unresolved: 0 };
  const ensured = ensureSignatureTag(source);
  const added = ensured.length > source.length ? ensured.slice(source.length) : "";
  const body = sanitizeAgreementHtmlV2(source);
  const unresolved = (body.match(new RegExp(`<span ${UNRESOLVED_ATTR}=`, "g")) ?? []).length;
  return { empty: false, body, autoSignature: added ? sanitizeAgreementHtmlV2(added) : "", unresolved };
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sizes are PDF points. `--pt` is one point of the page (the sheet is 595 pt
 * wide), `--u` one point of type: the same until the sheet is so narrow that
 * 10 pt body text would fall under 10 px, where type stops shrinking so it
 * stays readable on a phone.
 */
const PREVIEW_CSS = `
.agr-preview-v2 .agr-frame{container-type:inline-size;width:100%;max-width:794px;margin:0 auto}
.agr-preview-v2 .agr-sheet{--pt:calc(100cqw / 595);--fs:max(10px, calc(100cqw * 10 / 595));--u:calc(var(--fs) / 10);box-sizing:border-box;width:100%;min-height:calc(100cqw * 842 / 595);padding:calc(var(--pt) * 50);background:#fff;color:#000;border:1px solid hsl(var(--border));font-family:Helvetica,Arial,"Liberation Sans","Nimbus Sans",sans-serif;font-size:var(--fs);line-height:calc(var(--u) * 14);font-weight:400;overflow-wrap:break-word;text-align:left}
.agr-preview-v2 .agr-banner{box-sizing:border-box;height:calc(var(--pt) * 32);margin-bottom:calc(var(--pt) * 16);display:flex;align-items:center;justify-content:center;background:#edf0fa;border:calc(var(--pt) * 1) solid #6366f2;color:#3d4096;font-weight:700;font-size:calc(var(--u) * 11);line-height:1;white-space:nowrap;overflow:hidden;padding:0 calc(var(--pt) * 6)}
.agr-preview-v2 .agr-doc *{margin:0;padding:0;font-size:inherit;font-weight:inherit;font-style:inherit;text-decoration:none;color:inherit;background:none;border:0;font-family:inherit;vertical-align:baseline}
.agr-preview-v2 .agr-doc strong,.agr-preview-v2 .agr-doc b{font-weight:700}
.agr-preview-v2 .agr-doc em,.agr-preview-v2 .agr-doc i{font-style:italic}
.agr-preview-v2 .agr-doc u{text-decoration:underline;text-decoration-thickness:calc(var(--u) * .5);text-underline-offset:calc(var(--u) * 1.5)}
.agr-preview-v2 .agr-doc br{display:none}
.agr-preview-v2 .agr-doc p,.agr-preview-v2 .agr-doc h4,.agr-preview-v2 .agr-doc h5,.agr-preview-v2 .agr-doc h6,.agr-preview-v2 .agr-doc pre{display:block;white-space:normal;line-height:calc(var(--u) * 14);padding-bottom:calc(var(--u) * 2)}
.agr-preview-v2 .agr-doc h1{font-size:calc(var(--u) * 16);line-height:calc(var(--u) * 22);font-weight:700;padding-top:calc(var(--u) * 14);padding-bottom:calc(var(--u) * 4)}
.agr-preview-v2 .agr-doc h2{font-size:calc(var(--u) * 13);line-height:calc(var(--u) * 18);font-weight:700;padding-top:calc(var(--u) * 12);padding-bottom:calc(var(--u) * 8.5);border-bottom:calc(var(--u) * .5) solid #ccc;margin-bottom:0}
.agr-preview-v2 .agr-doc h3{font-size:calc(var(--u) * 11);line-height:calc(var(--u) * 15);font-weight:700;padding-top:calc(var(--u) * 8);padding-bottom:calc(var(--u) * 2)}
.agr-preview-v2 .agr-doc h1 *,.agr-preview-v2 .agr-doc h2 *,.agr-preview-v2 .agr-doc h3 *{font-weight:700}
.agr-preview-v2 .agr-doc [data-align=center]{text-align:center}
.agr-preview-v2 .agr-doc [data-align=right]{text-align:right}
.agr-preview-v2 .agr-doc hr{display:block;height:0;border-top:calc(var(--u) * .5) solid #b3b3b3;margin:calc(var(--u) * 8) 0}
.agr-preview-v2 .agr-doc ul,.agr-preview-v2 .agr-doc ol{display:block;list-style:none;padding-top:calc(var(--u) * 2);padding-bottom:calc(var(--u) * 4);counter-reset:agr-item}
.agr-preview-v2 .agr-doc li{display:block;position:relative;line-height:calc(var(--u) * 14);padding-left:calc(var(--u) * 17);counter-increment:agr-item}
.agr-preview-v2 .agr-doc ol>li{padding-left:calc(var(--u) * 22)}
.agr-preview-v2 .agr-doc li>*{display:inline;padding:0}
.agr-preview-v2 .agr-doc li>ul,.agr-preview-v2 .agr-doc li>ol{display:block;padding-bottom:0}
.agr-preview-v2 .agr-doc ul>li::before{content:"\\2022";position:absolute;left:calc(var(--u) * 8)}
.agr-preview-v2 .agr-doc ol>li::before{content:counter(agr-item) ".";position:absolute;left:calc(var(--u) * 8)}
.agr-preview-v2 .agr-doc table{display:table;width:100%;table-layout:fixed;border-collapse:collapse;margin:calc(var(--u) * 6) 0}
.agr-preview-v2 .agr-doc td,.agr-preview-v2 .agr-doc th{border:calc(var(--u) * .5) solid #ccc;padding:calc(var(--u) * 6);line-height:calc(var(--u) * 14);font-weight:400;text-align:left;vertical-align:top;white-space:nowrap;overflow:hidden;text-overflow:clip}
.agr-preview-v2 .agr-doc td *,.agr-preview-v2 .agr-doc th *{display:inline;padding:0;font-weight:inherit;font-style:normal;text-decoration:none}
.agr-preview-v2 .agr-doc tr[data-header] td,.agr-preview-v2 .agr-doc tr[data-header] th{background:#f0f0f5;font-weight:700}
.agr-preview-v2 .agr-doc img[data-operator-signature]{display:block;max-width:calc(var(--pt) * 200);max-height:calc(var(--pt) * 70);width:auto;height:auto;margin:calc(var(--u) * 4) 0}
.agr-preview-v2 .agr-doc .agr-field{display:inline-flex;flex-direction:column;justify-content:center;box-sizing:border-box;max-width:100%;vertical-align:top;border:1.5px dashed currentColor;border-radius:4px;padding:0 calc(var(--pt) * 8);line-height:1.2;white-space:nowrap;overflow:hidden;font-style:normal;text-decoration:none}
.agr-preview-v2 .agr-doc .agr-field-label{display:block;font-weight:700;font-size:calc(var(--u) * 9)}
.agr-preview-v2 .agr-doc .agr-field-hint{display:block;font-weight:400;font-size:calc(var(--u) * 7);opacity:.8}
.agr-preview-v2 .agr-doc .agr-field[data-field=signature]{width:calc(var(--pt) * 250);height:calc(var(--pt) * 50);color:#4f46e5;background:#eef2ff}
.agr-preview-v2 .agr-doc .agr-field[data-field=initials]{width:calc(var(--pt) * 100);height:calc(var(--pt) * 40);color:#b45309;background:#fffbeb}
.agr-preview-v2 .agr-doc .agr-field[data-field=date]{width:calc(var(--pt) * 150);height:calc(var(--pt) * 30);color:#1d4ed8;background:#eff6ff}
.agr-preview-v2 .agr-doc .agr-field[data-field=unknown]{display:inline;padding:0 2px;color:#b91c1c;background:#fef2f2;font-weight:400}
.agr-preview-v2 .agr-doc span[data-unresolved]{background:#fef3c7;color:#92400e;border-bottom:1px dashed #d97706;border-radius:2px;padding:0 1px}
.agr-preview-v2 .agr-auto{position:relative;margin-top:calc(var(--u) * 6);padding:calc(var(--u) * 4) calc(var(--u) * 6);border:1px dashed #a5b4fc;border-radius:4px}
.agr-preview-v2 .agr-auto-note{display:block;margin-bottom:calc(var(--u) * 2);font-size:max(9px, calc(var(--u) * 7.5));line-height:1.3;color:#4f46e5}
.agr-preview-v2 .agr-empty{padding-top:calc(var(--pt) * 40);text-align:center;color:#737373;font-style:italic}
`;

const noopSubscribe = () => () => {};

/**
 * True in the browser, false on the server and during hydration: the preview
 * parses HTML with the DOM, so the server renders the empty sheet and the
 * client fills it in without a hydration mismatch.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function AgreementPreviewV2({
  html,
  banner,
  className,
  disclaimer = true,
  unresolvedNote,
}: {
  /** The rendered agreement (renderAgreementHtml in 'preview' mode, or a sent snapshot). */
  html: string;
  /** The PDF's banner text, e.g. "ORIGINAL RENTAL AGREEMENT" or the document title. Drawn uppercase. */
  banner?: string;
  className?: string;
  /**
   * Draw the platform disclaimer the PDF appends to every HTML agreement.
   * Default true. Pass false only for a renderer that does not append it.
   */
  disclaimer?: boolean;
  /**
   * The sentence above the page when some names have nothing to fill them in.
   * The default says only that they print blank; a caller that knows WHY (an
   * individual agreement has no rental) passes words that say so, and what to do.
   */
  unresolvedNote?: (count: number) => string;
}) {
  const isClient = useIsClient();
  const prepared = useMemo(() => (isClient ? prepareAgreementPreviewV2(html) : null), [html, isClient]);
  const bannerText = banner?.trim().toUpperCase();

  return (
    <div className={cn("agr-preview-v2 w-full overflow-y-auto bg-muted p-3 sm:p-6", className)} data-slot="agreement-preview-v2">
      <style>{PREVIEW_CSS}</style>
      <div className="agr-frame">
        {prepared && prepared.unresolved > 0 && (
          <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span aria-hidden="true" className="inline-block h-3 w-5 shrink-0 rounded-sm border border-dashed border-amber-500 bg-amber-100" />
            {unresolvedNote
              ? unresolvedNote(prepared.unresolved)
              : prepared.unresolved === 1
                ? "1 highlighted name has nothing to fill it in, so it is left blank when the agreement is sent."
                : `${prepared.unresolved} highlighted names have nothing to fill them in, so they are left blank when the agreement is sent.`}
          </p>
        )}
        <article className="agr-sheet" aria-label="Agreement preview">
          {bannerText && (
            <div className="agr-banner" data-slot="agreement-banner">
              {bannerText}
            </div>
          )}
          {prepared === null ? null : prepared.empty ? (
            <p className="agr-empty">Nothing to preview yet. Start writing the agreement to see it here.</p>
          ) : (
            <>
              <div className="agr-doc" data-slot="agreement-body" dangerouslySetInnerHTML={{ __html: prepared.body }} />
              {prepared.autoSignature && (
                <div className="agr-auto" data-slot="agreement-auto-signature">
                  <span className="agr-auto-note">
                    Added when it is sent, because the agreement has no Signature field.
                  </span>
                  <div className="agr-doc" dangerouslySetInnerHTML={{ __html: prepared.autoSignature }} />
                </div>
              )}
              {disclaimer && (
                <div className="agr-doc" data-slot="agreement-disclaimer">
                  <hr />
                  <p>
                    <strong>{PLATFORM_DISCLAIMER_TITLE_V2}</strong>
                  </p>
                  {PLATFORM_DISCLAIMER_PARAGRAPHS_V2.map((text) => (
                    <p key={text.slice(0, 24)}>{text}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </article>
      </div>
    </div>
  );
}

