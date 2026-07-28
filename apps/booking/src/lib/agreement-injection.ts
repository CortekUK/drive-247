/**
 * Render-time injection of mileage + T&C clauses into STORED agreement templates.
 *
 * THE PROBLEM
 * 22 of 37 tenants have their own row in `agreement_templates`, and none of
 * those templates contains a mileage or terms placeholder — they were seeded
 * before the placeholders existed. Adding the placeholders to the built-in
 * default template therefore fixes only the ~15 tenants who never customised.
 * Everyone else keeps issuing contracts that omit a mileage limit they have
 * configured and terms they have published.
 *
 * WHY INJECT AT RENDER TIME RATHER THAN REWRITE THE STORED ROW
 * The stored template is the operator's document. Rewriting it in the database
 * would edit something they own, show up unexplained in their template editor,
 * and be awkward to undo. Injecting at render time leaves their template exactly
 * as they wrote it, and the behaviour disappears the moment this code is removed.
 *
 * WHY THIS IS NOT "FORCING" A CLAUSE ON ANYONE
 * Injection is conditional on the operator's OWN data:
 *   - the mileage rows appear only when a real allowance resolves for this
 *     rental (configured on the vehicle, or overridden on the rental)
 *   - the terms block appears only when the tenant has a published terms page
 * A tenant with nothing configured sees no change. We are surfacing what they
 * already set and wrongly believed was in the contract — not inventing policy.
 *
 * RESPECTING INTENT
 * If a template already contains the placeholder, we do NOT inject: the operator
 * has chosen where the clause belongs and normal substitution handles it.
 */

/** Mileage rows, matching the built-in template's Vehicle Details markup. */
const MILEAGE_ROWS_HTML =
  "<tr><td><strong>Mileage Allowance</strong></td><td>{{mileage_allowance}}</td></tr>\n" +
  "<tr><td><strong>Excess Mileage Rate</strong></td><td>{{excess_mileage_rate}}</td></tr>";

export interface InjectionOptions {
  /** Skip mileage injection when nothing is configured for this rental. */
  hasMileage: boolean;
  /** Skip terms injection when the tenant has no published terms. */
  hasTerms: boolean;
}

function hasPlaceholder(template: string, name: string): boolean {
  return new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, "i").test(template);
}

/**
 * Add the mileage rows to the LAST table in the document that looks like a
 * details table, falling back to appending a small table of their own.
 *
 * Anchoring on `</table>` rather than a specific row keeps this working for
 * customised templates that renamed or reordered the vehicle fields.
 */
function injectMileage(template: string): string {
  const lastTableClose = template.lastIndexOf("</table>");
  if (lastTableClose === -1) {
    // No table at all — append a self-contained block so the clause still
    // appears rather than being silently dropped.
    return (
      template +
      "\n<h2>Mileage</h2>\n<table>\n" +
      MILEAGE_ROWS_HTML +
      "\n</table>\n"
    );
  }
  return (
    template.slice(0, lastTableClose) +
    MILEAGE_ROWS_HTML +
    "\n" +
    template.slice(lastTableClose)
  );
}

/**
 * Append the tenant's terms near the end, before any signature block if we can
 * find one — a customer should read the terms above the line they sign on.
 */
function injectTerms(template: string): string {
  const block = "\n{{terms_and_conditions}}\n";

  // Prefer to land before an acknowledgement/signature marker.
  const markers = [
    /<p>\s*<strong>\s*By signing below/i,
    /Customer Signature/i,
    /\{\{@sig1\}\}/i,
  ];
  for (const re of markers) {
    const m = template.match(re);
    if (m && m.index != null) {
      return template.slice(0, m.index) + block + "\n" + template.slice(m.index);
    }
  }
  return template + block;
}

/**
 * Ensure the rendered agreement states mileage and incorporates the tenant's
 * terms, without modifying the stored template.
 *
 * Returns the template unchanged when the placeholders are already present or
 * the underlying data does not exist.
 */
export function injectAgreementClauses(
  template: string,
  { hasMileage, hasTerms }: InjectionOptions,
): string {
  if (!template) return template;
  let out = template;

  if (hasMileage && !hasPlaceholder(out, "mileage_allowance")) {
    out = injectMileage(out);
  }
  if (hasTerms && !hasPlaceholder(out, "terms_and_conditions")) {
    out = injectTerms(out);
  }
  return out;
}
