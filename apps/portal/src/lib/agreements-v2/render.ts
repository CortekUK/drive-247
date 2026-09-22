/**
 * Agreements v2 — the ONE substitution pipeline the v2 preview and the v2
 * individual send share.
 *
 * WHY ONE PIPELINE
 * Agreements already have four substitution sites that must stay in step
 * (portal /api/esign, booking /api/esign, create-boldsign-document and the
 * editor preview), and every defect class found in signed contracts so far
 * came from two of them disagreeing: the preview renders a variable the send
 * path prints raw, and nothing looks wrong until a customer reads it. v2 does
 * not add a fifth independent site. The preview and the individual send both
 * call `renderAgreementHtml`, and they differ in exactly one step, which is
 * the `mode` argument:
 *
 *   'send'    unresolved `{{names}}` are STRIPPED, exactly as /api/esign does,
 *             because raw markup in a legal document reads as broken software.
 *   'preview' unresolved `{{names}}` are MARKED (`<span data-unresolved>`), so
 *             the operator can see what the send will leave blank.
 *
 * WHAT IT REUSES, rather than re-implements
 *  - `replaceVariables` (lib/template-variables.ts), the preview engine: the
 *    `{{#if is_gig_driver}}` / `{{#if is_payg}}` blocks and the 2–3 brace
 *    tolerance for every catalogued key.
 *  - `stripUnresolvedPlaceholders` (lib/unresolved-placeholders.ts), the same
 *    stripper /api/esign runs.
 *  - `decodeHtmlEntities` (lib/html-entities.ts), the decoder the PDF path
 *    uses, which decodes `&amp;` LAST so escaped text never double-decodes.
 *
 * WHAT IT NEVER TOUCHES
 * BoldSign's text tags `{{@sig1}}`, `{{@init1}}` and `{{@date1}}`. They are
 * consumed by the signing provider after the PDF is handed over; removing one
 * produces a document with no field, which cannot be signed. Every pattern in
 * this file requires a name that starts with a letter or underscore, so a tag
 * beginning with `@` cannot match.
 */

import { replaceVariables, formatDate, TEMPLATE_VARIABLES } from '@/lib/template-variables';
import { stripUnresolvedPlaceholders } from '@/lib/unresolved-placeholders';
import { decodeHtmlEntities } from '@/lib/html-entities';
import { formatZonedDate } from '@/lib/agreement-datetime';

export type RenderModeV2 = 'preview' | 'send';

/** The attribute the preview puts on an unresolved `{{name}}`, for styling. */
export const UNRESOLVED_ATTR = 'data-unresolved';

/** The block /api/esign appends when a rendered template has no `{{@sig1}}`. */
const SIGNATURE_FALLBACK_HTML = '<hr><h3>Signature</h3><p>Customer Signature: {{@sig1}}</p>';

/** A leftover placeholder, matched the way the stripper matches it. */
const PLACEHOLDER = /\{{2,3}\s*([a-zA-Z_][\w]*)\s*\}{2,3}/g;

/** A tag or a comment. Everything between two of these is text. */
const TAG = /(<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>)/g;

const CATALOGUED = new Set(TEMPLATE_VARIABLES.map((v) => v.key));
const IDENTIFIER = /^[a-zA-Z_]\w*$/;

/** Escape text for use inside HTML text or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Apply `fn` to the text between tags, leaving every tag and attribute alone. */
function mapText(html: string, fn: (text: string) => string): string {
  return html
    .split(TAG)
    .map((part, i) => (i % 2 === 0 ? fn(part) : part))
    .join('');
}

/**
 * Decode entities in TEXT, then escape `&`, `<` and `>` again.
 *
 * The result is the same document in one canonical form: typographic
 * entities (`&rsquo;`, `&mdash;`, `&nbsp;`, numeric references) become the
 * characters they stand for, and the three characters that are markup in HTML
 * stay escaped exactly once. Decoding the whole string instead would turn text
 * an operator typed as "&lt;script&gt;" into a live tag in the preview, and
 * would make the PDF path's own decoder decode it a second time. Tags and
 * attributes (the operator signature's `src="data:..."`) are not touched.
 *
 * It runs before substitution, so a placeholder written with an entity inside
 * its braces (`{{&nbsp;customer_name}}`, pasted from Word) still matches, and
 * again after it, so the substituted values reach the same form.
 */
function normalizeEntities(html: string): string {
  return mapText(html, (text) =>
    decodeHtmlEntities(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  );
}

/**
 * Substitute the names in `data` that are not in the catalogue.
 *
 * `replaceVariables` only knows `TEMPLATE_VARIABLES`. /api/esign also supplies
 * names that are not in the picker (`today_date`, `current_date`, …), so a key
 * the caller passes is substituted with the same 2–3 brace tolerance rather
 * than stripped. Keys that are not plain identifiers are ignored: they could
 * never be written as a placeholder, and are never put into a pattern.
 */
function replaceExtraKeys(html: string, data: Record<string, string>): string {
  let result = html;
  for (const [key, value] of Object.entries(data)) {
    if (CATALOGUED.has(key) || !IDENTIFIER.test(key)) continue;
    result = result.replace(new RegExp(`\\{{2,3}\\s*${key}\\s*\\}{2,3}`, 'g'), () => value ?? '');
  }
  return result;
}

/**
 * /api/esign's post-substitution unwrap: a block-level value (the terms, a
 * schedule table) substituted inside a `<p>` is lifted out of it.
 */
function unwrapBlocksInParagraphs(html: string): string {
  return html.replace(/<p>(\s*<(?:h[1-6]|table|div|ul|ol|hr)[\s\S]*?)<\/p>/gi, (_m, inner: string) => inner.trim());
}

/**
 * A table row's first cell, which may not run past the end of its own row.
 * `.` still excludes newlines, as in /api/esign.
 */
const ROW_CELL = '(?:(?!<\\/tr>).)*?';
const EMPTY_LAST_CELL_ROW = new RegExp(`<tr>\\s*<td>${ROW_CELL}<\\/td>\\s*<td>\\s*<\\/td>\\s*<\\/tr>`, 'gi');

/**
 * /api/esign's `removeEmptyFields`, applied after substitution in both modes so
 * the preview drops the empty rows the sent document drops. A row an
 * unresolved marker sits in is not empty, so the preview keeps it visible.
 *
 * One deliberate difference: /api/esign's row pattern is `<tr>\s*<td>.*?…`,
 * and on a table written on ONE line that lazy `.*?` runs across `</tr>` into
 * the next row, so a single empty row deletes every row before it. Its
 * templates happen to put each row on its own line, where `.` stops at the
 * newline. Here the first cell cannot cross `</tr>`, which gives the same
 * answer on those templates and the right one on a one-line table.
 */
function removeEmptyFields(html: string): string {
  return html
    .replace(EMPTY_LAST_CELL_ROW, '')
    .replace(/<p>\s*<strong>[^<]*:<\/strong>\s*<\/p>/gi, '')
    .replace(/<p>\s*<strong>[^<]*:<\/strong>(\s|&nbsp;)*<\/p>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '');
}

/** Wrap each unresolved `{{name}}` in text in a visible marker. */
function markUnresolved(html: string): string {
  return mapText(html, (text) =>
    text.replace(
      PLACEHOLDER,
      (_m, name: string) =>
        `<span ${UNRESOLVED_ATTR}="${name}" title="Nothing fills this in. It is left blank when the agreement is sent.">{{${name}}}</span>`,
    ),
  );
}

/**
 * Render a template (or a one-off edit of one) against a data map.
 *
 * `data` values are inserted AS HTML, because some variables are HTML by
 * design (the terms block, the payment schedule, the Bonzah addendum). A plain
 * text value must therefore be escaped by whoever builds the map;
 * `buildIndividualData` does.
 */
export function renderAgreementHtml(
  content: string,
  data: Record<string, string>,
  opts: {
    mode: RenderModeV2;
    /**
     * Preview only. Also highlight CATALOGUE variables that have no value at
     * all in `data`, instead of blanking them. `replaceVariables` turns a known
     * key it has no value for into '', so without this an individual
     * agreement's preview hid exactly what will go out blank — `{{vehicle_reg}}`
     * in an agreement with no rental simply vanished. A key present with ''
     * is a deliberate blank (a tenant with no address) and stays blank. Off by
     * default: a template or rental preview fills every key it can, and the
     * send path is never affected.
     */
    markMissing?: boolean;
  },
): string {
  let values = data ?? {};
  if (opts.mode === 'preview' && opts.markMissing) {
    // Substitute each missing known key with its own placeholder, so it
    // survives `replaceVariables` and `markUnresolved` highlights it.
    const withMissing: Record<string, string> = { ...values };
    for (const key of CATALOGUED) {
      if (withMissing[key] === undefined) withMissing[key] = `{{${key}}}`;
    }
    values = withMissing;
  }
  let html = normalizeEntities(content ?? '');
  html = replaceVariables(html, values);
  html = replaceExtraKeys(html, values);
  html = unwrapBlocksInParagraphs(html);
  html = normalizeEntities(html);
  html = opts.mode === 'send' ? stripUnresolvedPlaceholders(html).html : markUnresolved(html);
  return removeEmptyFields(html);
}

/**
 * The variables an individual agreement can fill: the tenant's own company
 * details, the recipient, and the date. Everything else in the catalogue
 * (vehicle, rental, payment, …) has nothing to come from and renders blank,
 * exactly as it would on the sent document.
 *
 * Keys filled, each a real `TEMPLATE_VARIABLES` key unless marked:
 *   company_name, tenant_name (the catalogue's alias of company_name),
 *   company_email, company_phone, company_address,
 *   customer_name, customer_email, agreement_date,
 *   today_date, current_date (not in the catalogue; /api/esign supplies both
 *   with the same value as agreement_date, so templates written for rentals
 *   render the same here).
 *
 * The date is formatted like /api/esign's: "January 10, 2025". Pass the
 * tenant's `timeZone` on a server, where a bare local date is the server's
 * day, not the tenant's.
 *
 * Every value is HTML-escaped, because every one of them is plain text that a
 * person typed.
 */
export function buildIndividualData(input: {
  companyName: string;
  companyEmail?: string;
  companyPhone?: string;
  companyAddress?: string;
  recipientName: string;
  recipientEmail: string;
  date?: Date;
  timeZone?: string;
}): Record<string, string> {
  const when = input.date ?? new Date();
  const date = input.timeZone ? formatZonedDate(when, input.timeZone) || formatDate(when) : formatDate(when);
  const clean = (v: string | null | undefined) => escapeHtml((v ?? '').trim());
  const company = clean(input.companyName);
  return {
    company_name: company,
    tenant_name: company,
    company_email: clean(input.companyEmail),
    company_phone: clean(input.companyPhone),
    company_address: clean(input.companyAddress),
    customer_name: clean(input.recipientName),
    customer_email: clean(input.recipientEmail),
    agreement_date: escapeHtml(date),
    today_date: escapeHtml(date),
    current_date: escapeHtml(date),
  };
}

/**
 * Make sure the document can be signed: append the customer signature block
 * when `{{@sig1}}` is absent. Byte for byte the rule /api/esign applies to an
 * HTML template, so a template renders to the same document whichever path
 * sends it. Idempotent: a document that has the tag is returned unchanged.
 */
export function ensureSignatureTag(html: string): string {
  const doc = html ?? '';
  return /\{\{@sig1\}\}/.test(doc) ? doc : doc + SIGNATURE_FALLBACK_HTML;
}
