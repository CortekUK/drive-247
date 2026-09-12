// =============================================================================
// integrations/stripe — REFUND LEDGER: what a refund, a reversal or a deposit
// deduction actually WRITES, and what the next reader of those rows then
// believes.
//
// WHY THIS FILE EXISTS, SEPARATELY FROM refund.test.ts AND refund-edge-cases
// -------------------------------------------------------------------------
// Those two files are about the refund DECISION: is this amount allowed, is the
// guard above or below the Stripe call, what does the portal send. This file is
// about the BOOKKEEPING that follows the decision — the ledger_entries row, the
// pnl_entries row, the payments column — because every later ceiling in this
// system is derived from those rows and nothing else:
//
//   process-refund/index.ts:189-204     availableForRefund  = totalPaid - sum(ledger type='Refund' in this category)
//   deduct-from-deposit/index.ts:159-163 availableDeposit    = totalDepositPaid - sum(ledger Refund 'Security Deposit')
//
// So a refund that moves money and writes no row (or writes it in the wrong
// category) does not merely mis-report: it re-opens the ceiling and the SAME
// money can be handed back a second time. That is the failure mode this whole
// file is circling, from six different functions.
//
// LAYERS
// ------
//   L1 (most of it) — offline, reads edge-function SOURCE and MIGRATION text as
//        text. Chosen because the defects here are CONSTRAINT-vs-CODE mismatches
//        and MISSING writes. Neither is observable by executing the function:
//        the constraint lives in Postgres, and a missing insert has no runtime
//        signature at all, only an absence in the source. Blunt, and honest
//        about it — a source grep proves the statement is written down, not that
//        it runs.
//   L3 (two blocks) — pure executable arithmetic against hand-typed literals,
//        where the defect IS arithmetic: the `|| ` coercion of a zero refund
//        amount, and the proportional category smear. Both mirror one source
//        expression, and each mirror is pinned to the verbatim source line
//        immediately above it, so the mirror cannot drift away from the code it
//        claims to model.
//   NO L2. Every function below moves real money in the customer's direction and
//        several of them are batch/cron entry points with no dry-run. There is
//        nothing here that can be probed live without either refunding a card or
//        writing to a tenant's ledger.
//
// WHAT THIS FILE DELIBERATELY DOES NOT COVER
// ------------------------------------------
//   * the refund AMOUNT ceiling on process-refund (refund-edge-cases.test.ts)
//   * the process-refund request contract (refund.test.ts)
//   * Square's own refund maths, idempotency and minor units (integrations/square/*)
//   * whether any of this runs. Nothing here executes an edge function.
//
// TWO NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
// -----------------------------------------------------
// 1. MIGRATION TEXT IS NOT ALWAYS THE SCHEMA. CLAUDE.md records that some DDL on
//    this project is applied through the Supabase Management API and never lands
//    in supabase/migrations. That bit an earlier version of one finding here:
//    `invoices.delivery_fee` is absent from every migration file and PRESENT in
//    production. So where a COLUMN is in question this file asserts against the
//    GENERATED TYPES (apps/portal/src/integrations/supabase/types.ts), which are
//    dumped from the live database. Where a CHECK CONSTRAINT is in question it
//    has to use migration text, because generated types do not carry check
//    constraints — those assertions are labelled, and a reader who believes a
//    constraint has since been widened out-of-band should verify before
//    "fixing" the pin.
// 2. `const { data: x } = await supabase...` DISCARDS THE ERROR. Several of the
//    defects below are only silent because of that idiom: a 42703 undefined-
//    column, or a maybeSingle() that matched two rows, arrives as `x === null`
//    and reads to the surrounding code as "nothing found". See
//    memory/supabase-js-error-handling.md. Wherever that idiom is load-bearing
//    for a defect, the test asserts the idiom itself.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, readEdgeFunctionSource } from "../../helpers/edge-contract";

// -----------------------------------------------------------------------------
// Readers. Nothing here caches: these files are small and the suite is ~1s.
// -----------------------------------------------------------------------------

const migration = (file: string): string =>
  readFileSync(join(REPO_ROOT, "supabase", "migrations", file), "utf8");

const REMOTE_SCHEMA = "20251219083413_remote_schema.sql";

/** Every migration filename that mentions `name`, oldest first. */
function migrationsMentioning(name: string): string[] {
  const dir = join(REPO_ROOT, "supabase", "migrations");
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => readFileSync(join(dir, f), "utf8").includes(name))
    .sort();
}

/**
 * Pull the string literals out of the FIRST `ARRAY[ ... ]` that follows
 * `marker` in `sql`. Postgres dumps quote types (`'Rental'::"text"`) while
 * hand-written migrations often do not, so strip both shapes.
 */
function arrayLiteralsAfter(sql: string, marker: string): string[] {
  const at = sql.indexOf(marker);
  if (at < 0) throw new Error(`marker not found in SQL: ${marker}`);
  const open = sql.indexOf("ARRAY[", at);
  const close = sql.indexOf("]", open);
  if (open < 0 || close < 0) throw new Error(`no ARRAY[...] after ${marker}`);
  return [...sql.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** The column names in the generated-types Row block for `table`. */
function generatedRowColumns(table: string): string[] {
  const types = readFileSync(
    join(REPO_ROOT, "apps", "portal", "src", "integrations", "supabase", "types.ts"),
    "utf8",
  );
  const at = types.indexOf(`      ${table}: {\n        Row: {\n`);
  if (at < 0) throw new Error(`no generated Row block for table ${table}`);
  const rowStart = types.indexOf("Row: {", at) + "Row: {".length;
  const rowEnd = types.indexOf("\n        }", rowStart);
  return [...types.slice(rowStart, rowEnd).matchAll(/^\s{10}([a-z_0-9]+)\??:/gm)].map((m) => m[1]);
}

/** The columns named inside a PostgREST `.select("a, b, c")` call. */
function selectColumns(select: string): string[] {
  return select.split(",").map((c) => c.trim()).filter(Boolean);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// -----------------------------------------------------------------------------

// @usecase A reversed manual payment leaves its original 'Payment' ledger row standing with nothing to offset it, while the charges it paid have already been re-opened — so the customer's statement double-counts the reversal and the operator is told it worked.
describe("reverse-payment — the offsetting row the ledger type CHECK has never allowed", () => {
  const src = readEdgeFunctionSource("reverse-payment");

  /** The insert at reverse-payment/index.ts:210-224, as a slice of source. */
  const reversalInsert = (() => {
    const at = src.indexOf("Create a reversal ledger entry");
    return src.slice(at, src.indexOf("});", at));
  })();

  const ALLOWED_TYPES = arrayLiteralsAfter(
    migration(REMOTE_SCHEMA),
    "ledger_entries_type_check",
  );

  it("admits exactly Charge, Payment and Refund as ledger entry types, in the only migration that has ever defined that constraint", () => {
    expect(ALLOWED_TYPES).toEqual(["Charge", "Payment", "Refund"]);
    // The CATEGORY check is widened by six separate migrations. The TYPE check
    // by none — so this is the current constraint, not a stale first draft.
    expect(migrationsMentioning("ledger_entries_type_check")).toEqual([REMOTE_SCHEMA]);
  });

  it("writes the reversal with type 'Adjustment', which is not one of the three the constraint admits", () => {
    const written = /type:\s*'([^']+)'/.exec(reversalInsert)?.[1];
    expect(written).toBe("Adjustment"); // reverse-payment/index.ts:218
    expect(ALLOWED_TYPES).not.toContain(written);
  });

  it("logs the rejected insert and carries on to report the reversal as a success", () => {
    // The insert's error is console.error'd and never returned...
    expect(src).toContain('console.error("Error creating reversal ledger entry:", reversalError);');
    // ...and index.ts:253-258 still answers success.
    expect(src).toContain('message: "Payment reversed successfully"');
    // Steps 4 and 5 have ALREADY re-opened the charges and deleted the
    // allocations by this point, so the debt is back while the Payment row
    // that settled it is still on the ledger.
    const restoreAt = src.indexOf("Restore the remaining amount");
    const deleteAppsAt = src.indexOf("5. Delete payment applications");
    const reversalAt = src.indexOf("Create a reversal ledger entry");
    expect(restoreAt).toBeGreaterThan(0);
    expect(deleteAppsAt).toBeGreaterThan(restoreAt);
    expect(reversalAt).toBeGreaterThan(deleteAppsAt);
  });

  it.fails("should write the offsetting row with a ledger type the CHECK constraint accepts", () => {
    // Remove the .fails marker once supabase/functions/reverse-payment/index.ts:218
    // is fixed (either the row is written as a 'Refund', or the constraint is
    // widened to admit 'Adjustment' — this assertion passes on either).
    const written = /type:\s*'([^']+)'/.exec(reversalInsert)?.[1];
    const allowedNow = arrayLiteralsAfter(
      migration(migrationsMentioning("ledger_entries_type_check").at(-1)!),
      "ledger_entries_type_check",
    );
    expect(allowedNow).toContain(written);
  });

  it("is not the only place writing type 'Adjustment' — the portal's fine-appeal dialog does it twice", () => {
    // Not fixable from this file, but a fix at reverse-payment alone leaves the
    // same rejected-insert-reported-as-success in the portal.
    const dialog = readFileSync(
      join(REPO_ROOT, "apps", "portal", "src", "components", "fines", "fine-appeal-dialog.tsx"),
      "utf8",
    );
    expect([...dialog.matchAll(/type:\s*"Adjustment"/g)].length).toBe(2);
  });
});

// @usecase Reversing a wrongly-recorded payment leaves its Revenue rows in pnl_entries forever, so the operator's P&L overstates earnings by the full reversed amount with no correcting entry and nothing on screen to show it.
describe("reverse-payment — the P&L revenue it clears by a key the allocators do not write", () => {
  const src = readEdgeFunctionSource("reverse-payment");
  const fifoV2 = migration("20260603120000_fifo_v2_generic_pays_extension.sql");
  const applyPayment = readEdgeFunctionSource("apply-payment");

  /**
   * Step 6, CODE ONLY — sliced from the first statement, because the comment
   * immediately above it is itself part of the finding and mentions source_ref.
   */
  const pnlDeleteCode = src.slice(
    src.indexOf("const { data: pnlEntries, error: pnlError }"),
    src.indexOf("7. Handle the payment's ledger entry"),
  );

  it("deletes P&L rows by payment_id, immediately under a comment naming source_ref", () => {
    const withComment = src.slice(
      src.indexOf("6. Delete P&L revenue entries"),
      src.indexOf("7. Handle the payment's ledger entry"),
    );
    expect(withComment).toContain('These entries have source_ref like "{paymentId}_{chargeId}"');
    expect(pnlDeleteCode).toContain('.eq("payment_id", paymentId)');
    expect(pnlDeleteCode).not.toContain("source_ref");
  });

  it("is deleting by a column neither allocator populates: both key the revenue row on source_ref", () => {
    // The SQL allocator — 20260603120000:127-128. Column list, verbatim.
    expect(fifoV2).toContain(
      "INSERT INTO pnl_entries(vehicle_id, entry_date, side, category, amount, source_ref)",
    );
    // The edge-function allocator — apply-payment/index.ts:404-409 and :742-753.
    for (const decl of ["const pnlData: any = {", "const pnlData2: any = {"]) {
      const body = applyPayment.slice(
        applyPayment.indexOf(decl),
        applyPayment.indexOf("};", applyPayment.indexOf(decl)),
      );
      expect(body).toContain("source_ref: `${paymentId}_${charge.id}`");
      expect(body).not.toContain("payment_id");
    }
  });

  it("is measurably the wrong key, because the sibling undo path deletes by source_ref and keeps payment_id only as a sweep", () => {
    const undo = readEdgeFunctionSource("undo-manual-payment");
    // undo-manual-payment/index.ts:195-196 — the primary delete.
    expect(undo).toContain("const sourceRef = `${app.payment_id}_${app.charge_entry_id}`;");
    expect(undo).toContain('.delete().eq("source_ref", sourceRef)');
    // :228-229 — the payment_id delete exists there too, explicitly as a backstop.
    expect(undo).toContain("Belt-and-braces: clear any P&L entries still linked to this payment");
  });

  it("catches only the legacy Initial Fees row, which is the one place payment_id IS written", () => {
    // apply_payment_fully (20251219083413:359-368, fired by a trigger at :3015)
    // is the sole writer of pnl_entries.payment_id, and it writes it only for
    // 'Initial Fees'. Every Rental/Tax/Service Fee revenue row from the two
    // live allocators is invisible to reverse-payment's delete.
    const schema = migration(REMOTE_SCHEMA);
    const initialFeeInsert = schema.slice(
      schema.indexOf("INSERT INTO public.pnl_entries(\n      id, vehicle_id, rental_id, customer_id, entry_date,"),
      schema.indexOf("ON CONFLICT ON CONSTRAINT ux_pnl_initial_fee_once"),
    );
    expect(initialFeeInsert).toContain("payment_id");
    expect(initialFeeInsert).toContain("'Initial Fees'");
  });

  it.fails("should delete the P&L rows by the source_ref key its own comment names", () => {
    // Remove the .fails marker once supabase/functions/reverse-payment/index.ts:181-190
    // is fixed.
    expect(pnlDeleteCode).toContain("source_ref");
  });
});

// @usecase An operator schedules a refund for a Square payment, is told it succeeded, and the money never leaves: the nightly batch's query can never see that row, and there is no retry, alert or queue anyone inspects.
describe("schedule-refund — the Square payment the nightly batch can never see", () => {
  const src = readEdgeFunctionSource("schedule-refund");
  const schema = migration(REMOTE_SCHEMA);

  /** The WHERE clause of get_refunds_due_today (20251219083413:1886-1892). */
  const dueTodayWhere = (() => {
    const at = schema.indexOf("get_refunds_due_today");
    const whereAt = schema.indexOf("WHERE p.refund_status = 'scheduled'", at);
    return schema.slice(whereAt, schema.indexOf("ORDER BY", whereAt));
  })();

  it("requires a Stripe payment intent on every row the batch picks up", () => {
    expect(dueTodayWhere).toContain("AND p.stripe_payment_intent_id IS NOT NULL");
    // It is the ONLY definition — nothing has relaxed it since.
    expect(migrationsMentioning("get_refunds_due_today")).toEqual([REMOTE_SCHEMA]);
  });

  it("is querying for a handle the database forbids a Square payment to carry", () => {
    const sq = migration("20260825172706_square_provider_columns.sql");
    const constraint = sq.slice(
      sq.indexOf("payments_provider_handle_exclusivity_check"),
      sq.indexOf("CREATE OR REPLACE FUNCTION public.payments_payment_provider_immutable"),
    );
    expect(constraint).toContain("payment_provider <> 'square'");
    expect(constraint).toContain("stripe_payment_intent_id IS NULL");
  });

  it("accepts the schedule anyway: it never reads payment_provider and never refuses a Square row", () => {
    expect(src).not.toContain("payment_provider");
    const selected = /\.select\('([^']+)'\)/.exec(src)?.[1] ?? "";
    expect(selectColumns(selected)).toEqual([
      "id",
      "amount",
      "customer_id",
      "rental_id",
      "stripe_payment_intent_id",
      "capture_status",
      "tenant_id",
    ]);
    expect(src).toContain("message: 'Refund scheduled successfully'");
  });

  it("drops a payment with no rental_id on the same clause, through the INNER JOIN on rentals", () => {
    const from = schema.slice(
      schema.indexOf("FROM payments p", schema.indexOf("get_refunds_due_today")),
      schema.indexOf("WHERE p.refund_status = 'scheduled'"),
    );
    expect(from).toContain("INNER JOIN rentals r ON p.rental_id = r.id");
    expect(from).not.toContain("LEFT JOIN rentals");
  });

  it("makes the gap invisible, because the IMMEDIATE sibling path does route Square correctly", () => {
    const immediate = readEdgeFunctionSource("process-scheduled-refund");
    expect(immediate).toContain("if (payment.payment_provider === 'square') {");
  });

  it.fails("should refuse to schedule a refund for a payment it cannot later process", () => {
    // Remove the .fails marker once supabase/functions/schedule-refund/index.ts:45-66
    // learns about payment_provider (or get_refunds_due_today,
    // 20251219083413_remote_schema.sql:1891, stops requiring a Stripe handle).
    expect(src).toContain("payment_provider");
  });
});

// @usecase An operator clears the amount field and the form sends 0. On schedule-refund that silently books a FULL refund for a future date; on process-scheduled-refund's immediate path it refunds the whole payment to Stripe on the spot. Neither echoes the amount back before acting.
describe("refund amounts — zero coerced to the whole payment (L3, executed)", () => {
  const scheduleSrc = readEdgeFunctionSource("schedule-refund");
  const processSrc = readEdgeFunctionSource("process-scheduled-refund");

  // The one expression under test, mirrored. Pinned to the verbatim source
  // lines in the test below so the mirror cannot drift from the code.
  const coerce = (requested: number | undefined, paymentAmount: number): number =>
    requested || paymentAmount;

  it("is the same `||` coercion on both paths, at schedule-refund:61 and process-scheduled-refund:151", () => {
    expect(scheduleSrc).toContain("const finalRefundAmount = refundAmount || payment.amount;");
    expect(processSrc).toContain("const refundAmount = requestBody.amount || payment.amount;");
    // The interface says the field is optional, which is what the `||` was for.
    expect(scheduleSrc).toContain("refundAmount?: number; // Optional - if not provided, refunds full amount");
  });

  it("turns a requested refund of 0 on a 250.00 payment into a refund of 250.00", () => {
    expect(coerce(0, 250)).toBe(250); // 0 is falsy; `||` cannot tell it from undefined
    expect(coerce(undefined, 250)).toBe(250); // the intended case, indistinguishable
    expect(coerce(75, 250)).toBe(75); // a real amount is passed through
  });

  it("lets a refund of -50.00 past the only guard there is, because -50 > 250 is false", () => {
    const requested = -50;
    const paymentAmount = 250;
    const finalRefundAmount = coerce(requested, paymentAmount);
    expect(finalRefundAmount).toBe(-50);
    expect(finalRefundAmount > paymentAmount).toBe(false); // schedule-refund/index.ts:64
  });

  it("sends the coerced figure straight to Stripe on the immediate path, with no cap of any kind", () => {
    // process-scheduled-refund/index.ts:151 -> :156. 250.00 -> 25000 minor units.
    expect(processSrc).toContain("amount: Math.round(refundAmount * 100), // Convert to cents");
    expect(Math.round(coerce(0, 250) * 100)).toBe(25000);
    // There is no upper-bound check between the coercion and the Stripe call.
    const between = processSrc.slice(
      processSrc.indexOf("const refundAmount = requestBody.amount || payment.amount;"),
      processSrc.indexOf("const stripeRefund = await stripe.refunds.create(refundParams, stripeOptions);"),
    );
    expect(between).not.toMatch(/refundAmount\s*>\s*payment\.amount/);
  });

  it.fails("should refuse a zero or negative refund amount before any row is written or any Stripe call is built", () => {
    // Remove the .fails marker once supabase/functions/schedule-refund/index.ts:61
    // and supabase/functions/process-scheduled-refund/index.ts:151 are fixed.
    const guards = /(refundAmount|finalRefundAmount)\s*<=?\s*0/;
    expect(scheduleSrc).toMatch(guards);
    expect(processSrc).toMatch(guards);
  });
});

// @usecase A card payment that has already been refunded in full can be scheduled for a second full refund: nothing reads what was refunded, and the schedule overwrites refund_status='completed' with 'scheduled', which is the only status the batch filters on.
describe("schedule-refund — the ceiling it validates against", () => {
  const src = readEdgeFunctionSource("schedule-refund");
  const selected = selectColumns(/\.select\('([^']+)'\)/.exec(src)?.[1] ?? "");

  it("validates only against the payment's gross amount, having read nothing about prior refunds", () => {
    // schedule-refund/index.ts:55-66 is the entire validation.
    expect(src).toContain("if (payment.capture_status !== 'captured')");
    expect(src).toContain("if (finalRefundAmount > payment.amount)");
    // It cannot check refunds-to-date: it never selects the columns.
    for (const col of ["refund_status", "refund_amount", "status"]) {
      expect(selected).not.toContain(col);
    }
  });

  it("overwrites refund_status with 'scheduled' unconditionally, including over a 'completed'", () => {
    const update = src.slice(src.indexOf(".update({", src.indexOf("Update payment with refund schedule")), src.indexOf("})", src.indexOf("refund_scheduled_by")));
    expect(update).toContain("refund_status: 'scheduled'");
    expect(src).not.toMatch(/refund_status\s*!==?\s*'completed'/);
  });

  it("is the only status filter the batch applies, so the re-scheduled row is picked up again", () => {
    const schema = migration(REMOTE_SCHEMA);
    const whereAt = schema.indexOf("WHERE p.refund_status = 'scheduled'");
    expect(whereAt).toBeGreaterThan(0);
  });

  it("has a sibling in the same tree that computes the real ceiling", () => {
    // process-refund/index.ts:199-203.
    const pr = readEdgeFunctionSource("process-refund");
    expect(pr).toContain("const totalPaid = totalCharged - totalRemaining;");
    expect(pr).toContain("const availableForRefund = totalPaid - totalAlreadyRefunded;");
  });

  it.fails("should cap a scheduled refund at what is still refundable, the way process-refund does", () => {
    // Remove the .fails marker once supabase/functions/schedule-refund/index.ts:55-66
    // is fixed. The select must at minimum carry what has already been refunded.
    expect(selected).toContain("refund_status");
  });
});

// @usecase A Square refund issued through the scheduled-refund path leaves no ledger Refund row anywhere, so process-refund still reads the money as fully refundable and the same money can be returned a second time from the rental page.
describe("process-scheduled-refund — the Square branch that records no ledger row", () => {
  const src = readEdgeFunctionSource("process-scheduled-refund");

  /** The whole Square branch, index.ts:63-111. */
  const squareBranch = src.slice(
    src.indexOf("if (payment.payment_provider === 'square') {"),
    src.indexOf("// Use provided paymentIntentId or fall back to the one in payment record"),
  );
  /** The Stripe branch that follows it, index.ts:169-235. */
  const stripeBranch = src.slice(
    src.indexOf("// Update payment record"),
    src.indexOf("message: 'Refund processed successfully'"),
  );

  it("writes only square_refund_id and refund_processed_at, and returns success", () => {
    expect(squareBranch).toContain("square_refund_id: squareRefundId,");
    expect(squareBranch).toContain("refund_processed_at: new Date().toISOString(),");
    expect(squareBranch).toContain("success: true,");
  });

  it("touches ledger_entries nowhere in that branch, where the Stripe branch inserts one row per category", () => {
    expect(squareBranch).not.toContain("ledger_entries");
    expect(stripeBranch).toContain("await supabase.from('ledger_entries').insert(ledgerEntry);");
    expect(stripeBranch).toContain("type: 'Refund',");
  });

  it("leaves the missing refund_status and status to square-webhook, exactly as its comment says", () => {
    // This half is NOT a defect: the terminal state is written on refund.updated.
    expect(squareBranch).toContain(
      "square-webhook writes the terminal state when",
    );
    const webhook = readEdgeFunctionSource("square-webhook");
    expect(webhook).toContain('if (row.refund_status !== "completed") update.refund_status = "completed";');
  });

  it("gets no ledger row from square-webhook either — that function writes none at all", () => {
    const webhook = readEdgeFunctionSource("square-webhook");
    expect(webhook).not.toContain("ledger_entries");
  });

  it("re-opens the ceiling, because process-refund derives it from ledger Refund rows alone", () => {
    const pr = readEdgeFunctionSource("process-refund");
    const refundsQuery = pr.slice(
      pr.indexOf("let refundsQuery = supabase"),
      pr.indexOf("const { data: ledgerRefunds } = await refundsQuery;"),
    );
    expect(refundsQuery).toContain('.eq("type", "Refund")');
    expect(pr).toContain("const totalAlreadyRefunded = Math.abs(ledgerRefunds?.reduce");
  });

  it.fails("should record a Square refund in the ledger, the way the Stripe branch beside it does", () => {
    // Remove the .fails marker once supabase/functions/process-scheduled-refund/index.ts:85-110
    // (or square-webhook's refund.updated handler) writes a type:'Refund' row.
    expect(squareBranch).toContain("ledger_entries");
  });
});

// @usecase A refunded deposit is booked mostly against rental revenue: the deposit still reads as ~2/3 refundable and can be paid out a second time, while the ledger carries negative Rental revenue that was never refunded and flows into the operator's reporting.
describe("process-scheduled-refund — the proportional smear across invoice categories (L3, hand-derived)", () => {
  const src = readEdgeFunctionSource("process-scheduled-refund");

  it("splits the refund by each category's share of the invoice, with no category on the request at all", () => {
    // index.ts:201-214.
    expect(src).toContain("const totalInvoice = categories.reduce((sum, c) => sum + c.amount, 0);");
    expect(src).toContain("? (category.amount / totalInvoice) * refundAmount");
    // index.ts:13-19 — the request interface. No category, no charge id.
    const iface = src.slice(
      src.indexOf("interface ImmediateRefundRequest {"),
      src.indexOf("}", src.indexOf("interface ImmediateRefundRequest {")),
    );
    expect(iface).not.toContain("category");
    // The batch path repeats the identical split at index.ts:366-395, against
    // the stored refund.refund_amount instead of the request's.
    expect(src).toContain("const batchTotalInvoice = batchCategories.reduce((sum, c) => sum + c.amount, 0);");
    expect(src).toContain("? (category.amount / batchTotalInvoice) * refund.refund_amount");
  });

  it("books a 200.00 deposit refund as Rental 100.00, Tax 20.00, Service Fee 13.33, Security Deposit 66.67", () => {
    // Invoice, hand-typed: rental_fee 300, tax_amount 60, service_fee 40,
    // security_deposit 200.  totalInvoice = 300 + 60 + 40 + 200 = 600.
    // The operator refunds the deposit, so refundAmount = 200.
    const invoice = { rental_fee: 300, tax_amount: 60, service_fee: 40, security_deposit: 200 };
    const totalInvoice = 600; // 300 + 60 + 40 + 200
    expect(invoice.rental_fee + invoice.tax_amount + invoice.service_fee + invoice.security_deposit)
      .toBe(totalInvoice);

    const refundAmount = 200;
    // ledger_entries.amount is numeric(12,2) (20251219083413:4423), so each
    // share is rounded to cents on insert.
    const share = (categoryAmount: number) => round2((categoryAmount / totalInvoice) * refundAmount);

    expect(share(300)).toBe(100.0); // 300/600 x 200 = 100.00
    expect(share(60)).toBe(20.0); //  60/600 x 200 =  20.00
    expect(share(40)).toBe(13.33); //  40/600 x 200 =  13.333... -> 13.33
    expect(share(200)).toBe(66.67); // 200/600 x 200 =  66.666... -> 66.67

    // The four shares still add to the refund. Only the attribution is wrong.
    expect(round2(100.0 + 20.0 + 13.33 + 66.67)).toBe(200.0);
  });

  it("leaves 133.33 of the deposit reading as still refundable after the whole 200.00 was returned", () => {
    // process-refund/index.ts:199-203 for category 'Security Deposit':
    //   totalPaid 200.00 (the deposit charge, fully settled)
    //   totalAlreadyRefunded = |-66.67| = 66.67  <- the only Security Deposit Refund row
    const totalPaid = 200.0;
    const totalAlreadyRefunded = 66.67;
    const availableForRefund = round2(totalPaid - totalAlreadyRefunded);
    expect(availableForRefund).toBe(133.33); // 200.00 - 66.67
  });

  it("puts -100.00 of Rental revenue on the ledger that was never refunded", () => {
    // The mirror image of the same smear: Rental was not what the operator
    // returned, but it carries the largest share of the correction.
    expect(round2(-(300 / 600) * 200)).toBe(-100.0);
  });

  it.fails("should attribute a refund to the category it actually settled, not smear it across the invoice", () => {
    // Remove the .fails marker once supabase/functions/process-scheduled-refund/index.ts:201-234
    // is fixed — cancel-rental-refund/index.ts:546-563 shows the shape, reading
    // payment_applications for what this payment really paid.
    expect(src).toContain("payment_applications");
  });
});

// @usecase A refunded security deposit is recorded as a Rental refund, so deduct-from-deposit and process-refund both read the deposit as fully available and it can be refunded or deducted a second time.
describe("refund-installment-payments — the invoice fallback killed by one nonexistent column", () => {
  const src = readEdgeFunctionSource("refund-installment-payments");
  const invoiceColumns = generatedRowColumns("invoices");

  /** The fallback query at index.ts:345-352. */
  const fallbackSelect = selectColumns(
    /\.from\("invoices"\)\s*\n\s*\.select\("([^"]+)"\)/.exec(src)?.[1] ?? "",
  );

  it("asks the invoices table for rental_amount, which the invoices table does not have", () => {
    expect(fallbackSelect).toContain("rental_amount");
    expect(invoiceColumns).not.toContain("rental_amount");
    // The real column is rental_fee — the spelling the sibling uses.
    expect(invoiceColumns).toContain("rental_fee");
    expect(readEdgeFunctionSource("process-scheduled-refund")).toContain(
      "'rental_fee, tax_amount, service_fee, security_deposit'",
    );
  });

  it("names delivery_fee legitimately: that column exists in production even though no migration adds it", () => {
    // Migration text alone would have called this a second bad column. It is
    // not — the generated types are dumped from the live database.
    expect(fallbackSelect).toContain("delivery_fee");
    expect(invoiceColumns).toContain("delivery_fee");
    const migrationsTouchingInvoices = migrationsMentioning("delivery_fee")
      .filter((f) => migration(f).includes("public.invoices"));
    expect(migrationsTouchingInvoices).toEqual([]);
  });

  it("swallows the resulting 42703 by not destructuring the error, so invoice reads as null", () => {
    expect(src).toContain('const { data: invoice } = await supabase');
    const q = src.slice(src.indexOf('const { data: invoice } = await supabase'), src.indexOf(".single();", src.indexOf('const { data: invoice } = await supabase')));
    expect(q).not.toContain("error");
  });

  it("then books the entire refund as a single Rental entry, deposit and all", () => {
    expect(src).toContain('categoryRefunds["Rental"] = totalRefunded;');
    // ...which becomes one type:'Refund' ledger row per category key.
    const insert = src.slice(src.indexOf('.from("ledger_entries")'), src.indexOf("});", src.indexOf('.from("ledger_entries")')));
    expect(insert).toContain('type: "Refund",');
    expect(insert).toContain("category,");
  });

  it("is read as 'no deposit was refunded' by both ceilings that matter", () => {
    const deduct = readEdgeFunctionSource("deduct-from-deposit");
    expect(deduct).toContain('.eq("category", "Security Deposit")');
    expect(deduct).toContain("const totalDepositRefunded = Math.abs(");
  });

  it.fails("should select only columns the invoices table actually has", () => {
    // Remove the .fails marker once supabase/functions/refund-installment-payments/index.ts:348
    // is fixed (rental_amount -> rental_fee).
    expect(fallbackSelect.filter((c) => !invoiceColumns.includes(c))).toEqual([]);
  });
});

// @usecase Cancelling an installment rental whose upfront payment was already refunded books the upfront's categories a second time as negative ledger rows, so every availableForRefund ceiling derived from them is wrong by the upfront amount in the direction that blocks a legitimate later refund.
describe("refund-installment-payments — the upfront counted whether or not this run refunded it", () => {
  const src = readEdgeFunctionSource("refund-installment-payments");

  /** index.ts:320-323. */
  const refundedIdsBlock = src.slice(
    src.indexOf("const refundedPaymentIds = ["),
    src.indexOf("];", src.indexOf("const refundedPaymentIds = [")),
  );

  it("filters the installments on action === 'refunded' and the upfront on nothing but existence", () => {
    expect(refundedIdsBlock).toContain("...(plan.upfront_payment_id ? [plan.upfront_payment_id] : [])");
    expect(refundedIdsBlock).toContain('results.filter(r => r.action === "refunded" && r.paymentId)');
  });

  it("only actually refunds the upfront behind a three-way guard, and only then adds to totalRefunded", () => {
    // index.ts:260 — already-Refunded, or no Stripe handle, and nothing happens.
    expect(src).toContain(
      'if (upfrontPayment && upfrontPayment.status !== "Refunded" && upfrontPayment.stripe_payment_intent_id) {',
    );
    const guarded = src.slice(
      src.indexOf('if (upfrontPayment && upfrontPayment.status !== "Refunded"'),
      src.indexOf("} catch (err: any) {", src.indexOf('if (upfrontPayment && upfrontPayment.status !== "Refunded"')),
    );
    expect(guarded).toContain("totalRefunded += upfrontPayment.amount;");
  });

  it("never reconciles the category split against totalRefunded before writing the rows", () => {
    const betweenSplitAndInsert = src.slice(
      src.indexOf("let allocatedTotal = 0;"),
      src.indexOf("// Create a refund ledger entry per category"),
    );
    expect(betweenSplitAndInsert).not.toMatch(/allocatedTotal\s*[!=><]=?\s*totalRefunded/);
    // ...yet totalRefunded is what the caller is told was refunded.
    expect(src).toContain("totalRefunded");
  });

  it.fails("should include the upfront in the category split only when this run actually refunded it", () => {
    // Remove the .fails marker once supabase/functions/refund-installment-payments/index.ts:320-321
    // is fixed.
    expect(refundedIdsBlock).not.toContain("...(plan.upfront_payment_id ? [plan.upfront_payment_id] : [])");
  });
});

// @usecase A cancellation refund silently records nothing in the ledger, so the money still reads as fully refundable and can be handed back a second time from the rental page — the precise failure the surrounding comment block says this code was written to prevent.
describe("cancel-rental-refund — the merge lookup that ignores the extension slot it writes", () => {
  const src = readEdgeFunctionSource("cancel-rental-refund");

  /** index.ts:569-576 — the lookup. */
  const lookup = src.slice(
    src.indexOf("const { data: existing } = await supabase"),
    src.indexOf(".maybeSingle();", src.indexOf("const { data: existing } = await supabase")),
  );
  /** index.ts:583-598 — the insert it falls back to. */
  const insert = src.slice(
    src.indexOf("await supabase.from(\"ledger_entries\").insert({", src.indexOf("const { data: existing } = await supabase")),
    src.indexOf("});", src.indexOf("await supabase.from(\"ledger_entries\").insert({", src.indexOf("const { data: existing } = await supabase"))),
  );

  it("looks the row up on rental, type, category and due_date, and not on extension_id", () => {
    for (const clause of ['.eq("rental_id", rentalId)', '.eq("type", "Refund")', '.eq("category", cat)', '.eq("due_date", today)']) {
      expect(lookup).toContain(clause);
    }
    expect(lookup).not.toContain("extension_id");
  });

  it("writes extension_id on the insert two lines below, so the two halves disagree", () => {
    expect(insert).toContain("...(info.extensionId ? { extension_id: info.extensionId } : {})");
  });

  it("is the inverse of an index that DOES carry the extension slot, with no type predicate to exempt refunds", () => {
    const idx = migration("20260418140000_ledger_unique_include_extension.sql");
    expect(idx).toContain("CREATE UNIQUE INDEX ux_rental_charge_unique");
    expect(idx).toContain("COALESCE(extension_id::text, '')");
    expect(idx).not.toContain("WHERE");
  });

  it("discards the maybeSingle error, so a two-row match reads as 'nothing to merge'", () => {
    expect(lookup.startsWith("const { data: existing } = await supabase")).toBe(true);
    expect(lookup).not.toContain("error");
  });

  it("is the odd one out: process-refund pins the slot in both directions", () => {
    const pr = readEdgeFunctionSource("process-refund");
    expect(pr).toContain('existingQuery = existingQuery.eq("extension_id", extensionId);');
    expect(pr).toContain('existingQuery = existingQuery.is("extension_id", null);');
  });

  it("needs a pre-existing same-day row to collide, because one call writes at most one row per category", () => {
    // byCategory (index.ts:554-559) keys on category and keeps ONE extensionId.
    expect(src).toContain(
      "const byCategory: Record<string, { amount: number; extensionId: string | null }> = {};",
    );
  });

  it.fails("should discriminate the extension slot on the merge lookup, the way process-refund does", () => {
    // Remove the .fails marker once supabase/functions/cancel-rental-refund/index.ts:570-576
    // is fixed.
    expect(lookup).toContain("extension_id");
  });
});

// @usecase Excess-mileage deduction against a live deposit authorisation cannot work at all: the operator is told the customer has no deposit while the hold sits on their card, and several hundred lines of multicapture handling below the guard are unreachable in that configuration.
describe("deduct-from-deposit — the guard that turns away a live deposit hold", () => {
  const src = readEdgeFunctionSource("deduct-from-deposit");

  const guardIdx = src.indexOf("if (availableDeposit <= 0) {");
  const holdBranchIdx = src.indexOf(
    "if (rental.deposit_hold_status === 'held' && rental.deposit_hold_payment_intent_id) {",
  );
  const hasLiveHoldIdx = src.indexOf("const hasLiveHold =");
  /** The guard's condition plus its refusal, as written. */
  const guardText = src.slice(guardIdx, src.indexOf("}", src.indexOf('errorResponse("No deposit available to deduct from")')));
  /** True while a rental whose deposit is only a live authorisation is refused. */
  const refusesLiveHoldRental = guardIdx > 0 && guardIdx < holdBranchIdx && !/hold/i.test(guardText);

  it("measures the deposit from a ledger Security Deposit CHARGE and nothing else", () => {
    const calc = src.slice(src.indexOf("const totalDepositCharged"), src.indexOf("console.log(\"[DEDUCT-DEPOSIT] Deposit analysis:\""));
    expect(calc).toContain("const totalDepositPaid = totalDepositCharged - totalDepositRemaining;");
    expect(calc).toContain("const availableDeposit = totalDepositPaid - totalDepositRefunded;");
    expect(calc).not.toMatch(/deposit_hold_amount/);
  });

  it("refuses on that figure at index.ts:173, before the hold-capture branch at index.ts:246 is reachable", () => {
    expect(refusesLiveHoldRental).toBe(true);
    expect(guardIdx).toBeLessThan(holdBranchIdx);
    // hasLiveHold is not even in scope yet: it is declared at :203, below the guard.
    expect(hasLiveHoldIdx).toBeGreaterThan(guardIdx);
    expect(src).toContain('return errorResponse("No deposit available to deduct from");');
  });

  it("is a figure a hold tenant cannot have, because the two deposit models are mutually exclusive", () => {
    const place = readEdgeFunctionSource("place-deposit-hold");
    expect(place).toContain(
      "A tenant on CHARGED deposits collects the deposit as a real payment against",
    );
    expect(place).toContain(
      'if ((tenant as { deposit_charge_enabled?: boolean }).deposit_charge_enabled === true) {',
    );
  });

  it("bites a CHARGED tenant too, because the FIFO allocator does not rank Security Deposit at all", () => {
    const fifo = migration("20260603120000_fifo_v2_generic_pays_extension.sql");
    const catOrder = fifo.slice(fifo.indexOf("WITH cat_order AS ("), fifo.indexOf("SELECT le.id, le.remaining_amount"));
    expect(catOrder).not.toContain("Security Deposit");
    // ...and the join is INNER, so an unranked category is never allocated,
    // leaving remaining_amount untouched and totalDepositPaid at 0.
    expect(fifo).toContain("JOIN cat_order co ON co.cat = le.category");
    expect(fifo).not.toContain("LEFT JOIN cat_order");
  });

  it("lets a LATER deduction through once a capture has written the charge itself", () => {
    // capture-deposit-hold/index.ts:351-366 inserts the Security Deposit Charge
    // with remaining_amount 0, so after any capture availableDeposit is positive.
    // The defect is the FIRST deduction, not every one.
    const capture = readEdgeFunctionSource("capture-deposit-hold");
    const chargeInsert = capture.slice(
      capture.indexOf('category: "Security Deposit",'),
      capture.indexOf("})", capture.indexOf('category: "Security Deposit",')),
    );
    expect(chargeInsert).toContain("remaining_amount: 0,");
  });

  it.fails("should let a rental whose deposit is a live authorisation reach the hold-capture path", () => {
    // Remove the .fails marker once supabase/functions/deduct-from-deposit/index.ts:159-178
    // is fixed — either by counting a live hold towards availableDeposit, or by
    // moving the refusal below the hold branch. This assertion passes on either.
    expect(refusesLiveHoldRental).toBe(false);
  });
});

// @usecase Every refunded rental leaves its full revenue in the operator's P&L. The team already reasoned about exactly this for security deposits and carved that one category out; the other ranked categories still have the hole.
describe("every refund path — the P&L revenue nothing reverses", () => {
  const REFUND_PATHS = [
    "process-refund",
    "cancel-rental-refund",
    "deduct-from-deposit",
    "refund-installment-payments",
    "process-scheduled-refund",
  ] as const;

  it("mentions pnl_entries in none of the five functions that move money back to a customer", () => {
    const mentions = Object.fromEntries(
      REFUND_PATHS.map((fn) => [fn, (readEdgeFunctionSource(fn).match(/pnl/gi) ?? []).length]),
    );
    expect(mentions).toEqual({
      "process-refund": 0,
      "cancel-rental-refund": 0,
      "deduct-from-deposit": 0,
      "refund-installment-payments": 0,
      "process-scheduled-refund": 0,
    });
  });

  it("books that revenue on the way in from both allocators, as side 'Revenue'", () => {
    expect(migration("20260603120000_fifo_v2_generic_pays_extension.sql")).toContain(
      "VALUES (v_vehicle, c.due_date, 'Revenue', c.category, to_apply,",
    );
    expect(readEdgeFunctionSource("apply-payment")).toContain("side: 'Revenue',");
  });

  it("has the hole written down in the codebase already, in the one carve-out that was made", () => {
    // apply-payment/index.ts:757-761 — the reasoning, applied to Security
    // Deposit only.
    const ap = readEdgeFunctionSource("apply-payment");
    expect(ap).toContain("at refund time — and process-refund writes no P&L reversal, so that");
    expect(ap).toContain("if (category !== 'Security Deposit') {");
  });

  it.fails("should write a negative Revenue correction to pnl_entries when a refund is recorded", () => {
    // Remove the .fails marker once supabase/functions/process-refund/index.ts
    // writes a P&L reversal for the categories it refunds.
    expect(readEdgeFunctionSource("process-refund")).toContain("pnl_entries");
  });
});

// @usecase Any auto-extension carrying an occurrence extra fails outright after the renewal has already been decided — not one missing add-on row, but the entire extension's Rental, Tax, Service Fee and Insurance charges, because they go in as one multi-row insert that throws.
describe("auto-extend-rentals — the ledger category three separate lists have never admitted", () => {
  const src = readEdgeFunctionSource("auto-extend-rentals");

  /** The ledgerRows array, index.ts:481-487. */
  const ledgerRowsBlock = src.slice(
    src.indexOf("const ledgerRows: any[] = ["),
    src.indexOf("const { error: ledgerErr } = await supabase.from(\"ledger_entries\").insert(ledgerRows);"),
  );
  const CATEGORIES_WRITTEN = [...new Set([...ledgerRowsBlock.matchAll(/category: "([^"]+)"/g)].map((m) => m[1]))];

  const latestLedgerCategoryMigration = migrationsMentioning("ledger_entries_category_check").at(-1)!;
  const LEDGER_CATEGORIES = arrayLiteralsAfter(
    migration(latestLedgerCategoryMigration).slice(
      migration(latestLedgerCategoryMigration).indexOf("ADD CONSTRAINT ledger_entries_category_check"),
    ),
    "CHECK",
  );
  const latestPnlCategoryMigration = migrationsMentioning("chk_pnl_category_valid").at(-1)!;
  const PNL_CATEGORIES = arrayLiteralsAfter(
    migration(latestPnlCategoryMigration).slice(
      migration(latestPnlCategoryMigration).indexOf("ADD CONSTRAINT chk_pnl_category_valid"),
    ),
    "CHECK",
  );

  it("writes five Extension* categories, one of which is 'Extension Add-on'", () => {
    expect(CATEGORIES_WRITTEN).toEqual([
      "Extension Rental",
      "Extension Tax",
      "Extension Service Fee",
      "Extension Add-on",
      "Extension Insurance",
    ]);
  });

  it("is absent from the latest ledger category CHECK, which does list the other four", () => {
    expect(latestLedgerCategoryMigration).toBe("20260503090449_add_unlimited_mileage_upgrade.sql");
    for (const c of ["Extension Rental", "Extension Tax", "Extension Service Fee", "Extension Insurance"]) {
      expect(LEDGER_CATEGORIES).toContain(c);
    }
    expect(LEDGER_CATEGORIES).not.toContain("Extension Add-on");
    // Not a stale first draft either: the string appears in no migration at all.
    expect(migrationsMentioning("Extension Add-on")).toEqual([]);
  });

  it("is absent from the latest P&L category CHECK as well", () => {
    expect(latestPnlCategoryMigration).toBe("20260602120200_allow_expenses_pnl_category.sql");
    expect(PNL_CATEGORIES).toContain("Extension Insurance");
    expect(PNL_CATEGORIES).not.toContain("Extension Add-on");
  });

  it("is unranked by the FIFO allocator, so even a widened CHECK would leave the charge unsettleable", () => {
    const fifo = migration("20260603120000_fifo_v2_generic_pays_extension.sql");
    const catOrder = fifo.slice(fifo.indexOf("WITH cat_order AS ("), fifo.indexOf("SELECT le.id, le.remaining_amount"));
    expect(catOrder).toContain("'Extension Insurance', 11");
    expect(catOrder).not.toContain("Extension Add-on");
  });

  it("takes the whole extension down with it, because all five rows go in as one insert that throws", () => {
    expect(src).toContain(
      'const { error: ledgerErr } = await supabase.from("ledger_entries").insert(ledgerRows);',
    );
    expect(src).toContain("if (ledgerErr) throw ledgerErr;");
  });

  it("is a live value everywhere else: five functions name it as a payment target category", () => {
    for (const fn of [
      "stripe-webhook-live",
      "auto-extend-rentals",
      "process-pending-payment",
      "send-auto-extension-reminder",
      "sandbox-auto-extend-rentals",
    ]) {
      expect(readEdgeFunctionSource(fn)).toContain("Extension Add-on");
    }
    // send-auto-extension-reminder:77-79 says the inclusion is mandatory.
    expect(readEdgeFunctionSource("send-auto-extension-reminder")).toContain(
      'It MUST include "Extension Add-on"',
    );
  });

  it("carries the identical line in the sandbox twin, so a fix must land in both", () => {
    expect(readEdgeFunctionSource("sandbox-auto-extend-rentals")).toContain(
      'category: "Extension Add-on", reference: `Auto-extend #${seq}: ${ex.label}`',
    );
  });

  it.fails("should keep the ledger CHECK admitting every category auto-extend-rentals writes", () => {
    // Remove the .fails marker once supabase/functions/auto-extend-rentals/index.ts:486
    // and supabase/functions/sandbox-auto-extend-rentals/index.ts:388 are fixed
    // (or a migration widens ledger_entries_category_check to admit them).
    expect(CATEGORIES_WRITTEN.filter((c) => !LEDGER_CATEGORIES.includes(c))).toEqual([]);
  });
});
