// =============================================================================
// WEBHOOK EVENT DEPTH — what each Stripe delivery actually WRITES, and what the
// reconciliation tail behind it writes when a delivery is missed.
//
// WHAT THIS FILE COVERS
// ---------------------
// `integrations/stripe/webhook.test.ts` covers the ENVELOPE: who is allowed to
// post, which event types are dispatched, what status code comes back, whether a
// replay is claimed. `integrations/webhooks/health.test.ts` covers the DELIVERY
// RECORD: is the fact of the delivery written down at all.
//
// Neither looks inside a handler at the row it writes. This file does. Eleven
// specific writes, each one a place where the row that lands in `payments`,
// `invoices` or `webhook_deliveries` does not mean what the rest of the system
// reads it as meaning:
//
//   A  payment_intent.succeeded stamps status 'Applied' — the word that means
//      "fully allocated" everywhere else — without zeroing remaining_amount.
//   B  the declined-card handler is gated on PaymentIntent metadata the MAIN
//      booking checkout never puts there.
//   C  the invoice branch closes an invoice as paid on a path that recorded no
//      payments row at all.
//   D  the extension self-heal exists in the live fork and not the test one.
//   E  that self-heal inserts after a read error it captured and ignored.
//   F  an event that fell through to `default:` is recorded as outcome
//      "handled", identically to a settled payment.
//   G  the one outcome worth alerting on — "failed" — carries no event id.
//   H  the legacy fork, still open at the gateway, records no delivery at all.
//   I  the every-minute recovery cron commits money without the auto-approval
//      every webhook completion path writes.
//   J  that same cron re-commits by id alone, with no status fence.
//   K  audit-stripe-payment reports an UNCAPTURED authorisation's full nominal
//      as "net at Stripe".
//
// LAYERS, AND WHY
// ---------------
// Mostly LAYER 1 — the edge functions are Deno modules with top-level
// `Deno.serve`, remote https: imports and `Deno.env`; they cannot be imported
// under vitest, so their behaviour is asserted against their own source read as
// text. That is a real limit, and the assertions are written to respect it: they
// pin STRUCTURE (this write is nested inside that `if`; this key is absent from
// that object literal), never a claim that could only be settled by running the
// function.
//
// Two exceptions:
//   * LAYER 3 executable — `_shared/webhook-health.ts` is plain TypeScript with
//     no Deno globals, so it imports through the `@fn` alias and is EXECUTED
//     against a capturing fake client. That is how F and G are proved rather
//     than asserted: the row the recorder builds is inspected directly.
//   * LAYER 3 arithmetic — K's numbers are hand-derived, with the sum written in
//     the comment beside each one. Nothing here is copied out of program output.
//
// No LAYER 2. Every finding here is about a row written into OUR database as a
// side effect of a delivery; a live HTTP probe can see the 200 and nothing else,
// and the only way to make one of these observable over the wire would be to
// send a real signed event, which means moving real money.
//
// WHAT THIS FILE DELIBERATELY DOES NOT COVER
// ------------------------------------------
//   * signature verification and the order of the guards — health.test.ts.
//   * which event types are dispatched, redelivery, status codes, the platform
//     account — integrations/stripe/webhook.test.ts.
//   * the PLATFORM subscription rail (`subscription-webhook`, Drive247 billing
//     its own tenants). Different Stripe account, different keys, covered in
//     integrations/stripe/checkout.test.ts.
//   * Square. Square is cited here three times as the in-repo PRECEDENT for a
//     shape the Stripe rail is missing, and never asserted on for its own sake.
//   * whether the FIFO allocator itself allocates correctly. This file asserts
//     only that the allocator was or was not INVOKED, and what the row claimed
//     about itself either way.
//
// NON-OBVIOUS MECHANISMS A LATER READER WILL TRIP ON
// --------------------------------------------------
//   1. `src()` blanks every comment to same-length spaces before matching.
//      Offsets and line/column positions survive, the words do not. This is
//      load-bearing: `stripe-webhook-live` documents the RevTek self-heal in a
//      six-line comment that names `rental_extensions`, and the test-fork
//      assertion "this fork contains no rental_extensions lookup" would fail
//      against its sibling's prose if it read raw text. Where a test genuinely
//      asserts what the PROSE says (H's false comment in the Square recovery),
//      it uses `prose()` and says so.
//   2. Indentation is used as structural proof in C. `if (invoiceRentalId) {`
//      sits at 12 spaces and the `invoices` update at 10, in both forks — that
//      difference IS the nesting, and it is checkable offline where "is this
//      statement inside that block" otherwise is not. If someone reformats these
//      files, C goes red for a formatting reason; the fix is to re-derive the
//      depths, not to delete the assertion.
//   3. B resolves `payment_intent_data` through one level of indirection.
//      `create-preauth-checkout` writes `payment_intent_data: paymentIntentData`
//      (an identifier) and `create-installment-checkout` / `create-upfront-checkout`
//      write ES6 shorthand `metadata,` — so a flat grep for "rental_id near
//      payment_intent_data" misreads three of the nine creators.
//      `piMetadataCarriesRentalId()` brace-matches the object and follows an
//      identifier, or a shorthand key, to its `const` declaration.
//   4. `readEdgeFunction()` from helpers/edge-contract hardcodes the variable
//      name `body` and throws on 135 of 271 body-reading functions. Nothing here
//      calls it; only `readEdgeFunctionSource` / `blankComments` / `REPO_ROOT`,
//      which are plain file reads.
//
// HOW A DEFECT IS RECORDED HERE
// -----------------------------
// Two tests, always:
//   * a plain test titled "PINS TODAY'S BEHAVIOUR", asserting the ACTUAL wrong
//     shape, so the size of the bug is on record; and
//   * an `it.fails(...)` asserting the CORRECT behaviour, which PASSES while the
//     bug lives and turns RED the day it is fixed — forcing a human back here to
//     delete the pin and drop the marker.
// A plain test asserting the broken shape would go red on the FIX instead. That
// mistake has been made five times in this repo and undone five times.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blankComments, readEdgeFunctionSource, REPO_ROOT } from "../../helpers/edge-contract";
import { recordWebhookDelivery } from "@fn/_shared/webhook-health.ts";

// ---------------------------------------------------------------------------
// Reading source.
// ---------------------------------------------------------------------------

/** Source with comments blanked to spaces. Offsets preserved. See mechanism 1. */
const src = (fn: string) => blankComments(readEdgeFunctionSource(fn));

/** Source WITH comments, for the two assertions about what the prose claims. */
const prose = (fn: string) => readEdgeFunctionSource(fn);

/** The pair of moded booking forks a healthy deployment actually routes to. */
const MODED_FORKS = ["stripe-webhook-test", "stripe-webhook-live"] as const;

const CONFIG_TOML = readFileSync(join(REPO_ROOT, "supabase", "config.toml"), "utf8");

/**
 * The body of one `case "<eventType>":` label, up to the next `case` or
 * `default:`. Copied deliberately rather than shared: helpers/ is off limits to
 * this file, and none of these four handlers nests a switch, so the naive form
 * is exact. If a nested switch ever appears this returns TOO MUCH — every
 * assertion built on it below is of the form "string X is ABSENT from the
 * block", which an over-large block can only make harder to pass, never easier.
 */
function caseBlock(text: string, eventType: string): string {
  const at = text.search(new RegExp(`case\\s+["']${eventType.replace(/\./g, "\\.")}["']\\s*:`));
  if (at === -1) return "";
  const rest = text.slice(at + eventType.length);
  const end = /\n\s*(?:case\s+["']|default\s*:)/.exec(rest);
  return rest.slice(0, end ? end.index : rest.length);
}

/** The balanced `{...}` starting at index `i`. Template-literal `${}` balances too. */
function braceMatch(text: string, i: number): string | null {
  let depth = 0;
  for (let k = i; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") {
      depth--;
      if (depth === 0) return text.slice(i, k + 1);
    }
  }
  return null;
}

/** The object literal assigned to `const/let/var <name> = { ... }`, anywhere in the file. */
function declaredObject(file: string, name: string): string | null {
  const d = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b[^=\\n]*=\\s*`).exec(file);
  if (!d) return null;
  let s = d.index + d[0].length;
  while (/\s/.test(file[s])) s++;
  return file[s] === "{" ? braceMatch(file, s) : null;
}

/**
 * Resolve property `key` of object-literal text `obj` to an object literal.
 * Handles all three forms these creators use:
 *   `key: { ... }`   `key: someIdentifier`   `key,`  (ES6 shorthand)
 */
function resolveProp(file: string, obj: string, key: string): string | null {
  const inline = new RegExp(`\\b${key}\\s*:`).exec(obj);
  if (inline) {
    let j = inline.index + inline[0].length;
    while (/\s/.test(obj[j])) j++;
    if (obj[j] === "{") return braceMatch(obj, j);
    const id = /^[A-Za-z_$][\w$]*/.exec(obj.slice(j));
    return id ? declaredObject(file, id[0]) : null;
  }
  const shorthand = new RegExp(`[{,]\\s*${key}\\s*(?:,|\\n|\\})`).exec(obj);
  return shorthand ? declaredObject(file, key) : null;
}

/**
 * Does this checkout creator copy `rental_id` onto the PaymentIntent's own
 * metadata? Stripe does NOT copy Checkout Session metadata onto the
 * PaymentIntent, which is why five creators duplicate it by hand.
 */
function piMetadataCarriesRentalId(fn: string): boolean {
  const file = src(fn);
  const pid = resolveProp(file, file, "payment_intent_data");
  if (!pid) return false;
  if (/\brental_id\b/.test(pid)) return true;
  const md = resolveProp(file, pid, "metadata");
  return !!md && /\brental_id\b/.test(md);
}

// ===========================================================================
// A. 'Applied' WITHOUT AN ALLOCATION.
// ===========================================================================

// @usecase A payment left deliberately 'Partial' or 'Credit' by the allocator —
// money still sitting unallocated — is rewritten to 'Applied' by the next
// payment_intent.succeeded delivery, so the row claims to be fully allocated
// while the balance is still owed. It is then unrecoverable: the every-minute
// recovery cron selects only 'Pending' and 'Credit', and the FIFO trigger fires
// only on the transition into 'Completed'.
describe("stripe/webhook — what the word 'Applied' claims about a row", () => {
  it("PINS TODAY'S BEHAVIOUR: payment_intent.succeeded writes status 'Applied' without touching remaining_amount", () => {
    // ON RECORD. The handler updates three columns — status, capture_status,
    // updated_at — and nothing else. No remaining_amount, no apply-payment
    // invoke, no payment_apply_fifo_v2 RPC. stripe-webhook-test/index.ts:1645,
    // stripe-webhook-live/index.ts:1704.
    for (const fn of MODED_FORKS) {
      const block = caseBlock(src(fn), "payment_intent.succeeded");
      expect(block, `${fn} no longer has a payment_intent.succeeded block`).not.toBe("");
      expect(block).toContain('status: "Applied"');
      expect(
        block,
        `${fn}'s payment_intent.succeeded now writes remaining_amount — check whether ` +
          `this is the fix and drop the .fails marker below.`,
      ).not.toContain("remaining_amount");
      expect(block).not.toContain("apply-payment");
      expect(block).not.toContain("payment_apply_fifo_v2");
    }
  });

  it("shows the allocator itself treating 'Applied' and remaining_amount = 0 as one fact", () => {
    // payment_apply_fifo_v2 is the authority on this vocabulary, and it never
    // separates the two. The webhook above is the only writer in the system that
    // does. Migration 20260603120000_fifo_v2_generic_pays_extension.sql:136.
    const fifo = readFileSync(
      join(REPO_ROOT, "supabase", "migrations", "20260603120000_fifo_v2_generic_pays_extension.sql"),
      "utf8",
    );
    expect(fifo).toContain("UPDATE payments SET status = 'Applied', remaining_amount = 0 WHERE id = p_id;");
    expect(fifo).toContain("UPDATE payments SET status = 'Credit', remaining_amount = v_left WHERE id = p_id;");
    expect(fifo).toContain("UPDATE payments SET status = 'Partial', remaining_amount = v_left WHERE id = p_id;");
  });

  it("finds the schema saying in as many words what 'Applied' is supposed to mean", () => {
    // The column comment is the definition the whole system is written against.
    // Migration 20260121100000_add_reversed_payment_status.sql:12.
    const statuses = readFileSync(
      join(REPO_ROOT, "supabase", "migrations", "20260121100000_add_reversed_payment_status.sql"),
      "utf8",
    );
    expect(statuses).toContain("Applied (fully allocated)");
    expect(statuses).toContain("Credit (unallocated balance)");
    expect(statuses).toContain("Partial (partially allocated)");
  });

  it.fails("a webhook that declares a payment fully allocated either allocates it or zeroes its remainder", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook-test/index.ts:1645
    // (and stripe-webhook-live/index.ts:1704) is fixed.
    //
    // Two acceptable fixes. Either write the pair the allocator writes —
    // `status: "Applied", remaining_amount: 0` — or, better, write
    // 'Completed' and let auto_fifo_on_payment_completed do the allocation, the
    // way every other completion path on this rail does. What must not survive
    // is a row claiming full allocation that nothing ever allocated.
    for (const fn of MODED_FORKS) {
      const block = caseBlock(src(fn), "payment_intent.succeeded");
      const allocates =
        /remaining_amount/.test(block) || /apply-payment/.test(block) || /payment_apply_fifo_v2/.test(block);
      expect(
        allocates,
        `${fn}'s payment_intent.succeeded still stamps 'Applied' on a row it never allocated, ` +
          `so unallocated money reads as fully allocated and no recovery pass will ever look at it again.`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// B. THE DECLINED CARD NOBODY IS TOLD ABOUT.
// ===========================================================================

// @usecase A customer's card is declined on the primary booking checkout and the
// operator's bell never rings — no notification, no log line naming the rental,
// nothing — because the whole handler is gated on PaymentIntent metadata that
// `create-checkout-session` does not set. The booking simply never becomes paid
// and the first report comes from the customer.
describe("stripe/webhook — a declined card on the main booking checkout", () => {
  const FAILED = "payment_intent.payment_failed";

  /**
   * Every creator that can produce a payment against a RENTAL, and whose
   * failure therefore ought to raise the operator alert.
   * `create-credit-checkout` is excluded on purpose: a platform credit purchase
   * has no rental behind it, so it is right that its PI metadata carries none.
   */
  const RENTAL_CHECKOUT_CREATORS = [
    "create-checkout-session",
    "create-preauth-checkout",
    "create-hold-checkout",
    "create-installment-checkout",
    "create-upfront-checkout",
    "auto-extend-rentals",
    "send-auto-extension-reminder",
    "send-payg-reminders",
    "send-payg-manual-reminder",
  ] as const;

  it("gates the entire failure handler on the PaymentIntent's own metadata, in all three booking forks", () => {
    // stripe-webhook-test:1814, stripe-webhook-live:1873, stripe-webhook:1048.
    // The notify call, the customer lookup and the log line are all inside the
    // `if (rentalId)`.
    for (const fn of ["stripe-webhook-test", "stripe-webhook-live", "stripe-webhook"]) {
      const block = caseBlock(src(fn), FAILED);
      expect(block, `${fn} no longer handles ${FAILED}`).not.toBe("");
      expect(block).toContain("const rentalId = paymentIntent.metadata?.rental_id;");
      expect(block).toContain("if (rentalId) {");
    }
  });

  it("rings the operator bell only from inside that gate, in the two moded forks", () => {
    for (const fn of MODED_FORKS) {
      const block = caseBlock(src(fn), FAILED);
      const gate = block.indexOf("if (rentalId) {");
      const bell = block.indexOf("notifyOperatorsInApp");
      expect(bell, `${fn} no longer notifies operators on a declined card`).toBeGreaterThan(-1);
      expect(
        bell,
        `${fn}'s notifyOperatorsInApp call has moved outside the rental_id gate — check whether ` +
          `this is the fix and drop the .fails marker below.`,
      ).toBeGreaterThan(gate);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: create-checkout-session puts nothing but setup_future_usage on the PaymentIntent", () => {
    // ON RECORD, and this is the primary customer booking flow. rental_id is set
    // on the SESSION metadata (create-checkout-session/index.ts:415-417), which
    // Stripe does not copy down to the PaymentIntent — which is precisely why
    // the other creators duplicate it by hand.
    const file = src("create-checkout-session");
    const pid = resolveProp(file, file, "payment_intent_data");
    expect(pid, "create-checkout-session no longer sets payment_intent_data at all").not.toBeNull();
    expect(pid).toContain("setup_future_usage");
    expect(
      pid,
      "create-checkout-session's payment_intent_data now carries metadata — check whether " +
        "this is the fix and drop the .fails marker below.",
    ).not.toContain("metadata");
    // The rental_id IS there, one level up, where the failure handler cannot see it.
    expect(file).toContain("rental_id: rentalId,");
  });

  it("PINS TODAY'S BEHAVIOUR: five of the nine rental checkout creators leave the PaymentIntent unlabelled", () => {
    // ON RECORD as the size of the blind spot. The four that do it correctly are
    // the pre-auth, deposit-hold and two instalment paths — and the one missing
    // is the PRIMARY customer booking flow, plus every auto-extend and
    // pay-as-you-go reminder link. create-preauth-checkout/index.ts:111-128 is
    // the house pattern.
    const carrying = RENTAL_CHECKOUT_CREATORS.filter(piMetadataCarriesRentalId);
    expect([...carrying].sort()).toEqual([
      "create-hold-checkout",
      "create-installment-checkout",
      "create-preauth-checkout",
      "create-upfront-checkout",
    ]);
    const missing = RENTAL_CHECKOUT_CREATORS.filter((fn) => !piMetadataCarriesRentalId(fn));
    expect([...missing].sort()).toEqual([
      "auto-extend-rentals",
      "create-checkout-session",
      "send-auto-extension-reminder",
      "send-payg-manual-reminder",
      "send-payg-reminders",
    ]);
  });

  it("shows the house pattern in the two that get it right, so the fix is a copy and not a redesign", () => {
    const preauth = src("create-preauth-checkout");
    expect(preauth).toContain("const paymentIntentData: any = {");
    expect(preauth).toContain("metadata: paymentMetadata,");
    expect(preauth).toContain("rental_id: body.rentalId,");
  });

  it.fails("every checkout creator whose failures should alert copies rental_id onto payment_intent_data.metadata", () => {
    // Remove the .fails marker once supabase/functions/create-checkout-session/index.ts:398-400
    // is fixed (and the six reminder/extension creators listed below with it).
    //
    // The fix is three lines per creator: add `metadata: { rental_id, tenant_id,
    // customer_id }` to the payment_intent_data object, exactly as
    // create-preauth-checkout and create-hold-checkout already do. Until then a
    // declined card on the booking flow is silent.
    const missing = RENTAL_CHECKOUT_CREATORS.filter((fn) => !piMetadataCarriesRentalId(fn));
    expect(
      missing,
      `these creators still build a PaymentIntent with no rental_id, so payment_intent.payment_failed ` +
        `does nothing at all for them: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// C. AN INVOICE CLOSED AS PAID WITH NOTHING RECORDED AGAINST IT.
// ===========================================================================

// @usecase An emailed invoice payment link whose session metadata carries no
// rental_id — or whose fallback insert fails — captures the customer's money at
// Stripe, marks the invoice paid so it stops chasing, and leaves zero payments
// rows and zero ledger entries. The revenue is invisible to the ledger, to owner
// payouts and to the operator, and the webhook returns 200 so Stripe never
// retries.
describe("stripe/webhook — closing an invoice that recorded no payment", () => {
  it("PINS TODAY'S BEHAVIOUR: the fallback payments insert is nested inside a rental_id check, the invoice update is not", () => {
    // ON RECORD. Indentation IS the nesting here (mechanism 2 in the header):
    // `if (invoiceRentalId) {` at 12 spaces, the `invoices` update at 10, i.e.
    // one level shallower and therefore AFTER the whole if/else.
    // stripe-webhook-live/index.ts:623 and :656; stripe-webhook-test:611 and :645.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      expect(s, `${fn} no longer guards its fallback insert on invoiceRentalId`).toMatch(
        /^ {12}if \(invoiceRentalId\) \{$/m,
      );
      expect(s, `${fn} no longer closes the invoice unconditionally`).toMatch(
        /^ {10}await supabase\.from\("invoices"\)\.update\(\{ status: "paid" \}\)/m,
      );
      const guard = s.search(/^ {12}if \(invoiceRentalId\) \{$/m);
      const closed = s.search(/^ {10}await supabase\.from\("invoices"\)\.update\(\{ status: "paid" \}\)/m);
      expect(closed).toBeGreaterThan(guard);
    }
  });

  it("PINS TODAY'S BEHAVIOUR: the fallback insert's own error is destructured away and its null result silently skipped", () => {
    // `const { data: newPayment } = await supabase.from("payments").insert(...)`
    // — no `error:`. A failed insert yields newPayment === null, the
    // `if (newPayment)` below simply does not run, and control falls straight
    // through to the invoice update. live:626, test:614.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      const at = s.indexOf("const { data: newPayment } = await supabase");
      expect(at, `${fn} no longer uses the unchecked fallback insert form`).toBeGreaterThan(-1);
      const decl = s.slice(at, at + 120);
      expect(decl).not.toMatch(/error:\s*\w*[Ee]rror/);
      expect(s).toContain("if (newPayment) {");
    }
  });

  it("shows the sibling branch in the same block doing it properly, so the shape is available", () => {
    // A few lines earlier, the pre-created-row path reads apply-payment's error
    // and logs it. Same handler, same file — the unchecked form below is not
    // house style. live:611-617.
    const s = src("stripe-webhook-live");
    expect(s).toContain("const { data: applyResult, error: applyError } = await supabase.functions.invoke");
    expect(s).toContain('console.error("[LIVE MODE] apply-payment error:", applyError);');
  });

  it.fails("an invoice is marked paid only once a payments row exists for that session", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook-live/index.ts:656
    // (and stripe-webhook-test/index.ts:645) is fixed.
    //
    // The fix: hold the resolved payment id in a variable across both arms and
    // guard the invoice update on it — and on the fallback insert's error, so a
    // failed insert returns 500 and Stripe redelivers instead of the invoice
    // being closed over money nothing recorded.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      const guarded = /^ {12}await supabase\.from\("invoices"\)\.update\(\{ status: "paid" \}\)/m.test(s);
      expect(
        guarded,
        `${fn} still closes the invoice as paid outside every payments-row branch, so a session ` +
          `with no rental_id — or a failed insert — captures the money and leaves no trace of it.`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// D. THE SELF-HEAL THAT EXISTS IN ONE FORK ONLY.
// ===========================================================================

// @usecase The test fork's entire purpose is to rehearse the live one. A tenant
// validating auto-extend in test mode watches the money strand exactly as
// RevTek's $294.25 did; then they go live and it silently works. Divergence in a
// rehearsal rail is the hardest class of bug to see, because every rehearsal
// passes — and here the rehearsal is the broken one.
describe("stripe/webhook — the extension self-heal, present in the live fork only", () => {
  it("PINS TODAY'S BEHAVIOUR: only the live fork reconstructs a missing auto-extend payments row", () => {
    // ON RECORD. stripe-webhook-live/index.ts:934-975 looks the extension up in
    // `rental_extensions` and inserts a payments row with booking_source
    // 'auto_extend'. The test fork's isExtension branch goes straight from the
    // lookup to `if (extensionPayment)`. stripe-webhook-test/index.ts:910-918.
    const live = src("stripe-webhook-live");
    expect(live).toContain('.from("rental_extensions")');
    expect(live).toContain('booking_source: "auto_extend",');

    // Comments are blanked before matching, so the live fork's six-line comment
    // naming rental_extensions cannot leak into this — see mechanism 1.
    const test = src("stripe-webhook-test");
    expect(
      test,
      "stripe-webhook-test now looks up rental_extensions — check whether this is the fix " +
        "and drop the .fails marker below.",
    ).not.toContain('.from("rental_extensions")');
    expect(test).not.toContain('booking_source: "auto_extend"');
  });

  it("PINS TODAY'S BEHAVIOUR: the declaration keyword is the structural tell — live reassigns, test cannot", () => {
    // `let` in live (:921) because the self-heal writes back into
    // extensionPayment; `const` in test (:910) because nothing ever will.
    expect(src("stripe-webhook-live")).toContain(
      "let { data: extensionPayment, error: extPaymentError } = await supabase",
    );
    expect(src("stripe-webhook-test")).toContain(
      "const { data: extensionPayment, error: extPaymentError } = await supabase",
    );
  });

  it("finds both forks still claiming, in their own prose, to behave identically", () => {
    // Read WITH comments on purpose — the claim is the comment. Both forks carry
    // the same verbatim note above the lookup.
    const claim = "duplicates exist in legacy";
    expect(prose("stripe-webhook-live")).toContain(claim);
    expect(prose("stripe-webhook-test")).toContain(claim);
  });

  it.fails("the extension branch is the same in both moded forks once the mode strings are normalised", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook-test/index.ts:910
    // grows the self-heal that stripe-webhook-live/index.ts:934-975 has.
    //
    // The fix is a copy of that block with "[LIVE MODE]" swapped for
    // "[TEST MODE]". There is no documented reason for these forks to differ,
    // and CLAUDE.md gives none.
    const norm = (fn: string) => {
      const s = src(fn);
      const at = s.indexOf("if (isExtension) {");
      const end = s.indexOf("case ", at);
      return s
        .slice(at, end === -1 ? s.length : end)
        .replace(/\[LIVE MODE\]|\[TEST MODE\]/g, "[MODE]")
        .replace(/\blet\b/g, "const")
        .replace(/\s+/g, " ")
        .trim();
    };
    expect(
      norm("stripe-webhook-test"),
      "the test fork's extension branch still differs from the live one, so auto-extend money " +
        "strands in the rehearsal rail exactly as RevTek's did in production.",
    ).toBe(norm("stripe-webhook-live"));
  });
});

// ===========================================================================
// E. AN INSERT AFTER A READ ERROR THAT WAS CAPTURED AND IGNORED.
// ===========================================================================

// @usecase A transient read failure on the extension lookup takes the same
// branch as "there is no row", and that branch INSERTS. A second payments row is
// created for a session that already has one, completed and allocated —
// double-counted extension revenue.
describe("stripe/webhook — the extension lookup's discarded read error", () => {
  it("PINS TODAY'S BEHAVIOUR: the live fork captures extPaymentError and uses it only in a log line 170 lines later", () => {
    // ON RECORD, and this is a DIFFERENT site from the one already pinned in
    // integrations/stripe/webhook.test.ts:1309. That pin and its watchdog are
    // both anchored on the variable name `existingPayment` and on a regex
    // /error:\s*\w*[Ee]rror/ over a 200-character window — which THIS site
    // satisfies while still being wrong, because capturing the error is not the
    // same as acting on it. The proposed fix there would leave this instance in
    // place. stripe-webhook-live/index.ts:921, :934, :1098.
    const s = src("stripe-webhook-live");
    const uses = [...s.matchAll(/\bextPaymentError\b/g)].map((m) => m.index!);
    expect(uses.length, "stripe-webhook-live no longer names extPaymentError twice").toBe(2);

    const declaredAt = uses[0];
    const loggedAt = uses[1];
    const healAt = s.indexOf("if (!extensionPayment) {");

    expect(healAt).toBeGreaterThan(declaredAt);
    // The only other mention is BELOW the self-heal, in a console.error — so the
    // insert is reachable with extPaymentError non-null.
    expect(loggedAt).toBeGreaterThan(healAt);
    expect(s.slice(loggedAt - 120, loggedAt)).toContain("console.error");

    // Nothing between the declaration and the self-heal branches on it.
    const between = s.slice(declaredAt, healAt);
    expect(between).not.toContain("if (extPaymentError");
    expect(between).not.toContain("extPaymentError)");
  });

  it("PINS TODAY'S BEHAVIOUR: the branch it guards ends in an INSERT, not a re-read", () => {
    const s = src("stripe-webhook-live");
    const at = s.indexOf("if (!extensionPayment) {");
    const block = s.slice(at, at + 2200);
    expect(block).toContain('.from("payments")');
    expect(block).toContain(".insert({");
    expect(block).toContain('booking_source: "auto_extend",');
  });

  it.fails("the extension self-heal refuses to insert when its lookup returned an error rather than an empty result", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook-live/index.ts:934
    // is fixed.
    //
    // The fix: `if (extPaymentError) return 500` (Stripe will redeliver) before
    // the `if (!extensionPayment)` branch is even reached. "I could not read the
    // row" and "there is no row" must not take the same branch when one of them
    // ends in an INSERT.
    const s = src("stripe-webhook-live");
    const decl = "let { data: extensionPayment, error: extPaymentError }";
    const healAt = s.indexOf("if (!extensionPayment) {");
    // Start AFTER the declaration itself — it names extPaymentError, and counting
    // that mention would make this watchdog pass on the declaration alone.
    const between = s.slice(s.indexOf(decl) + decl.length, healAt);
    expect(
      /\bextPaymentError\b/.test(between),
      "the live fork still reaches its self-heal INSERT with an unexamined read error, so a " +
        "transient blip creates a SECOND extension payments row and allocates it.",
    ).toBe(true);
  });
});

// ===========================================================================
// F. AN EVENT DROPPED ON THE FLOOR, RECORDED AS 'handled'.
// ===========================================================================

// @usecase Once the delivery-health dashboard exists, a silently discarded
// dispute counts as a successful handle, identically to a settled payment. The
// alert built on this data cannot distinguish "we took the money" from "we threw
// away a chargeback notice" — and the distinction already has a name in the
// vocabulary and a working precedent on the Square rail.
describe("stripe/webhook — the outcome recorded for an event nobody handled", () => {
  it("PINS TODAY'S BEHAVIOUR: the success recorder sits after the switch and always says 'handled'", () => {
    // ON RECORD. `default:` logs "Unhandled event type" and breaks; control then
    // falls to a single unconditional recordWebhookDelivery with a literal
    // "handled". stripe-webhook-test/index.ts:1949-1952 (live :2008-2011).
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      const mode = fn.endsWith("-test") ? "test" : "live";
      expect(s).toContain('console.log("Unhandled event type:", event.type);');
      expect(s).toContain(`platform: "stripe", mode: "${mode}", outcome: "handled",`);
      // The word "ignored" appears once in each fork, but only inside a comment
      // ("harmlessly ignored today"). Asserting against blanked source keeps
      // that prose out of the result — see mechanism 1.
      expect(
        s,
        `${fn} now records an "ignored" outcome — check whether this is the fix and drop ` +
          `the .fails marker below.`,
      ).not.toContain("ignored");
      // And it IS there in the raw text, which is why the blanking matters.
      expect(prose(fn)).toContain("harmlessly ignored today");
    }
  });

  it("shows the Square rail choosing between the two outcomes on exactly this distinction", () => {
    // square-webhook/index.ts:1096-1101. Same helper, same table, one ternary.
    expect(src("square-webhook")).toContain('outcome: result.matched ? "handled" : "ignored",');
  });

  it("finds 'ignored' already in the shared vocabulary, documented for exactly this case", () => {
    // _shared/webhook-health.ts:62-66. No migration and no type change needed.
    const helper = readFileSync(
      join(REPO_ROOT, "supabase", "functions", "_shared", "webhook-health.ts"),
      "utf8",
    );
    expect(helper).toContain('| "ignored"');
    expect(helper).toContain("Understood and deliberately not acted on (unknown event type, other tenant)");
  });

  it("proves by execution that 'ignored' round-trips into the row unchanged, so nothing else has to change (Layer 3)", async () => {
    // The helper is plain TypeScript — no Deno globals — so it imports through
    // @fn and runs here. This is the difference between asserting the word is in
    // a union type and showing the recorder would actually store it.
    const rows: Record<string, unknown>[] = [];
    const fake = {
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          rows.push(row);
          return { error: null };
        },
      }),
    };

    await recordWebhookDelivery(fake, {
      platform: "stripe",
      mode: "test",
      outcome: "ignored",
      eventId: "evt_dispute_1",
      eventType: "charge.dispute.created",
      httpStatus: 200,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("ignored");
    expect(rows[0].event_type).toBe("charge.dispute.created");
    expect(rows[0].platform).toBe("stripe");
  });

  it.fails("an event that fell through to default is recorded as ignored rather than handled", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook-test/index.ts:1950
    // (and stripe-webhook-live/index.ts:2009) is fixed.
    //
    // The fix is the Square one, line for line: set a `matched` flag in the
    // switch, default it to false, and write
    // `outcome: matched ? "handled" : "ignored"`.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      expect(
        /outcome:\s*\w+\s*\?\s*"handled"\s*:\s*"ignored"/.test(s),
        `${fn} still records a discarded dispute, a failed refund and every invoice event as ` +
          `"handled", so the health data cannot tell a settlement from a silent drop.`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// G. THE FAILURE RECORD THAT CANNOT BE REPLAYED.
// ===========================================================================

// @usecase Stripe retries roughly fifteen times over three days and then stops.
// After that the only record of what was lost is an event id nobody wrote down:
// the Stripe rail's "failed" record says something threw, not which event, not
// for which tenant, not how long it ran.
describe("stripe/webhook — the failure record, and what it omits", () => {
  it("PINS TODAY'S BEHAVIOUR: the handler_threw record carries no event id, type, tenant or duration", () => {
    // ON RECORD. stripe-webhook-test/index.ts:1969-1972 (live :2027-2031). The
    // catch builds its own client because `supabase` is block-scoped to the try —
    // that part is deliberate and already covered in webhooks/health.test.ts;
    // what is NOT covered is that `event` IS in scope here and is not used.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      const mode = fn.endsWith("-test") ? "test" : "live";
      const at = s.indexOf(`platform: "stripe", mode: "${mode}", outcome: "failed",`);
      expect(at, `${fn} no longer records a failed outcome`).toBeGreaterThan(-1);
      const call = s.slice(at, s.indexOf("});", at));
      expect(call).toContain('failureCode: "handler_threw"');
      expect(
        call,
        `${fn}'s handler_threw record now names the event — check whether this is the fix ` +
          `and drop the .fails marker below.`,
      ).not.toContain("eventId");
      expect(call).not.toContain("eventType");
      expect(call).not.toContain("tenantId");
      expect(call).not.toContain("durationMs");
    }
  });

  it("PINS TODAY'S BEHAVIOUR: no 'accepted' checkpoint is written before dispatch, so a killed invocation records nothing at all", () => {
    // Four recorder calls per fork: two rejected_signature, one handled, one
    // failed. An invocation killed mid-handler — the deposit-hold branch waits
    // on an HTTP call to sync-deposit-hold — is indistinguishable from a
    // delivery that never arrived.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      expect(s).not.toContain('outcome: "accepted"');
      expect([...s.matchAll(/await recordWebhookDelivery\(/g)]).toHaveLength(4);
    }
  });

  it("shows the Square rail naming the event on exactly this path", () => {
    // square-webhook/index.ts:1112-1116 — same helper, same outcome, four more
    // fields. The Stripe forks are missing them, not the helper.
    const s = src("square-webhook");
    const at = s.indexOf('platform: "square", outcome: "failed",');
    expect(at).toBeGreaterThan(-1);
    const call = s.slice(at, s.indexOf("});", at));
    expect(call).toContain("eventId, eventType, failureCode: \"handler_threw\"");
    expect(call).toContain("durationMs");
  });

  it("proves by execution that omitting eventId writes a NULL, not a placeholder (Layer 3)", async () => {
    // So the alerting query genuinely cannot recover the id — it is absent from
    // the row, not merely unhelpful.
    const rows: Record<string, unknown>[] = [];
    const fake = {
      from: () => ({
        insert: async (row: Record<string, unknown>) => {
          rows.push(row);
          return { error: null };
        },
      }),
    };

    // Shaped exactly like the Stripe forks' catch block.
    await recordWebhookDelivery(fake, {
      platform: "stripe",
      mode: "test",
      outcome: "failed",
      httpStatus: 500,
      failureCode: "handler_threw",
    });
    // Shaped exactly like Square's.
    await recordWebhookDelivery(fake, {
      platform: "square",
      outcome: "failed",
      eventId: "evt_sq_1",
      eventType: "payment.updated",
      failureCode: "handler_threw",
      durationMs: 812,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].event_id).toBeNull();
    expect(rows[0].event_type).toBeNull();
    expect(rows[0].duration_ms).toBeNull();
    expect(rows[1].event_id).toBe("evt_sq_1");
    expect(rows[1].event_type).toBe("payment.updated");
    expect(rows[1].duration_ms).toBe(812);
  });

  it.fails("a Stripe delivery that threw AFTER the event was constructed names that event in its failure record", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook-test/index.ts:1969
    // (and stripe-webhook-live/index.ts:2027) is fixed.
    //
    // Scoped to handler_threw ON PURPOSE. A rejected_signature record legitimately
    // has no parsed event, and the health migration deliberately allows a NULL
    // event_id for exactly that reason (webhooks/health.test.ts already covers
    // both). This is the other case: `event` is in scope, it is known, and it is
    // the only thing that makes the delivery replayable.
    for (const fn of MODED_FORKS) {
      const s = src(fn);
      const mode = fn.endsWith("-test") ? "test" : "live";
      const at = s.indexOf(`platform: "stripe", mode: "${mode}", outcome: "failed",`);
      const call = s.slice(at, s.indexOf("});", at));
      expect(
        /eventId/.test(call),
        `${fn}'s handler_threw record still says only that something threw. Once Stripe stops ` +
          `retrying, nothing in the system knows which event was lost.`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// H. THE LEGACY FORK, OPEN AT THE GATEWAY AND SILENT.
// ===========================================================================

// @usecase Three of the four Stripe endpoints record their deliveries and one
// does not — and the silent one is the fork the suite already pins as
// mode-agnostic, keyed on a test secret, and never allocating a rental payment.
// On the dashboard it will read as silent whether it is dead or busy, which is
// the precise failure the health feature was built to remove.
describe("webhooks/health — the Stripe fork that records nothing", () => {
  /**
   * Derived from config.toml, not hand-typed. `webhooks/health.test.ts`
   * enumerates recorders from a hand-written CRITICAL_WEBHOOKS list of five, and
   * `stripe-webhook` is simply not on it — which is why this gap survived. The
   * gateway is the authority on what is reachable.
   */
  const STRIPE_FORKS_OPEN_AT_GATEWAY = [
    ...CONFIG_TOML.matchAll(/\[functions\.(stripe-[a-z-]*webhook[a-z-]*)\]\s*\n\s*verify_jwt\s*=\s*false/g),
  ].map((m) => m[1]);

  it("finds four Stripe webhook forks declared open at the gateway", () => {
    expect([...STRIPE_FORKS_OPEN_AT_GATEWAY].sort()).toEqual([
      "stripe-connect-webhook",
      "stripe-webhook",
      "stripe-webhook-live",
      "stripe-webhook-test",
    ]);
  });

  it("PINS TODAY'S BEHAVIOUR: the legacy fork imports the health recorder nowhere and calls it never", () => {
    // ON RECORD. supabase/functions/stripe-webhook/index.ts — grep for
    // recordWebhookDelivery or webhook-health returns nothing. Its three
    // siblings each carry the import plus four call sites.
    const legacy = prose("stripe-webhook");
    expect(
      legacy,
      "stripe-webhook now records deliveries — check whether this is the fix and drop " +
        "the .fails marker below.",
    ).not.toContain("recordWebhookDelivery");
    expect(legacy).not.toContain("webhook-health");

    for (const fn of ["stripe-webhook-test", "stripe-webhook-live", "stripe-connect-webhook"]) {
      // stripe-connect-webhook is written in single quotes with no semicolon,
      // so match the import rather than one file's spelling of it.
      expect(src(fn)).toMatch(/import \{ recordWebhookDelivery \} from ['"]\.\.\/_shared\/webhook-health\.ts['"]/);
    }
  });

  it("finds the gateway declaration that makes its silence matter", () => {
    // config.toml:35-36. It is reachable by anyone who learns the URL; the only
    // gate is the Stripe signature, and whether that gate is ever tried is
    // exactly what a delivery record would show.
    expect(CONFIG_TOML).toMatch(/\[functions\.stripe-webhook\]\s*\n\s*verify_jwt\s*=\s*false/);
  });

  it.fails("every Stripe fork declared open at the gateway records its deliveries", () => {
    // Remove the .fails marker once supabase/functions/stripe-webhook/index.ts
    // imports and calls recordWebhookDelivery on its terminal paths.
    //
    // Note this is a DIFFERENT property from the watchdog at
    // integrations/stripe/webhook.test.ts:276, which does iterate all four forks
    // but tests them for a processed_stripe_events / stripe_webhook_events REPLAY
    // CLAIM. This one is about the health record. Either fix leaves the other red.
    const silent = STRIPE_FORKS_OPEN_AT_GATEWAY.filter((fn) => !src(fn).includes("recordWebhookDelivery"));
    expect(
      silent,
      `these Stripe endpoints are reachable without a JWT and write no delivery record, so on the ` +
        `health dashboard they are indistinguishable from dead: ${silent.join(", ")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// I. THE RECOVERY CRON'S ROWS ARE NOT THE WEBHOOK'S ROWS.
// ===========================================================================

// @usecase The cron exists precisely for when the webhook misses, so its rows
// must be indistinguishable from the webhook's. Every payment it recovers stays
// verification_status='pending' with real captured money behind it — the exact
// state the GMT incident comment says hides revenue from owner payouts — and the
// portal then offers Approve/Reject on it.
describe("recover-pending-stripe-payments — the auto-approval it never writes", () => {
  const cron = () => src("recover-pending-stripe-payments");

  it("PINS TODAY'S BEHAVIOUR: the Stripe recovery cron never mentions verification_status at all", () => {
    // ON RECORD. recover-pending-stripe-payments/index.ts:117-123 writes exactly
    // five columns: status, capture_status, stripe_payment_intent_id, paid_at,
    // updated_at.
    expect(
      cron(),
      "the Stripe recovery cron now writes verification_status — check whether this is the fix " +
        "and drop the .fails marker below.",
    ).not.toContain("verification_status");
    expect(cron()).toContain("status: 'Completed',");
    expect(cron()).toContain("capture_status: 'captured',");
  });

  it("shows the live webhook writing auto_approved at every completion site, with the incident named beside it", () => {
    // stripe-webhook-live/index.ts:403, 419, 605, 642, 716, 988, 1313, 1348.
    const s = src("stripe-webhook-live");
    expect([...s.matchAll(/verification_status:\s*"auto_approved"/g)]).toHaveLength(8);
    expect(prose("stripe-webhook-live")).toContain("hid ALL");
    expect(prose("stripe-webhook-live")).toContain("GMT incident");
  });

  it("shows the row starting life as 'pending', so nothing flips it if the cron does not", () => {
    // create-checkout-session/index.ts:271 inserts the Pending row with
    // verification_status: 'pending'. The cron is the only other writer on that
    // row's path once the webhook has missed.
    expect(src("create-checkout-session")).toContain("verification_status: 'pending',");
  });

  it("shows the portal treating the resulting row as an actionable approval queue item", () => {
    // apps/portal/src/app/(dashboard)/payments/page.tsx:146-149. All three
    // conditions hold for a cron-recovered row: verification_status 'pending',
    // status 'Completed' (not 'Reversed'), capture_status 'captured' (not
    // 'cancelled'). So captured money sits waiting for a human to approve it.
    const page = readFileSync(
      join(REPO_ROOT, "apps", "portal", "src", "app", "(dashboard)", "payments", "page.tsx"),
      "utf8",
    );
    expect(page).toContain("const isPendingActionable = (p: any) =>");
    expect(page).toContain("p.verification_status === 'pending' &&");
    expect(page).toContain("p.status !== 'Reversed' &&");
    expect(page).toContain("p.capture_status !== 'cancelled';");
    // And the same file states the opposite invariant, in as many words.
    expect(page).toContain('Stripe payments have stripe_payment_intent_id and are "auto_approved"');
  });

  it.fails("the Stripe recovery cron commits a payment with the same verification_status the webhook would have written", () => {
    // Remove the .fails marker once supabase/functions/recover-pending-stripe-payments/index.ts:117-123
    // is fixed.
    //
    // One line: add `verification_status: 'auto_approved'` to the update. Stripe
    // has confirmed the session as paid by the time this runs — there is nothing
    // left for a human to verify, and leaving it 'pending' hides the revenue from
    // owner payouts.
    expect(
      /verification_status:\s*'auto_approved'/.test(cron()),
      "the every-minute recovery cron still parks captured Stripe money in the operator's " +
        "verification queue, where the webhook would have auto-approved it.",
    ).toBe(true);
  });
});

// ===========================================================================
// J. RE-COMMITTING A ROW BY ID ALONE.
// ===========================================================================

// @usecase This job runs every minute against rows up to 24h old while the
// webhook is writing the same rows — that concurrency is the entire premise of
// the file. If the webhook commits and allocates between the SELECT and the
// UPDATE, the cron rewrites paid_at to now, losing the real settlement time, and
// drags a row FIFO had moved to 'Credit', 'Partial' or 'Refunded' back to
// 'Completed', re-firing auto_fifo_on_payment_completed.
describe("recover-pending-stripe-payments — the update with no status fence", () => {
  const cron = () => src("recover-pending-stripe-payments");

  it("PINS TODAY'S BEHAVIOUR: the SELECT fences on status 'Pending' and the UPDATE that follows does not", () => {
    // ON RECORD. Select fence at :52 `.eq('status', 'Pending')`; the commit at
    // :117-123 ends `.eq('id', p.id);` with no status predicate, and a Stripe
    // network round trip (`checkout.sessions.retrieve`, :109) sits between them.
    const s = cron();
    expect(s).toContain(".eq('status', 'Pending')");

    const updateAt = s.indexOf("await supabase.from('payments').update({");
    expect(updateAt, "the recovery cron no longer commits through an inline update").toBeGreaterThan(-1);
    const update = s.slice(updateAt, s.indexOf(";", s.indexOf("}).eq(", updateAt)) + 1);
    expect(update).toContain(".eq('id', p.id)");
    expect(
      update,
      "the recovery cron's commit now carries a status fence — check whether this is the fix " +
        "and drop the .fails marker below.",
    ).not.toContain("status', 'Pending')");

    // And the read it is racing against is a real network call, not a local one.
    const retrieveAt = s.indexOf("stripe.checkout.sessions.retrieve");
    expect(retrieveAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(retrieveAt);
  });

  it("PINS TODAY'S BEHAVIOUR: the Square recovery's own comment claims the Stripe one has this guard, and it does not", () => {
    // recover-pending-square-payments/index.ts:170-174, read WITH comments
    // because the false claim IS the comment. Square's update genuinely fences
    // on `.eq("status", "Pending")`; the sentence describing it as "the same
    // concurrency guard the Stripe recovery uses" is simply untrue, which is how
    // a reader ends up believing the Stripe side is covered.
    const square = prose("recover-pending-square-payments");
    expect(square).toContain("The .is() filters are the same concurrency guard the Stripe recovery");
    expect(src("recover-pending-square-payments")).toContain('.eq("status", "Pending")');
  });

  it.fails("the Stripe recovery cron re-commits only a row that is still the Pending one it selected", () => {
    // Remove the .fails marker once supabase/functions/recover-pending-stripe-payments/index.ts:123
    // is fixed.
    //
    // Postgres offers this for free: add `.eq('status', 'Pending')` to the
    // update, exactly as the Square recovery does, and count a zero-row result as
    // "the webhook got there first" rather than writing a second paid_at over it.
    const s = cron();
    const updateAt = s.indexOf("await supabase.from('payments').update({");
    const update = s.slice(updateAt, s.indexOf(";", s.indexOf("}).eq(", updateAt)) + 1);
    expect(
      /\.eq\('status',\s*'Pending'\)/.test(update),
      "the recovery cron still commits by id alone, so a row the webhook settled and FIFO " +
        "allocated in the last second is dragged back to 'Completed' with a rewritten paid_at.",
    ).toBe(true);
  });
});

// ===========================================================================
// K. 'NET AT STRIPE' FOR MONEY STRIPE NEVER CAPTURED.
// ===========================================================================

// @usecase This is the tool you reach for when a money figure is disputed — its
// own header says "the numbers look right on screen is not the same claim as
// Stripe agrees with us". Measured against pi.amount, an uncaptured pre-auth or
// deposit hold reconciles clean and reports its full nominal as net at Stripe.
describe("audit-stripe-payment — what 'net at Stripe' is measured against", () => {
  const audit = () => src("audit-stripe-payment");

  it("PINS TODAY'S BEHAVIOUR: net_at_stripe is derived from the authorised amount, never from what was captured", () => {
    // ON RECORD. audit-stripe-payment/index.ts:149. The function DOES fetch both
    // `amount_received` and the charge's `captured` flag and reports them in the
    // stripe block — it simply does not use either in the reconciliation block.
    const s = audit();
    expect(s).toContain("net_at_stripe: (pi.amount - stripeRefundedMinor) / 100,");
    expect(s).toContain("amount_received: (pi.amount_received ?? 0) / 100,");
    expect(s).toContain("captured: chargeObj ? chargeObj.captured : null,");

    const reconAt = s.indexOf("reconciliation: {");
    const recon = s.slice(reconAt, s.indexOf("},", s.indexOf("net_at_stripe", reconAt)));
    expect(
      recon,
      "the reconciliation block now consults amount_received or captured — check whether this " +
        "is the fix and drop the .fails marker below.",
    ).not.toContain("amount_received");
    expect(recon).not.toContain("captured");
  });

  it("leaves amount_matches alone, because comparing the row's amount to pi.amount is a fair like-for-like", () => {
    // Deliberately NOT pinned as a defect. payments.amount records the AUTHORISED
    // figure, so `dbAmountMinor === pi.amount` compares two authorisations.
    // audit-stripe-payment/index.ts:118, :145.
    const s = audit();
    expect(s).toContain("const dbAmountMinor = Math.round(Number(p.amount || 0) * 100);");
    expect(s).toContain("amount_matches: dbAmountMinor === pi.amount,");
  });

  it("PINS TODAY'S BEHAVIOUR: orphan mode hardcodes the UAE platform account and an 'own' payment model", () => {
    // audit-stripe-payment/index.ts:36, :39, :40. An orphan check for a legacy
    // UK-platform PaymentIntent is therefore asked of the wrong platform
    // account, and with no tenantSlug the lookup silently falls back to the
    // tenant literally called "test".
    const s = audit();
    expect(s).toContain('.eq("slug", tenantSlug || "test")');
    expect(s).toContain('getStripeClientForRecord({ platform_account: "uae" }, m)');
    expect(s).toContain('getConnectAccountId({ ...(t ?? {}), payment_model: "own" })');
    // Same full-vs-captured confusion in the orphan verdict (:50, :57).
    expect(s).toContain("const held = (pi.amount - refunded) / 100;");
    expect(s).toContain("still_held_at_stripe: held,");
  });

  it("computes what the tool would report for an uncaptured $250 deposit hold (Layer 3)", () => {
    // Hand-derived, nothing copied from program output.
    //
    // The scenario: a manual-capture deposit hold for $250.00 that was NEVER
    // captured. Stripe holds an authorisation; no money has moved.
    //   pi.amount          = 250.00 x 100 = 25000 minor
    //   pi.amount_received = 0            (nothing captured)
    //   refunds            = none         -> stripeRefundedMinor = 0
    //   payments.amount    = 250.00       -> dbAmountMinor = 250.00 x 100 = 25000
    const piAmountMinor = 25_000;
    const piAmountReceivedMinor = 0;
    const stripeRefundedMinor = 0;
    const dbAmountMinor = 25_000;

    // The tool's formula, transcribed from index.ts:149.
    const netAtStripe = (piAmountMinor - stripeRefundedMinor) / 100;
    // 25000 - 0 = 25000;  25000 / 100 = 250.00
    expect(netAtStripe).toBe(250);

    // What is actually settled at Stripe: amount_received, which is zero.
    const actuallyCaptured = (piAmountReceivedMinor - stripeRefundedMinor) / 100;
    // 0 - 0 = 0;  0 / 100 = 0.00
    expect(actuallyCaptured).toBe(0);

    // And the reconciliation reports a clean match while it does so.
    expect(dbAmountMinor === piAmountMinor).toBe(true);

    // The gap the operator is shown, on a screen whose job is settling disputes.
    // 250.00 - 0.00 = 250.00
    expect(netAtStripe - actuallyCaptured).toBe(250);
  });

  it.fails("net_at_stripe reports money Stripe has actually captured, not an authorisation's nominal", () => {
    // Remove the .fails marker once supabase/functions/audit-stripe-payment/index.ts:149
    // is fixed.
    //
    // The fix: derive it from `pi.amount_received` (already fetched, already
    // reported two fields above) — or rename the field to say plainly that it is
    // the authorised nominal. Either is honest; reporting an uncaptured hold's
    // face value as "net at Stripe" in a reconciliation tool is not.
    const s = audit();
    const reconAt = s.indexOf("reconciliation: {");
    const recon = s.slice(reconAt, s.indexOf("},", s.indexOf("net_at_stripe", reconAt)));
    expect(
      /net_at_stripe:.*amount_received/.test(recon),
      "audit-stripe-payment still reports an uncaptured authorisation's full nominal as money " +
        "net at Stripe, on the one screen that is supposed to settle that question.",
    ).toBe(true);
  });
});
