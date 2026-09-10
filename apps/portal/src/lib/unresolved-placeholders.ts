/**
 * Removes placeholders nothing resolved, so raw template markup never reaches a
 * customer inside a contract they are signing.
 *
 * WHY THIS EXISTS
 * A production sweep of all 62 active tenant templates found five that reference
 * variables no engine supplies. They print verbatim into signed agreements:
 *
 *   clutch-motors    "Renter Signature: {{customer_signature}}"
 *                    "Authorized Signature: {{owner_signature}}"
 *                    "Acknowledges & initials (Section 1): {{initials_section_1}}"
 *   globalmotion...  "Starting Odometer: {{starting_odometer}}"
 *                    "Renter's insurance company name: {{customer_insurance_company}}"
 *
 * Substitution is open-ended: the engines loop over the map they built and
 * replace what they recognise. Anything else survives untouched, all the way
 * onto the page. Moore Luxe's `{{rental_discount}}` was the same failure and was
 * only noticed because a customer was looking at the contract.
 *
 * WHY REMOVE RATHER THAN LEAVE IT VISIBLE
 * Neither option is good, but they are not equally bad. "Insurance company:"
 * followed by nothing reads as a field nobody filled in. "Insurance company:
 * {{customer_insurance_company}}" reads as broken software, in a legal document,
 * at the moment we are asking someone to trust it. The blank also gets tidied
 * further downstream, where `removeEmptyFields` drops table rows whose value
 * cell ends up empty.
 *
 * It is NOT a silent repair. Every removal is logged with the tenant and the
 * names dropped, because an operator whose template references a variable we do
 * not supply needs to hear about it — the blank is damage control, not a fix.
 *
 * WHAT IT MUST NEVER TOUCH
 * BoldSign's own text tags — `{{@sig1}}`, `{{@init1}}`, `{{@date1}}`. Those are
 * consumed by BoldSign AFTER we hand the PDF over, to place the signature,
 * initials and date fields. Removing one silently produces a document with no
 * signature field, which cannot be signed at all. They begin with `@`, and the
 * pattern below requires a letter or underscore, so they cannot match — there is
 * a test holding that.
 *
 * Handlebars-style conditionals (`{{#if x}}`, `{{/if}}`) are likewise excluded by
 * the leading-character rule.
 */

/**
 * Matches a leftover variable placeholder: two or three braces, a bare
 * identifier, two or three braces. The brace counts mirror the substituters,
 * which accept `{{{name}}}` because operators type Mustache syntax by habit.
 */
const UNRESOLVED = /\{{2,3}\s*([a-zA-Z_][\w]*)\s*\}{2,3}/g;

/** The names found in a rendered document that nothing resolved. */
export function findUnresolvedPlaceholders(html: string): string[] {
  if (!html) return [];
  const found = new Set<string>();
  for (const m of html.matchAll(UNRESOLVED)) found.add(m[1]);
  return [...found].sort();
}

/**
 * Strip unresolved placeholders from a rendered document.
 *
 * Returns the cleaned text plus the names removed, so the caller can log them
 * against the tenant rather than discarding the signal.
 */
export function stripUnresolvedPlaceholders(html: string): {
  html: string;
  removed: string[];
} {
  if (!html) return { html, removed: [] };
  const removed = findUnresolvedPlaceholders(html);
  if (removed.length === 0) return { html, removed };
  return { html: html.replace(UNRESOLVED, ""), removed };
}
