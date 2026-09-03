/**
 * Render-time injection of mileage, T&C and Bonzah insurance-addendum clauses
 * into STORED agreement templates.
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
 *   - the Bonzah addendum appears only when the tenant has turned Bonzah on
 * A tenant with nothing configured sees no change. We are surfacing what they
 * already set and wrongly believed was in the contract — not inventing policy.
 *
 * THE BONZAH ADDENDUM IS A TENANT-LEVEL DISCLOSURE, NOT A PURCHASE RECEIPT
 * Bonzah requires it on every agreement issued by a rental company that offers
 * their products, because it discloses that Bonzah is available as an optional
 * referral partner. It is therefore gated on `tenants.integration_bonzah` alone
 * — never on whether this particular renter bought coverage or skipped it.
 *
 * RESPECTING INTENT
 * If a template already contains the placeholder, we do NOT inject: the operator
 * has chosen where the clause belongs and normal substitution handles it.
 *
 * Duplicated byte-for-byte to:
 *   supabase/functions/_shared/agreement-injection.ts
 *   apps/portal/src/lib/agreement-injection.ts
 *   apps/booking/src/lib/agreement-injection.ts
 * These are parallel copies, not a shared import — the portal PDF engine, the
 * booking engine and the Deno edge function each resolve modules differently.
 * Change one, change all three, and keep them identical (md5sum them).
 */

/** Mileage rows, matching the built-in template's Vehicle Details markup. */
const MILEAGE_ROWS_HTML =
  "<tr><td><strong>Mileage Allowance</strong></td><td>{{mileage_allowance}}</td></tr>\n" +
  "<tr><td><strong>Excess Mileage Rate</strong></td><td>{{excess_mileage_rate}}</td></tr>";


/**
 * Walk back from `index` to the start of the enclosing block-level element, so
 * an injected block is never spliced into the middle of a <p>.
 */
function blockStartBefore(template: string, index: number): number {
  const before = template.slice(0, index);
  const lastOpen = Math.max(
    before.lastIndexOf("<p"),
    before.lastIndexOf("<div"),
    before.lastIndexOf("<table"),
    before.lastIndexOf("<h1"),
    before.lastIndexOf("<h2"),
    before.lastIndexOf("<h3"),
  );
  if (lastOpen === -1) return index;
  // Only rewind if that element is still OPEN at `index`.
  const lastClose = Math.max(
    before.lastIndexOf("</p>"),
    before.lastIndexOf("</div>"),
    before.lastIndexOf("</table>"),
    before.lastIndexOf("</h1>"),
    before.lastIndexOf("</h2>"),
    before.lastIndexOf("</h3>"),
  );
  return lastOpen > lastClose ? lastOpen : index;
}

export interface InjectionOptions {
  /** Skip mileage injection when nothing is configured for this rental. */
  hasMileage: boolean;
  /** Skip terms injection when the tenant has no published terms. */
  hasTerms: boolean;
  /**
   * Skip the Bonzah insurance addendum unless `tenants.integration_bonzah` is
   * true. Tenant-level only — see the header note; do NOT pass a per-rental
   * "did this renter buy coverage" value here.
   */
  hasBonzahAddendum: boolean;
  /**
   * Ensure the agreement states WHEN the vehicle changed hands, not just on
   * which dates the rental ran.
   *
   * Every stored template predates the time placeholders, so a signed agreement
   * carried dates alone. That gap only surfaces at the worst moment: after an
   * accident, when the renter's insurer asks for the time the vehicle was
   * collected and returned and the operator has no document that states it —
   * only an admin screen to screenshot.
   *
   * Gated at the call site on the rental carrying any time information at all
   * (`RentalTimeFacts.hasAnyTimes`) — NOT on a confirmed handover. An agreement
   * is signed before the vehicle is collected, so gating on the actual handover
   * would leave the contract the customer actually signs stating no times, which
   * is the very gap being closed. A tenant who records no time of day on their
   * rentals still sees nothing.
   */
  hasHandoverTimes: boolean;
  /**
   * Ensure the agreement states what happens to the renter's deposit. Needed
   * because most tenants' stored templates predate charged deposits and either
   * say nothing or describe a card HOLD — which is the wrong legal statement
   * once the money is actually taken. The clause TEXT is supplied by the
   * engine via {{deposit_terms_clause}}; this module only guarantees the
   * placeholder is present.
   */
  hasDepositClause: boolean;
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
 * Splice `block` in just above the signature area — a customer should read a
 * clause above the line they sign on. Falls back to appending at the end when
 * the template has no recognisable signature marker at all.
 */
function insertBeforeSignature(template: string, block: string): string {
  // Every way a template signals "the renter signs here".
  //
  // "Renter Signature" / "Signed by Renter" are NOT redundant with "Customer
  // Signature": the seeded installment template signs off with
  //   Signed by Renter:   ______   {{customer_name}}
  // and says "Customer" nowhere, so 8 production tenants matched nothing.
  const markers = [
    /<p>\s*<strong>\s*By signing below/i,
    /Customer Signature/i,
    // "Renter Signature", "Renters/Renter's Signature" — apostrophe optional and
    // in any encoding, since templates mix straight, curly and HTML-entity forms.
    /Renter(?:'|’|&apos;|&#39;)?s? Signature/i,
    /Signed by\s+(?:the\s+)?Renter/i,
    /\{\{@sig1\}\}/i,
  ];

  // Take the EARLIEST match in the document, not the first pattern that happens
  // to hit. Priority order is wrong here: one production template puts the real
  // signature table (labelled "Renter's Signature", carrying {{@sig1}}) at
  // offset 12498 and then says "Customer Signature" in a closing sentence at
  // 12992. Matching by pattern order picked the later one and spliced the
  // clause UNDERNEATH the signature. Whichever sign-off appears first is the
  // one the renter reaches first, so that is the line to stay above.
  let earliest = -1;
  for (const re of markers) {
    const m = template.match(re);
    if (m && m.index != null && (earliest === -1 || m.index < earliest)) {
      earliest = m.index;
    }
  }

  if (earliest !== -1) {
    // Splice at the start of the enclosing BLOCK, never mid-paragraph. Some
    // templates put the signature marker inside <p>...</p>; inserting an <h2>
    // there produces invalid nesting that the PDF block parser renders as
    // literal internal markers (BLOCK_18) with the headings dropped.
    const safeIndex = blockStartBefore(template, earliest);
    return template.slice(0, safeIndex) + block + "\n" + template.slice(safeIndex);
  }
  return template + block;
}

/**
 * Append the tenant's terms near the end, before any signature block if we can
 * find one — a customer should read the terms above the line they sign on.
 */
function injectTerms(template: string): string {
  return insertBeforeSignature(template, "\n{{terms_and_conditions}}\n");
}

/**
 * Place the Bonzah insurance addendum immediately above the signature block.
 *
 * Runs AFTER injectTerms so that, when both are injected into the same
 * template, the order the renter reads is: operator's own terms, then the
 * insurer's addendum, then the signature — the addendum sits closest to the
 * signature because it is the disclosure being acknowledged by signing.
 */
function injectBonzahAddendum(template: string): string {
  // Literal rather than an import from bonzah-addendum: this module is kept
  // byte-identical across the portal, booking and Deno edge-function copies,
  // and Deno needs a ".ts" suffix on relative imports that the bundlers do not.
  // Must stay in step with BONZAH_ADDENDUM_PLACEHOLDER in bonzah-addendum.ts.
  return insertBeforeSignature(template, "\n{{bonzah_insurance_addendum}}\n");
}

/**
 * Place the deposit clause. Injected FIRST so it ends up furthest from the
 * signature — it is a money term belonging with the commercial body of the
 * agreement, not a disclosure being acknowledged at the point of signing.
 */
function injectDepositClause(template: string): string {
  return insertBeforeSignature(template, "\n{{deposit_terms_clause}}\n");
}

/**
 * Collection/return times, as a self-contained heading + table.
 *
 * Literal rather than imported from agreement-datetime.ts for the same reason
 * the Bonzah block is literal: this module stays byte-identical across the
 * portal, booking and Deno copies, and Deno needs a ".ts" suffix on relative
 * imports that the bundlers do not. Must stay in step with
 * HANDOVER_TIMES_BLOCK_HTML in agreement-datetime.ts.
 *
 * It is its OWN table, never rows appended to the document's last table. The
 * PDF renderer sets every column width to CONTENT_W / (max cells in any row of
 * that table), so 2-cell rows landing in a table that has a 3-cell row anywhere
 * — the installment schedule has one — shrink every column to 165pt, and the
 * renderer then truncates the overflow one character at a time with no ellipsis.
 * A silently chopped timestamp on a document an insurer reads is worse than no
 * timestamp at all.
 */
const HANDOVER_TIMES_BLOCK =
  "<h2>Vehicle Collection &amp; Return</h2>\n" +
  "<table>\n" +
  "<tr><td><strong>Scheduled Collection</strong></td><td>{{pickup_datetime}}</td></tr>\n" +
  "<tr><td><strong>Scheduled Return</strong></td><td>{{return_datetime}}</td></tr>\n" +
  "<tr><td><strong>Vehicle Collected</strong></td><td>{{vehicle_collected_at}}</td></tr>\n" +
  "<tr><td><strong>Vehicle Returned</strong></td><td>{{vehicle_returned_at}}</td></tr>\n" +
  "<tr><td><strong>Odometer at Collection</strong></td><td>{{collection_mileage}}</td></tr>\n" +
  "<tr><td><strong>Odometer at Return</strong></td><td>{{return_mileage}}</td></tr>\n" +
  "<tr><td><strong>Times Recorded In</strong></td><td>{{rental_timezone}}</td></tr>\n" +
  "</table>";

/**
 * Put the times immediately above the signature area, alongside the other
 * injected clauses. A renter should be able to read what the document asserts
 * about when they took and returned the vehicle before signing it.
 */
function injectHandoverTimes(template: string): string {
  return insertBeforeSignature(template, "\n" + HANDOVER_TIMES_BLOCK + "\n");
}

/**
 * Ensure the rendered agreement states mileage, incorporates the tenant's terms
 * and carries the Bonzah addendum, without modifying the stored template.
 *
 * Returns the template unchanged when the placeholders are already present or
 * the underlying data does not exist.
 */
export function injectAgreementClauses(
  template: string,
  {
    hasMileage,
    hasTerms,
    hasBonzahAddendum,
    hasDepositClause,
    hasHandoverTimes,
  }: InjectionOptions,
): string {
  if (!template) return template;
  let out = template;

  // First, so it reads before mileage/terms/addendum. Skipped when the template
  // already carries the placeholder, which is what keeps re-rendering the same
  // agreement idempotent.
  if (hasDepositClause && !hasPlaceholder(out, "deposit_terms_clause")) {
    out = injectDepositClause(out);
  }

  // Also check the LEGACY name. A template written before the rename uses
  // {{vehicle_allowed_mileage}}; injecting on top of it would state the
  // allowance twice, in two different formats, in the same contract.
  const alreadyStatesMileage =
    hasPlaceholder(out, "mileage_allowance") ||
    hasPlaceholder(out, "vehicle_allowed_mileage");
  if (hasMileage && !alreadyStatesMileage) {
    out = injectMileage(out);
  }
  // AFTER injectMileage, and this ordering is load-bearing rather than
  // cosmetic. injectMileage appends its rows to the document's LAST </table>.
  // The collection/return block is spliced in above the signature, which in most
  // templates makes it the last table — so injecting it first silently captured
  // the mileage rows, and a contract ended up stating "Mileage Allowance" under
  // the heading "Vehicle Collection & Return" instead of under Vehicle Details.
  //
  // Skipped when the template already places ANY of these placeholders itself:
  // the operator has chosen where the times belong, and injecting on top would
  // state them twice in one contract. Checking every name in the block (not just
  // the obvious ones) is what keeps re-rendering the same agreement idempotent
  // as more of these variables become individually pickable in the editor.
  const alreadyStatesTimes = [
    "pickup_datetime",
    "return_datetime",
    "vehicle_collected_at",
    "vehicle_returned_at",
    "collection_mileage",
    "return_mileage",
    "rental_timezone",
  ].some((name) => hasPlaceholder(out, name));
  if (hasHandoverTimes && !alreadyStatesTimes) {
    out = injectHandoverTimes(out);
  }

  if (hasTerms && !hasPlaceholder(out, "terms_and_conditions")) {
    out = injectTerms(out);
  }
  // After terms, so the addendum ends up between the operator's terms and the
  // signature. Skipped when the template already places the placeholder itself,
  // which is also what makes re-rendering the same agreement idempotent.
  if (hasBonzahAddendum && !hasPlaceholder(out, "bonzah_insurance_addendum")) {
    out = injectBonzahAddendum(out);
  }
  return out;
}
