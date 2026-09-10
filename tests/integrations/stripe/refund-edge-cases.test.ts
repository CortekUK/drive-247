// =============================================================================
// integrations/stripe — REFUND AND PARTIAL REFUND, THE EDGE CASES.
//
// The team lead called partial refund "the biggest" and the most edge-case-heavy
// area, and it is: refunds are the only place in the product where money leaves
// the operator's balance on an operator's typed number, and a Stripe refund has
// no undo.
//
// SCOPE. Axis 1 only — the RENTAL operator returning money to THEIR customer.
// Drive247 billing its own tenants is a different axis with its own file
// (tests/integrations/stripe/checkout.test.ts); nothing here reads
// tenant_subscriptions. Extensions, auto-extension, pay-as-you-go and
// installments are parked, so `extensionId` appears below only where it changes
// the KEY a rental-level refund is written under.
//
// WHAT THIS FILE DELIBERATELY DOES NOT RE-ASSERT. Two files already own part of
// this surface and duplicating them would mean two places to update and no extra
// coverage:
//
//   refund.test.ts           the process-refund request contract; the "exceeds
//                            available refundable amount" guard sitting above
//                            stripe.refunds.create; the Extension/extensionId
//                            guard; the four reconciliation response keys and
//                            the `mergedAmount` merge branch.
//   partial-payment.test.ts  amount+category+refundType as the fields a partial
//                            refund stands on; apply-payment's own
//                            allocationOrder with Security Deposit last;
//                            categoryCap being read from amount_applied and
//                            appearing in the three-way Math.min; the
//                            Refunded/Partial Refund epsilon threshold; the
//                            alreadyCountedByStripeBlock double-count guard;
//                            `availableForRefund = totalPaid - totalAlreadyRefunded`.
//
// Everything here is a case those two do not reach: the running balance across
// SUCCESSIVE partials, the cap reaching zero, the settlement order as the
// DATABASE actually ranks it, an uncaptured authorization, an already-exhausted
// PaymentIntent, the refund window, and the seam where the ledger write and the
// processor payout are two separate facts.
//
// THREE LAYERS, the same as the spine and the sibling Stripe files:
//
//   LAYER 1  source-derived, no network, always runs, most of the file. Several
//            cases assert the ORDER of a guard rather than its existence,
//            because a guard below the money is not a guard, it is a log line
//            written after the money has gone.
//   LAYER 3  pure arithmetic. Every figure was derived with a pencil and carries
//            its working in a comment; none was copied out of a program's
//            output, which would assert only that the code agrees with itself.
//            There is no pure module for process-refund's maths (it is inline in
//            a Deno file that imports from https://esm.sh, which no Node loader
//            resolves), so the L3 cases pair a hand-transcribed MODEL of the
//            formula with an L1 pin on the exact source expression the model
//            claims to mirror. If the source expression changes, the pin goes
//            red and the model must be re-derived — the model can never silently
//            drift away from the code.
//   LAYER 2  live HTTP, opt-in, skipped by default through helpers/live-call.ts.
//            Production (hviqoaokxvlancmftwuo) is refused by that helper and
//            nothing here weakens it.
//
// ---------------------------------------------------------------------------
// KNOWN DEFECTS ARE NEVER ASSERTED AS CORRECT.
//
// Where the code is wrong this file carries a PAIR:
//
//   * a PIN, which records the wrong behaviour so its SIZE is on the record;
//   * an `it.fails(...)` next to it, asserting what SHOULD be true.
//
// `it.fails` passes while the bug exists and goes RED the day someone fixes it,
// which forces the fixer to read the pair. A plain test asserting the broken
// shape would go red on the FIX, which is backwards and has already had to be
// undone on this repo five times.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blankComments,
  FUNCTIONS_DIR,
  readEdgeFunctionSource,
  REPO_ROOT,
} from "../../helpers/edge-contract";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";
import { NON_EXISTENT_RENTAL_ID, round2 } from "../../helpers/stripe-live";
import {
  capabilitiesFor,
  SQUARE_CAPABILITIES,
  STRIPE_CAPABILITIES,
} from "@fn/_shared/payments/capabilities.ts";

// ---------------------------------------------------------------------------
// Local readers. Every one of them goes through edge-contract's own primitives
// for the file read and the comment blanking, so prose can never be mistaken
// for code — these functions carry paragraphs of commentary that name the very
// identifiers being asserted on.
// ---------------------------------------------------------------------------

/** An edge function's source, comments blanked, character offsets intact. */
function code(fn: string): string {
  return blankComments(readEdgeFunctionSource(fn));
}

/** A `supabase/functions/_shared/**` module's source, comments blanked. */
function shared(relPath: string): string {
  return blankComments(readFileSync(join(FUNCTIONS_DIR, "_shared", relPath), "utf8"));
}

/** A migration's SQL. Comments blanked for the same reason. */
function migration(file: string): string {
  return blankComments(readFileSync(join(REPO_ROOT, "supabase", "migrations", file), "utf8"));
}

/** Index of a marker, asserted present with a reason a human can act on. */
function at(src: string, marker: string, why: string): number {
  const i = src.indexOf(marker);
  expect(i, `\`${marker}\` is gone from this source. ${why}`).toBeGreaterThan(-1);
  return i;
}

/** Inner text of the balanced `{ ... }` beginning at `openIndex`. */
function balanced(src: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  throw new Error("Unbalanced brace while reading a block");
}

/**
 * The body of the block introduced by `header`, e.g.
 * `blockAfter(src, 'if (stripeUnrefunded <= 0.005) {')`.
 *
 * Read as CODE rather than by matching the comment above it, so rewording a
 * comment cannot quietly change what a case asserts.
 */
function blockAfter(src: string, header: string, why: string): string {
  const i = at(src, header, why);
  return balanced(src, src.indexOf("{", i + header.length - 1));
}

/** The message every pin carries, so a fixer knows a red pin is good news. */
function pinNote(whatToDo: string): string {
  return (
    "\n  PINNED DEFECT — this records BROKEN behaviour so its size is on the record.\n" +
    "  It is NOT a statement that the behaviour is correct. If it just went red, the\n" +
    `  defect was FIXED: ${whatToDo}\n`
  );
}

// ===========================================================================
// LAYER 3 + its anchors — THE RUNNING REFUNDABLE BALANCE.
//
// THE FORMULA, transcribed by hand from supabase/functions/process-refund/index.ts
// :200-204, which is the only arithmetic between an operator's typo and a refund
// of money nobody ever paid:
//
//     totalCharged         = sum(Charge.amount)               for (rental, category)
//     totalRemaining       = sum(Charge.remaining_amount)     for (rental, category)
//     totalPaid            = totalCharged - totalRemaining
//     totalAlreadyRefunded = |sum(Refund.amount)|             for (rental, category)
//     availableForRefund   = totalPaid - totalAlreadyRefunded
//
// and the two refusals it feeds, :215 and :224:
//
//     availableForRefund <= 0        -> 400 "No refundable amount available"
//     refundAmount > availableForRefund -> 400 "... exceeds available refundable amount"
//
// Two things about it that are easy to get wrong and are what the cases below
// exist for:
//
//   1. "Paid" is not a column. It is inferred from how much of the CHARGE is
//      left, which is why a write-off that zeroes remaining_amount reads as a
//      payment (see the settlement-order describe below).
//   2. Refund rows are stored NEGATIVE, so the running total is an absolute
//      value. Drop the Math.abs and every partial refund INCREASES the balance.
// ===========================================================================

/** One category's ledger rows, in the shape the two reads at :181-197 return. */
interface CategoryLedger {
  charges: Array<{ amount: number; remaining_amount: number }>;
  /** Negative, the way process-refund writes them (`amount: -Math.abs(...)`). */
  refunds: Array<{ amount: number }>;
}

/** The model. A hand transcription of index.ts:200-204 — nothing more. */
function refundableBalance(ledger: CategoryLedger) {
  const totalCharged = ledger.charges.reduce((s, c) => s + (c.amount || 0), 0);
  const totalRemaining = ledger.charges.reduce((s, c) => s + (c.remaining_amount || 0), 0);
  const totalPaid = totalCharged - totalRemaining;
  const totalAlreadyRefunded = Math.abs(ledger.refunds.reduce((s, r) => s + (r.amount || 0), 0));
  return { totalPaid, totalAlreadyRefunded, availableForRefund: totalPaid - totalAlreadyRefunded };
}

type Verdict = "accepted" | "refused: nothing paid" | "refused: exceeds balance";

/** The model of the two guards at :215 and :224, in their source order. */
function verdictFor(ledger: CategoryLedger, requested: number): Verdict {
  const { availableForRefund } = refundableBalance(ledger);
  if (availableForRefund <= 0) return "refused: nothing paid";
  if (requested > availableForRefund) return "refused: exceeds balance";
  return "accepted";
}

describe("stripe/refund-edge-cases — what is still refundable, and when the next partial is refused", () => {
  it("anchors the model: the paid portion and the overdraw comparison are still written the way these cases assume", () => {
    // The two source expressions the Layer 3 cases in this describe stand on.
    // Neither is asserted by refund.test.ts (which pins the guard's MESSAGE and
    // its position) nor by partial-payment.test.ts (which pins the
    // availableForRefund subtraction), so this is the anchor, not a duplicate.
    const src = code("process-refund");

    expect(
      src.replace(/\s+/g, " "),
      "process-refund no longer derives the PAID amount as charged-minus-remaining. " +
        "That subtraction is the whole definition of 'paid' on this path — there is no " +
        "paid column — and the hand arithmetic in this describe is transcribed from it.",
    ).toContain("const totalPaid = totalCharged - totalRemaining;");

    expect(
      src.replace(/\s+/g, " "),
      "The overdraw comparison `refundAmount > availableForRefund` has changed shape. " +
        "A `>=` here would refuse the last legitimate refund; dropping it entirely " +
        "refunds money nobody paid.",
    ).toContain("if (refundAmount > availableForRefund)");

    // Refund rows are negative and the running total is their absolute value.
    // Without the Math.abs each partial refund would ADD to the balance.
    expect(
      src.replace(/\s+/g, " "),
      "The Refund ledger row is no longer written as a negative amount, or the " +
        "already-refunded total no longer takes its absolute value. Those two have to " +
        "agree or every partial refund makes MORE money refundable.",
    ).toContain("amount: -Math.abs(movedAmount)");
  });

  it("reads a fully paid category as fully refundable and an unpaid one as not refundable at all", () => {
    // Rental charged 300.00, nothing left owing -> 300.00 - 0.00 = 300.00 paid.
    const fullyPaid = refundableBalance({
      charges: [{ amount: 300.0, remaining_amount: 0.0 }],
      refunds: [],
    });
    expect(fullyPaid.totalPaid).toBe(300.0);
    expect(fullyPaid.availableForRefund).toBe(300.0);

    // Charged 300.00 with 120.00 still owing -> 300.00 - 120.00 = 180.00 paid.
    const halfPaid = refundableBalance({
      charges: [{ amount: 300.0, remaining_amount: 120.0 }],
      refunds: [],
    });
    expect(halfPaid.totalPaid).toBe(180.0);
    expect(halfPaid.availableForRefund).toBe(180.0);

    // Charged 300.00, none of it paid -> 300.00 - 300.00 = 0.00 paid, and the
    // zero-balance guard answers rather than the processor.
    const unpaid: CategoryLedger = {
      charges: [{ amount: 300.0, remaining_amount: 300.0 }],
      refunds: [],
    };
    expect(refundableBalance(unpaid).totalPaid).toBe(0.0);
    expect(verdictFor(unpaid, 1.0)).toBe("refused: nothing paid");
  });

  it("shrinks the balance by each successive partial refund and refuses the one that would overdraw it", () => {
    // THE CASE THE WHOLE LEDGER-DERIVED BALANCE EXISTS FOR: three partials that
    // sum to LESS than the paid total, then one that would exceed the remainder.
    // Each partial must be counted exactly once — count one twice and the
    // customer is stranded short; miss one and the money can go back twice.
    //
    // Paid: 300.00. Refunds recorded as negatives, cumulatively:
    //   after 100.00 ->  |-100.00|              = 100.00  ->  300.00 - 100.00 = 200.00
    //   after  75.00 ->  |-100.00 - 75.00|      = 175.00  ->  300.00 - 175.00 = 125.00
    //   after  50.00 ->  |-100.00 -75.00 -50.00|= 225.00  ->  300.00 - 225.00 =  75.00
    const charges = [{ amount: 300.0, remaining_amount: 0.0 }];
    const running: Array<{ amount: number }> = [];

    const afterFirst = { charges, refunds: [...running, { amount: -100.0 }] };
    running.push({ amount: -100.0 });
    expect(refundableBalance(afterFirst).availableForRefund).toBe(200.0);

    const afterSecond = { charges, refunds: [...running, { amount: -75.0 }] };
    running.push({ amount: -75.0 });
    expect(refundableBalance(afterSecond).totalAlreadyRefunded).toBe(175.0);
    expect(refundableBalance(afterSecond).availableForRefund).toBe(125.0);

    const afterThird = { charges, refunds: [...running, { amount: -50.0 }] };
    running.push({ amount: -50.0 });
    expect(refundableBalance(afterThird).totalAlreadyRefunded).toBe(225.0);
    expect(refundableBalance(afterThird).availableForRefund).toBe(75.0);

    // The three partials sum to exactly what has been refunded, no more:
    // 100.00 + 75.00 + 50.00 = 225.00, and 300.00 - 225.00 = 75.00 is left.
    const spent = { charges, refunds: running };

    // Exactly the remainder is still accepted — the boundary matters, because an
    // off-by-one in the comparison strands the last 75.00 with the operator.
    expect(verdictFor(spent, 75.0)).toBe("accepted");

    // One cent over the remainder is refused. 75.01 > 75.00.
    expect(verdictFor(spent, 75.01)).toBe("refused: exceeds balance");

    // And a fourth refund of the whole original amount — what the portal dialog
    // still offers, because it caps at min(paid, total) with no subtraction of
    // prior refunds (apps/portal/src/components/shared/dialogs/refund-dialog.tsx:77)
    // — is refused by the server. The UI cap is not a safeguard; this is.
    expect(verdictFor(spent, 300.0)).toBe("refused: exceeds balance");
  });

  it("counts the fourth partial as refused only because the first three were each recorded once", () => {
    // The failure mode this guards: a partial refund recorded TWICE. Same three
    // refunds, but the 100.00 double-counted:
    //   |-100.00 -100.00 -75.00 -50.00| = 325.00  ->  300.00 - 325.00 = -25.00
    // A negative balance trips the "nothing paid" guard, so the customer's last
    // legitimate 75.00 becomes unrefundable and the operator is told there is
    // nothing to refund on a category that is 75.00 short.
    const doubleCounted: CategoryLedger = {
      charges: [{ amount: 300.0, remaining_amount: 0.0 }],
      refunds: [{ amount: -100.0 }, { amount: -100.0 }, { amount: -75.0 }, { amount: -50.0 }],
    };
    expect(refundableBalance(doubleCounted).totalAlreadyRefunded).toBe(325.0);
    expect(refundableBalance(doubleCounted).availableForRefund).toBe(-25.0);
    expect(verdictFor(doubleCounted, 75.0)).toBe("refused: nothing paid");
  });

  it("refuses a zero-balance category with its own message rather than letting the processor answer", () => {
    // The two refusals are distinguishable on purpose: "nothing to refund" and
    // "the processor said no" are different operator actions. This one also has
    // to sit above the reads that would otherwise leak the rental's totals.
    const src = code("process-refund");
    const zeroGuard = at(
      src,
      "No refundable amount available",
      "A category with nothing paid would now fall through to the processor, which " +
        "answers with an opaque error instead of our own arithmetic.",
    );
    const overdrawGuard = at(src, "exceeds available refundable amount", "See refund.test.ts.");

    // Source order: zero-balance first, then the overdraw comparison. Reversed,
    // an unpaid category with a negative balance would report "exceeds" and quote
    // a negative number at the operator.
    expect(
      zeroGuard < overdrawGuard,
      "The zero-balance guard has moved BELOW the overdraw comparison. A category with " +
        "nothing paid would then be refused with 'exceeds available refundable amount " +
        "(-25.00)', which reads as an arithmetic bug rather than as 'nothing was paid'.",
    ).toBe(true);
  });

  it("refuses an overdraw before a Stripe client is even constructed, not merely before the refund call", () => {
    // refund.test.ts already pins guard < stripe.refunds.create. This is the
    // stronger claim and the one the team lead asked for: the refusal happens
    // before ANY Stripe client exists, so there is nothing in scope that could
    // have moved money — not the refund call, not the PaymentIntent retrieve
    // that decides how much headroom to use.
    const src = code("process-refund");
    const guard = at(src, "exceeds available refundable amount", "See refund.test.ts.");
    const clientBuilt = at(
      src,
      "getStripeClientForRecord(",
      "process-refund no longer resolves its Stripe client from the payment RECORD. " +
        "That is what keeps the refund on the account the charge was taken on.",
    );
    const retrieve = at(src, "paymentIntents.retrieve(", "process-refund no longer reads Stripe's own figures.");

    expect(
      guard < clientBuilt && guard < retrieve,
      "The overdraw guard has moved below the Stripe client construction.\n" +
        `  guard@${guard}  client@${clientBuilt}  retrieve@${retrieve}\n` +
        "  Nothing can be un-refunded, so ordering IS the safety property here.",
    ).toBe(true);
  });

  it("treats refundType as a label: a 'full' refund is still exactly the amount the operator typed", () => {
    // Worth pinning because the name misleads, and the sibling function disagrees
    // (see the cancellation describe): in process-refund `refundType` NEVER
    // reaches any arithmetic. It is echoed into refundResult, the response and
    // the customer's email, and that is all. So "full" does not mean "everything
    // that is refundable" — the amount is always the request, always clamped by
    // the same three-way minimum, and a full refund with a wrong amount is just
    // a partial refund with a misleading label.
    const src = code("process-refund");

    const arithmeticUses = [...src.matchAll(/refundType/g)].filter((m) => {
      const around = src.slice(Math.max(0, m.index! - 60), m.index! + 60);
      return /refundType\s*===\s*["'](full|partial)["']/.test(around);
    });
    expect(
      arithmeticUses.length,
      "process-refund now branches on refundType. It never did: the amount comes from " +
        "refundAmount alone, which is why the required-field check refuses a missing or " +
        "non-positive amount for BOTH types. A new branch here means 'full' has started " +
        "to mean something, and every case in this file that assumes it does not must be " +
        "re-read.",
    ).toBe(0);

    // The one check that applies to both types, and the reason a full refund of
    // 0 is impossible rather than silently becoming "everything".
    expect(
      src.replace(/\s+/g, " "),
      "process-refund no longer refuses a missing or non-positive refundAmount. A 0 " +
        "typed into the operator's field would then reach the clamp as a zero-amount " +
        "refund, and a negative one as a credit.",
    ).toContain("if (!rentalId || !reason || !refundAmount || refundAmount <= 0)");
  });
});

// ===========================================================================
// THE CATEGORY CAP — the second layer, and the one that makes a partial refund
// of a MIXED payment hard.
//
// One checkout PaymentIntent routinely settles Rental + Tax + Security Deposit
// together (index.ts:375-383 says 224 such payments already exist), so "what
// this PI has left" is NOT "what it put into THIS category". The clamp at :494
// is three-way:
//
//     stripeRefundAmount = min(refundAmount, stripeUnrefunded, categoryCap)
//     categoryCap        = max(0, appliedToCategory - payments.refund_amount)   (:422)
//                        = +Infinity when the applications cannot account for it
//
// partial-payment.test.ts pins that the clamp and `amount_applied` are still
// written down. What it does not do — and what the arithmetic below is for — is
// work out what the cap EVALUATES to on the second refund of a mixed payment.
// ===========================================================================

/** Hand transcription of index.ts:388-429. Infinity is the documented default. */
function categoryCapFor(appliedToCategory: number, paymentRefundAmount: number): number {
  if (!(appliedToCategory > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(0, appliedToCategory - paymentRefundAmount);
}

/** Hand transcription of the three-way clamp at index.ts:480-496. */
function providerRefundAmount(args: {
  requested: number;
  intentAmount: number;
  intentRefunded: number;
  appliedToCategory: number;
  paymentRefundAmount: number;
}) {
  const stripeUnrefunded = args.intentAmount - args.intentRefunded;
  const cap = categoryCapFor(args.appliedToCategory, args.paymentRefundAmount);
  const moved = Math.min(args.requested, stripeUnrefunded, cap);
  return {
    stripeUnrefunded,
    categoryCap: cap,
    moved,
    // :740 — rounded to the cent, and deliberately NOT recorded in the ledger.
    unrecordedRemainder: Math.round((args.requested - moved) * 100) / 100,
  };
}

describe("stripe/refund-edge-cases — a partial refund of a payment that settled several categories", () => {
  it("anchors the cap: the subtraction still uses the payment's own cross-category refund total", () => {
    const src = code("process-refund");
    expect(
      src.replace(/\s+/g, " "),
      "The categoryCap subtraction has changed shape. The Layer 3 arithmetic below is " +
        "transcribed from it, including the deliberate Math.max(0, ...) floor.",
    ).toContain("categoryCap = Math.max(0, appliedToCategory - Number((payment as any).refund_amount || 0))");

    // The documented default. A cap that defaulted to 0 instead of Infinity would
    // refuse every legacy refund whose payment_applications rows predate the cap.
    expect(
      src.replace(/\s+/g, " "),
      "categoryCap no longer defaults to +Infinity. Legacy rows and NULL " +
        "amount_applied are common, and a 0 default silently under-refunds them all.",
    ).toContain("let categoryCap = Number.POSITIVE_INFINITY");
  });

  it("lets a deposit refund take only what the payment put into the deposit, never what paid the rental", () => {
    // A 100.00 checkout PaymentIntent, allocated by apply-payment's FIFO as
    // Rental 60.00 + Security Deposit 40.00 (deposit last — see the next
    // describe). Nothing refunded yet.
    //
    // Refund the whole deposit, 40.00:
    //   stripeUnrefunded = 100.00 - 0.00 = 100.00
    //   categoryCap      = max(0, 40.00 - 0.00) = 40.00
    //   moved            = min(40.00, 100.00, 40.00) = 40.00
    const deposit = providerRefundAmount({
      requested: 40.0,
      intentAmount: 100.0,
      intentRefunded: 0.0,
      appliedToCategory: 40.0,
      paymentRefundAmount: 0.0,
    });
    expect(deposit.moved).toBe(40.0);
    expect(deposit.unrecordedRemainder).toBe(0.0);

    // And an operator asking for 70.00 of "deposit" on that same payment gets
    // 40.00, because the other 30.00 of headroom paid the rental:
    //   moved = min(70.00, 100.00, 40.00) = 40.00, remainder 70.00 - 40.00 = 30.00
    const overreach = providerRefundAmount({
      requested: 70.0,
      intentAmount: 100.0,
      intentRefunded: 0.0,
      appliedToCategory: 40.0,
      paymentRefundAmount: 0.0,
    });
    expect(overreach.moved).toBe(40.0);
    expect(overreach.unrecordedRemainder).toBe(30.0);
  });

  it("records only what moved, and leaves the shortfall refundable instead of marking it settled", () => {
    // A 100.00 PaymentIntent with 70.00 already refunded, and the operator asks
    // for 50.00 of a category the payment applied 100.00 to:
    //   stripeUnrefunded = 100.00 - 70.00 = 30.00
    //   categoryCap      = max(0, 100.00 - 70.00) = 30.00
    //   moved            = min(50.00, 30.00, 30.00) = 30.00
    //   remainder        = 50.00 - 30.00 = 20.00
    // The 20.00 is deliberately NOT written to the ledger (:918-926): recording
    // it would mark the category settled and permanently block the retry, which
    // is exactly how a customer ends up short against a clean-looking ledger.
    const short = providerRefundAmount({
      requested: 50.0,
      intentAmount: 100.0,
      intentRefunded: 70.0,
      appliedToCategory: 100.0,
      paymentRefundAmount: 70.0,
    });
    expect(short.moved).toBe(30.0);
    expect(short.unrecordedRemainder).toBe(20.0);

    const src = code("process-refund");
    expect(
      src.replace(/\s+/g, " "),
      "The ledger no longer records the MOVED amount. Recording the requested amount " +
        "on a short refund marks money refunded that is still in the Stripe balance.",
    ).toContain("const movedAmount = actualStripeRefunded > 0 ? actualStripeRefunded : refundAmount");
    expect(
      src,
      "The shortfall is no longer declared to the caller. A silent short refund is " +
        "indistinguishable from a complete one at the call site.",
    ).toContain("shortfallWarning");
  });

  it("today allocates the REQUESTED amount across the contributing payments while recording only what MOVED", () => {
    // PIN — the shortfall promise and the payment rows disagree.
    //
    // The ledger records movedAmount (30.00 in the case above) and the response
    // promises the other 20.00 "has NOT been refunded and has NOT been recorded,
    // so it is still owed and still refundable" (:925). But the payment-side
    // allocation loop starts from the REQUEST:
    //     let remainingToAllocate = refundAmount;          (:656)
    // so the un-moved 20.00 is added to some other contributing payment's
    // refund_amount — and payments.refund_amount is exactly what the categoryCap
    // above subtracts. 20.00 of headroom disappears from the retry the response
    // just promised, and a payment can even flip to status 'Refunded' on money
    // that never moved.
    const src = code("process-refund");
    const allocationInit = at(src, "let remainingToAllocate = refundAmount;", "The allocation loop is gone.");
    const movedComputed = at(src, "const movedAmount =", "movedAmount is gone.");

    expect(
      allocationInit < movedComputed,
      pinNote(
        "the allocation loop now distributes what actually moved. Delete this pin and " +
          "drop `.fails` from the case below.",
      ) +
        "  The allocation loop no longer runs before movedAmount is computed, which is " +
        "the ordering that makes this defect possible.",
    ).toBe(true);
  });

  it.fails("should distribute what actually moved across the payments, not what was requested", () => {
    // Remove the `.fails` marker once process-refund/index.ts:654-679 allocates
    // movedAmount. That needs movedAmount (:739) computed above the loop.
    const src = code("process-refund");
    expect(src).toContain("let remainingToAllocate = movedAmount;");
  });

  it("today clamps a legitimate deposit refund to zero on a mixed payment and then asks the processor for zero", () => {
    // PIN — the sharpest edge in the partial-refund maths.
    //
    // Same 100.00 PaymentIntent, Rental 60.00 + Deposit 40.00. Refund the rental
    // first, in full:
    //   moved -> 60.00, and payments.refund_amount becomes 60.00 (:519-520)
    // Now refund the deposit, 40.00. availableForRefund passes — the DEPOSIT
    // category has 40.00 paid and nothing refunded — but:
    //   stripeUnrefunded = 100.00 - 60.00 = 40.00
    //   categoryCap      = max(0, 40.00 - 60.00) = 0.00      <-- refund_amount
    //                                                            spans categories
    //   moved            = min(40.00, 40.00, 0.00) = 0.00
    // and :500 sends `amount: Math.round(0.00 * 100)` = 0 to stripe.refunds.create
    // with no zero check between the clamp and the call. The operator's genuine
    // 40.00 deposit refund is now permanently behind a processor error, while
    // the comment at :419-421 promises "the operator can refund again".
    const cap = categoryCapFor(40.0, 60.0);
    expect(cap).toBe(0.0);

    const zeroed = providerRefundAmount({
      requested: 40.0,
      intentAmount: 100.0,
      intentRefunded: 60.0,
      appliedToCategory: 40.0,
      paymentRefundAmount: 60.0,
    });
    expect(zeroed.moved).toBe(0.0);
    // The whole 40.00 lands in the "not refunded, not recorded" bucket.
    expect(zeroed.unrecordedRemainder).toBe(40.0);

    // And nothing stands between that 0.00 and the processor.
    const src = code("process-refund");
    const clamp = at(src, "const stripeRefundAmount = Math.min(", "The three-way clamp is gone.");
    const create = at(src, "stripe.refunds.create(", "The refund call is gone.");
    const between = src.slice(clamp, create);
    expect(
      /stripeRefundAmount\s*<=?\s*0/.test(between),
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  A zero/epsilon check now sits between the clamp and stripe.refunds.create.",
    ).toBe(false);
    expect(
      between,
      "The amount sent to the processor is no longer the clamped figure in minor units; " +
        "re-derive this pin against whatever replaced it.",
    ).toContain("amount: Math.round(stripeRefundAmount * 100)");
  });

  it.fails("should refuse or record ledger-only when the clamp leaves nothing to send the processor", () => {
    // Remove the `.fails` marker once process-refund/index.ts:494-505 refuses to
    // call the processor with a non-positive amount. Either fix is fine — refuse
    // with our own arithmetic, or take the ledger-only branch the function
    // already has at :484-488 — and both put a check on this stretch of code.
    const src = code("process-refund");
    const clamp = src.indexOf("const stripeRefundAmount = Math.min(");
    const create = src.indexOf("stripe.refunds.create(");
    expect(src.slice(clamp, create)).toMatch(/stripeRefundAmount\s*<=?\s*0/);
  });
});

// ===========================================================================
// THE CATEGORY SETTLEMENT ORDER.
//
// A CLAIM FROM THE BRIEF, CHECKED AND FOUND WRONG. The instruction was to verify
// the deposit-settles-last rule against supabase/functions/_shared/payments/refund.ts.
// It is not there and cannot be: that file is the Square dispatch seam. It reads
// the payment row's provider, consults ONE capability, resolves the tenant's
// Square mode and mints an idempotency identity (refund.ts:53-94). It contains no
// category, no ordering and no ledger read at all. The order lives in exactly two
// places — apply-payment's TypeScript allocationOrder (asserted by
// partial-payment.test.ts) and the database's own payment_apply_fifo_v2 — and
// those two DISAGREE, which is what the cases below are about.
// ===========================================================================
/**
 * The categories `payment_apply_fifo_v2` ranks, read out of its cat_order CTE.
 *
 * The first row carries the column aliases (`'Rental'::text AS cat, 1 AS pri`)
 * and the rest are bare tuples (`'Tax', 2`), so both spellings are handled here
 * rather than in each case.
 */
function rankedCategories(sql: string): string[] {
  return [...sql.matchAll(/SELECT\s+'([^']+)'(?:::text)?(?:\s+AS\s+cat)?\s*,\s*\d+/g)].map((m) => m[1]);
}

describe("stripe/refund-edge-cases — where the settlement order actually lives", () => {
  it("is not decided in the provider refund seam, which knows nothing about categories", () => {
    const seam = shared("payments/refund.ts");

    // Routing is on the payment ROW, not the tenant's current provider: a refund
    // must go back on the rail the charge was taken on.
    expect(
      seam.replace(/\s+/g, " "),
      "The refund seam no longer routes on the payment record's own provider. A tenant " +
        "who switched processors could then have yesterday's charge refunded on the " +
        "wrong rail — or not at all.",
    ).toContain('const recordProvider = spec.paymentRecord.payment_provider;');

    // And it holds no opinion about categories or the ledger. If it ever grows
    // one, the "order lives in two places" reasoning in this file is out of date.
    for (const foreign of ["Security Deposit", "ledger_entries", "category"]) {
      expect(
        seam,
        `The provider refund seam now mentions \`${foreign}\`. It used to be a pure ` +
          "dispatch seam, which is why the settlement order is asserted against " +
          "apply-payment and payment_apply_fifo_v2 instead. Re-read this file's " +
          "settlement-order cases before trusting them.",
      ).not.toContain(foreign);
    }
  });

  it("today leaves Security Deposit out of the database's FIFO ranking entirely, so a paid deposit reads as unpaid", () => {
    // PIN — and this one is why a deposit refund can be refused outright.
    //
    // ledger_entries.category allows 22 values. payment_apply_fifo_v2 ranks 13,
    // and joins with an INNER JOIN — so a charge in an unranked category is
    // DROPPED, never has its remaining_amount reduced, and therefore reads as
    // totalPaid = 0 to process-refund's balance (index.ts:200-204). The customer
    // paid; the refund is refused with "No refundable amount available".
    //
    // apply-payment's TypeScript list says the opposite in its own comment —
    // "LAST, mirroring payment_apply_fifo_v2's priority 14" (index.ts:493-496) —
    // and there is no priority 14.
    const fifo = migration("20260603120000_fifo_v2_generic_pays_extension.sql");
    const check = migration("20260503090449_add_unlimited_mileage_upgrade.sql");

    const ranked = rankedCategories(fifo);
    expect(
      ranked.length,
      "Could not read cat_order out of the FIFO migration. This pin is worthless if the " +
        "list cannot be parsed — re-derive it rather than deleting the case.",
    ).toBeGreaterThan(5);

    const allowed = [...(/ledger_entries_category_check[\s\S]*?CHECK \(category = ANY \(ARRAY\[([\s\S]*?)\]\)\)/.exec(check)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(allowed, "Could not read the ledger category CHECK list.").toContain("Security Deposit");

    // The inner join is what turns "unranked" into "never settled".
    expect(
      fifo.replace(/\s+/g, " "),
      "payment_apply_fifo_v2 no longer INNER JOINs cat_order. If it now outer-joins, an " +
        "unranked category is no longer dropped and this defect is gone — re-read this " +
        "pin before trusting it.",
    ).toContain("JOIN cat_order co ON co.cat = le.category");

    expect(
      ranked,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  Security Deposit is now ranked by the FIFO engine.\n" +
        `  ranked (${ranked.length}): ${ranked.join(", ")}`,
    ).not.toContain("Security Deposit");

    // The same divergence, spelled differently: apply-payment allocates to
    // 'Fine' (singular) while cat_order ranks 'Fines'. Both are allowed
    // categories, and only one of them can ever be settled by the engine.
    expect(allowed).toContain("Fine");
    expect(allowed).toContain("Fines");
    expect(ranked).toContain("Fines");
    expect(
      ranked,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  'Fine' is now ranked too.",
    ).not.toContain("Fine");
  });

  it.fails("should rank every category a customer can actually pay, so a paid charge stays refundable", () => {
    // Remove the `.fails` marker once payment_apply_fifo_v2's cat_order covers
    // these. Deliberately not "all 22": 'Adjustment' and the two 'Initial Fees'
    // spellings are book-keeping rows, and ranking them is a separate decision.
    // These five are money a customer is genuinely charged and can genuinely ask
    // back — the security deposit above all, since it is refundable by definition.
    const ranked = rankedCategories(migration("20260603120000_fifo_v2_generic_pays_extension.sql"));
    for (const category of ["Security Deposit", "Fine", "Excess Mileage", "Unlimited Mileage", "Supercharger"]) {
      expect(ranked).toContain(category);
    }
  });

  it("keeps the ledger's uniqueness key and the refund merge lookup keyed the same way", () => {
    // Two refunds of the same category on the same day collide on
    // ux_rental_charge_unique, so process-refund merges rather than inserting.
    // The index keys on COALESCE(extension_id, ''), so the LOOKUP has to
    // discriminate the extension slot too — otherwise it either merges into the
    // wrong row or maybeSingle() errors on two matches, and the refund looks
    // failed AFTER the processor has already paid.
    const index = migration("20260418140000_ledger_unique_include_extension.sql");
    for (const column of ["rental_id", "due_date", "type", "category", "COALESCE(extension_id::text, '')"]) {
      expect(
        index.replace(/\s+/g, " "),
        `ux_rental_charge_unique no longer keys on ${column}. Every same-day merge lookup ` +
          "in the refund functions is written to be the inverse of THIS key.",
      ).toContain(column);
    }

    const src = code("process-refund");
    expect(
      src.replace(/\s+/g, " "),
      "process-refund's merge lookup no longer discriminates a rental-level refund row " +
        "from an extension's row. It cannot then be the inverse of the unique index.",
    ).toContain('existingQuery = existingQuery.is("extension_id", null)');
  });
});

// ===========================================================================
// REFUNDING AN AUTHORIZATION THAT WAS NEVER CAPTURED.
//
// This is not a refund at all — the money was never taken, so returning it means
// CANCELLING the authorization. Stripe rejects `refunds.create` on a
// `requires_capture` PaymentIntent outright, and the two functions handle it
// differently: cancel-rental-refund cancels the hold (correct), process-refund
// refuses (correct) and then reports success (not correct).
// ===========================================================================
describe("stripe/refund-edge-cases — an uncaptured authorization is a void, not a refund", () => {
  it("refuses to refund a pre-authorization and writes no ledger row for it", () => {
    const src = code("process-refund");

    const branch = blockAfter(
      src,
      'if (paymentIntent.status === "requires_capture") {',
      "process-refund no longer recognises an uncaptured authorization. Stripe rejects a " +
        "refund on one, so without this branch the operator gets a raw processor error.",
    );
    expect(branch).toContain('type: "error"');
    expect(
      branch,
      "The capture-first instruction is gone. 'Capture the payment first' is the one " +
        "sentence that tells the operator what to actually do.",
    ).toContain("capture first");
    expect(
      branch,
      "The uncaptured-authorization branch now calls the processor. There is nothing to " +
        "refund on a hold; the money has not moved yet.",
    ).not.toContain("refunds.create");

    // `type: "error"` is what suppresses all three write paths.
    expect(
      src.replace(/\s+/g, " "),
      "The ledger write is no longer suppressed for a refusal, so a refund that never " +
        "happened would be recorded as one — and the category would read as settled.",
    ).toContain('const shouldCreateLedger = refundResult && refundResult.type !== "error";');
    expect(
      src.replace(/\s+/g, " "),
      "The payment-status update loop no longer skips a refusal; a refused refund would " +
        "flip the payment to 'Partial Refund' with money still held.",
    ).toContain('if (refundResult?.type !== "error") {');
    expect(
      src.replace(/\s+/g, " "),
      "The customer notification no longer skips a refusal, so a refund that was refused " +
        "would email the customer that their money is on the way.",
    ).toContain('if (refundResult && (refundResult as { type?: string }).type !== "error") {');
  });

  it("today tells the operator that the refusal SUCCEEDED, with the full request as the recorded amount", () => {
    // PIN — the refusal above is correct and its report is not.
    //
    // On the requires_capture path: no ledger row is attempted, so
    // ledgerRecordFailed stays null; the response then computes
    //     ledgerRecorded: !ledgerRecordFailed        -> TRUE
    //     requiresReconciliation: !!ledgerRecordFailed -> false
    // over `success: true` written as a literal, and
    //     recordedAmount: movedAmount, movedAmount = actualStripeRefunded > 0
    //                                     ? actualStripeRefunded : refundAmount
    // where actualStripeRefunded is still 0 — so recordedAmount is the FULL
    // amount requested. The portal dialog reads result?.message and otherwise
    // says "<amount> has been refunded"
    // (apps/portal/src/components/shared/dialogs/refund-dialog.tsx:255), so the
    // operator is told a refused refund went through, for the full amount, and
    // that it was recorded.
    const src = code("process-refund");

    const anchor = at(src, "ledgerRecorded: !ledgerRecordFailed", "The reconciliation flag is gone.");
    const jsonStart = src.lastIndexOf("JSON.stringify({", anchor);
    const response = balanced(src, src.indexOf("{", jsonStart));

    expect(
      response,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  `success` is no longer an unconditional literal in the 200 response.",
    ).toContain("success: true,");
    expect(response).toContain("recordedAmount: movedAmount");

    // The declaration initialises it to null (`let ledgerRecordFailed: string |
    // null = null;`), and there is exactly ONE assignment, inside the ledger
    // block — so on a path that never attempts a ledger write it cannot be set,
    // and `!ledgerRecordFailed` reads TRUE.
    const writes = [...src.matchAll(/ledgerRecordFailed\s*=(?!=)/g)];
    expect(
      writes.length,
      "ledgerRecordFailed is now assigned somewhere other than the post-payout ledger " +
        "failure. Re-derive this pin: the whole point is that it stays null on every " +
        "refused path, which is what makes ledgerRecorded read TRUE.",
    ).toBe(1);
    const ledgerBlockStart = at(src, "if (shouldCreateLedger) {", "The ledger block is gone.");
    expect(writes[0].index!).toBeGreaterThan(ledgerBlockStart);
  });

  it.fails("should report a refused refund as a failure, with nothing recorded", () => {
    // Remove the `.fails` marker once process-refund/index.ts:907-948 derives
    // `success` from what actually happened. A refusal (uncaptured
    // authorization, non-refundable PaymentIntent state) or a provider failure
    // must reach the caller as success:false or a 4xx, with ledgerRecorded:false
    // and recordedAmount 0.
    const src = code("process-refund");
    const anchor = src.indexOf("ledgerRecorded: !ledgerRecordFailed");
    const response = balanced(src, src.indexOf("{", src.lastIndexOf("JSON.stringify({", anchor)));
    expect(response).not.toContain("success: true,");
  });

  it("cancels the hold instead of refunding it when the rental itself is cancelled", () => {
    // The correct handling of the same state, in the sibling function: an
    // authorization is returned by RELEASING it, and the payment is recorded as
    // Cancelled rather than Refunded — capture_status 'cancelled' is one of the
    // four values its CHECK allows, which is why this write is safe here and a
    // refund-shaped one would throw.
    const src = code("cancel-rental-refund");
    const branch = blockAfter(
      src,
      'if (paymentIntent.status === "requires_capture") {',
      "cancel-rental-refund no longer releases an uncaptured hold on cancellation. Asking " +
        "the processor to refund one is rejected, so the customer's money stays held until " +
        "the network expires it.",
    );
    expect(branch).toContain("paymentIntents.cancel(");
    expect(branch).not.toContain("refunds.create");
    expect(branch).toContain('type: "cancelled"');

    // And the row it leaves behind.
    expect(src.replace(/\s+/g, " ")).toContain('paymentUpdate.status = "Cancelled"');
    expect(src.replace(/\s+/g, " ")).toContain('paymentUpdate.capture_status = "cancelled"');
  });
});

// ===========================================================================
// REFUNDING A PAYMENT THE PROCESSOR HAS ALREADY FULLY REFUNDED.
//
// Our own payments.refund_amount drifts — manual refunds, mixed payments,
// earlier failures — so the function asks Stripe how much is left rather than
// trusting the column. That part is right. What happens next is not.
// ===========================================================================
describe("stripe/refund-edge-cases — a PaymentIntent with no headroom left", () => {
  it("decides there is nothing left from Stripe's own figures, retrieved in this request", () => {
    const src = code("process-refund");
    const retrieve = at(src, "paymentIntents.retrieve(", "The in-request retrieve is gone.");
    const decision = at(
      src,
      "if (stripeUnrefunded <= 0.005) {",
      "The exhausted-PaymentIntent branch is gone. Without it a fully refunded payment is " +
        "sent to the processor again and answers with an opaque error.",
    );

    expect(
      retrieve < decision,
      "The exhausted-headroom decision no longer reads figures retrieved from Stripe in " +
        "this request. Deciding it from our own payments.refund_amount is what allowed " +
        "drift-driven double refunds — the retrieve exists for exactly this.",
    ).toBe(true);
    expect(
      src.replace(/\s+/g, " "),
      "stripeUnrefunded is no longer Stripe's amount minus Stripe's amount_refunded.",
    ).toContain("const stripeUnrefunded = stripeAmount - stripeRefunded");
  });

  it("today records NOTHING on that path and still answers success, because its manual-refund fallback is unreachable", () => {
    // PIN — and this is a fresh finding, not the shape the subsystem map claimed.
    //
    // The branch sets a fallback REASON and clears `payment`:
    //     ledgerOnlyFallbackReason = "... is fully refunded ... Recorded as manual refund"
    //     payment = null;
    // The intent is plainly to fall into the manual-refund else at :613-621
    // ("No Stripe payment (or Stripe PI was exhausted) — record as manual
    // refund"). It cannot: that else belongs to the same if/else-if chain this
    // code is already INSIDE — `if (payment?.stripe_payment_intent_id)` was
    // evaluated on entry and clearing the variable afterwards does not re-run it.
    //
    // So refundResult stays null, and:
    //   shouldCreateLedger = refundResult && ...   -> null, falsy -> NO ledger row
    //   the notifier guard `refundResult && ...`   -> skipped -> nobody is told
    //   the 200 response                           -> success:true,
    //                                                 ledgerRecorded:true,
    //                                                 recordedAmount = the full request,
    //                                                 refund: null
    // The operator reads "<category> refund processed successfully" for a refund
    // where no money moved, no ledger row exists and no notification was sent.
    const src = code("process-refund");

    const branch = blockAfter(src, "if (stripeUnrefunded <= 0.005) {", "See the case above.");
    expect(branch).toContain("ledgerOnlyFallbackReason =");
    expect(branch).toContain("payment = null;");
    expect(
      branch,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  The exhausted-PaymentIntent branch now sets a refund outcome, so its ledger " +
        "row and its notification are no longer skipped.",
    ).not.toContain("refundResult");

    // The unreachable fallback, and the proof it is in the same chain: it sits
    // after the Square else-if, which sits after the branch above.
    const stripeChain = at(src, "if (payment?.stripe_payment_intent_id) {", "The Stripe branch is gone.");
    const squareChain = at(src, 'else if (payment?.payment_provider === "square") {', "The Square branch is gone.");
    const manualFallback = at(src, "no Stripe payment to process", "The manual-refund fallback is gone.");
    expect(stripeChain).toBeLessThan(squareChain);
    expect(squareChain).toBeLessThan(manualFallback);

    // And the branch that clears `payment` sits INSIDE the first arm of that
    // chain, which is what makes the clearing pointless: the arm was chosen
    // before it ran. If this ever moves above the chain, the manual fallback
    // becomes reachable and this defect is gone.
    const exhaustedBranch = at(src, "if (stripeUnrefunded <= 0.005) {", "See the case above.");
    expect(
      exhaustedBranch > stripeChain && exhaustedBranch < squareChain,
      "The exhausted-PaymentIntent branch is no longer inside the Stripe arm of the " +
        `if/else-if chain (branch@${exhaustedBranch} stripe@${stripeChain} square@${squareChain}).`,
    ).toBe(true);
  });

  it.fails("should record the ledger-only refund it says it is recording when the processor has nothing left", () => {
    // Remove the `.fails` marker once process-refund/index.ts:484-488 produces a
    // refund outcome. Either fix turns this red, which is the point: set
    // refundResult to the manual/ledger-only outcome so the row and the
    // notification happen, or set it to an error so the caller is told the
    // refund was refused. Doing neither is the one unacceptable option, because
    // the response reports success for a refund that left no trace anywhere.
    const src = code("process-refund");
    expect(blockAfter(src, "if (stripeUnrefunded <= 0.005) {", "See above.")).toContain("refundResult");
  });
});

// ===========================================================================
// THE LEDGER WRITE AND THE PROCESSOR PAYOUT ARE TWO SEPARATE FACTS.
//
// They are two unbatched writes with no transaction between them, so
// "money moved but was not recorded" is a real and permanent outcome. Collapsing
// them into one boolean is what made an operator retry a refund that had already
// paid out and issue a second real one — availableForRefund is derived from
// ledger_entries, the very write that failed, so the retry re-passes validation.
//
// refund.test.ts pins that the four reporting keys still exist. These cases are
// about the BRANCH: which of the two outcomes is retryable, and which is not.
// ===========================================================================
describe("stripe/refund-edge-cases — the payout and the ledger row are reported independently", () => {
  it("keeps a ledger failure with no payout behind it retryable, and one with a payout behind it a reconciliation", () => {
    const src = code("process-refund");
    const split = at(
      src,
      "if (stripeRefundId) {",
      "The retryable/reconcile split is gone. Every ledger failure would then be reported " +
        "the same way, and the safe reading of the ambiguous one — retry — issues a " +
        "second real refund.",
    );
    const decisionOpen = src.indexOf("{", split + "if (stripeRefundId)".length);
    const decision = balanced(src, decisionOpen);

    // Money moved: record the reconciliation task and DO NOT fail the request.
    expect(decision).toContain("ledgerRecordFailed = ledgerError.message");
    expect(
      decision,
      "The money-moved-but-unrecorded path now returns a failure. That is what the " +
        "operator retried, and the retry paid the customer twice.",
    ).not.toContain("status: 500");

    // No payout: a true no-op, so it stays a retryable 500 with success:false.
    // The `else` arm runs from the close of the arm above to the finance-sync
    // enqueue that follows the whole ledger-failure block.
    const decisionClose = decisionOpen + decision.length + 1;
    const enqueueAt = at(src, "if (rental?.tenant_id && !ledgerRecordFailed) {", "The enqueue guard is gone.");
    const noPayout = src.slice(decisionClose, enqueueAt);
    expect(
      noPayout,
      "The no-payout ledger failure no longer answers 500. A true no-op must stay " +
        "retryable, or a ledger-only refund silently does nothing and reports success.",
    ).toContain("status: 500");
    expect(noPayout).toContain("success: false");

    // And the response spells out the instruction, because the operator's instinct
    // is exactly wrong here.
    expect(
      src,
      "The do-NOT-retry warning is gone from the response. It is the only thing between " +
        "a reconciliation task and a second real refund.",
    ).toContain("do NOT retry this refund");
  });

  it("today decides retryability from a Stripe-only handle, so a Square payout whose ledger write failed is offered as retryable", () => {
    // PIN — the same seam, wrong axis.
    //
    // The split above tests `stripeRefundId`, which the Square success branch
    // never sets — deliberately, because the exclusivity CHECK forbids a stripe_*
    // handle on a Square row (:593-594). So a Square refund that DID move money
    // and then lost its ledger row takes the "true no-op" path: 500,
    // success:false, retry encouraged. The retry re-passes validation (the
    // balance is ledger-derived) and the seam mints a FRESH idempotency identity
    // per attempt, so the processor accepts it as a second, distinct refund.
    const src = code("process-refund");
    const squareBranch = blockAfter(
      src,
      'else if (payment?.payment_provider === "square") {',
      "The Square dispatch branch is gone.",
    );
    expect(squareBranch).toContain("square_refund_id");
    expect(
      /stripeRefundId\s*=/.test(squareBranch),
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  The Square branch now sets stripeRefundId, so it no longer takes the retryable " +
        "path — though a stripe_* handle on a Square row is forbidden by " +
        "payments_provider_handle_exclusivity_check, so check what it actually assigns.",
    ).toBe(false);

    // The fresh-identity-per-attempt half, which is what makes the retry a
    // second real refund rather than an idempotent echo.
    expect(
      shared("payments/refund.ts").replace(/\s+/g, " "),
      "The refund seam no longer mints a per-attempt identity. That change would make a " +
        "retry de-duplicate at Square — which fixes this defect and breaks the case the " +
        "identity exists for (two equal-amount partial refunds collapsing into one).",
    ).toContain("spec.refundIdempotencyId ?? crypto.randomUUID()");
  });

  it.fails("should decide retryability from whether the provider moved money, not from which handle column exists", () => {
    // Remove the `.fails` marker once process-refund/index.ts:800-826 branches on
    // "did this request move money" — a provider-neutral fact — rather than on
    // the presence of a Stripe refund id.
    const src = code("process-refund");
    expect(src).not.toContain("if (stripeRefundId) {");
  });

  it("does not ask the accounting queue to credit a ledger row that never landed", () => {
    // enqueue_financial_event raises a Credit Note in Xero/Zoho against the
    // ledger row. Firing it with a null source id credits a customer against an
    // entry that does not exist.
    const src = code("process-refund");
    expect(
      src.replace(/\s+/g, " "),
      "The finance-sync enqueue is no longer guarded by the ledger write's outcome. It " +
        "would raise a Credit Note against a ledger entry that was never written.",
    ).toContain("if (rental?.tenant_id && !ledgerRecordFailed) {");
  });

  it("today finds that row by an exact reference string the same-day merge has already rewritten", () => {
    // PIN — the guard above is right and the lookup beneath it defeats itself.
    //
    // The merge path rewrites the reference to "<existing>; <this refund's
    // reference>" (:770-772). The enqueue then looks the row up by
    //     .eq("reference", refundReference).maybeSingle()
    // which no longer equals the stored value, so p_source_id is null on every
    // SECOND same-day refund of a category — precisely the multi-partial case
    // this file is about. The guard cannot help: ledgerRecordFailed is null,
    // because the merge SUCCEEDED. The same lookup is also not unique across
    // rentals, so maybeSingle() can error on two matches and yield null that way.
    const src = code("process-refund");
    expect(src.replace(/\s+/g, " ")).toContain(
      "const mergedRef = existingRefund.reference ? `${existingRefund.reference}; ${refundReference}` : refundReference;",
    );
    expect(
      src.replace(/\s+/g, " "),
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  The enqueue no longer re-queries the ledger row by its free-text reference.",
    ).toContain('.eq("reference", refundReference)');
    expect(src.replace(/\s+/g, " ")).toContain("p_source_id: refundLedger?.id ?? null");
  });

  it.fails("should pass the id of the row this refund actually wrote to the accounting queue", () => {
    // Remove the `.fails` marker once process-refund/index.ts:828-858 uses the
    // insert's returned id, or existingRefund.id on the merge path, instead of
    // re-querying by reference.
    expect(code("process-refund")).not.toContain('.eq("reference", refundReference)');
  });
});

// ===========================================================================
// A FULL REFUND THROUGH CANCELLATION — the other way money goes back, and the
// place where "full" and "partial" DO change the amount.
// ===========================================================================
describe("stripe/refund-edge-cases — the cancellation path's own idea of full and partial", () => {
  it("today refunds the ENTIRE PaymentIntent for a 'partial' cancellation with no amount, and records nothing at all", () => {
    // PIN — the worst available combination: money out, books silent.
    //
    // cancel-rental-refund requires only rentalId and reason. With
    // refundType 'partial' and refundAmount missing, zero or otherwise falsy:
    //   * `if (refundType === "partial" && refundAmount)` leaves `amount` unset
    //     on the params, and a refund with no amount refunds the FULL remaining
    //     balance of the PaymentIntent;
    //   * the book-keeping then reuses the same falsy value —
    //     refundedTotal = Number(refundAmount) || 0 -> 0.00 — so
    //     `appliedTotal > 0 && refundedTotal > 0` is false and NO ledger Refund
    //     row is written;
    //   * payments.refund_amount has 0.00 added to it (:503-504).
    // The money is gone, the ledger says nothing happened, and the balance still
    // reads fully refundable — so process-refund will hand it back again.
    const src = code("cancel-rental-refund");

    expect(
      src.replace(/\s+/g, " "),
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  The partial branch no longer keys the amount off a truthiness test.",
    ).toContain('if (refundType === "partial" && refundAmount) {');
    expect(
      src.replace(/\s+/g, " "),
      "The required-field check has changed. The point of this pin is that a 'partial' " +
        "refund with no amount passes validation here, unlike process-refund/index.ts:49.",
    ).toContain('if (!rentalId || !reason) {');
    expect(src.replace(/\s+/g, " ")).toContain(
      'const refundedTotal = refundType === "full" ? Number(payment.amount) || 0 : Number(refundAmount) || 0;',
    );
    expect(
      src.replace(/\s+/g, " "),
      "The ledger split's own gate has changed shape; re-derive why a 0.00 refundedTotal " +
        "writes no row.",
    ).toContain("if (appliedTotal > 0 && refundedTotal > 0) {");

    // 0.00 refundedTotal -> the gate is false -> no row. Hand arithmetic, since
    // the falsy value IS the whole defect: Number(undefined) || 0 = 0.00, and
    // 0.00 > 0 is false.
    expect(Number(undefined as unknown as number) || 0).toBe(0);
  });

  it.fails("should refuse a partial cancellation refund with no positive amount, before the processor is called", () => {
    // Remove the `.fails` marker once cancel-rental-refund/index.ts:38 refuses
    // refundType 'partial' without a positive refundAmount, the way
    // process-refund/index.ts:49 does for every type.
    //
    // Asserted as "the function compares refundAmount against zero ABOVE the
    // refund call" rather than as one exact spelling, so any reasonable fix
    // turns this red instead of only the one this comment happens to imagine.
    const src = code("cancel-rental-refund");
    const bound = src.search(/refundAmount\s*<=?\s*0/);
    expect(bound, "cancel-rental-refund still never compares refundAmount to zero.").toBeGreaterThan(-1);
    expect(bound).toBeLessThan(src.indexOf("refunds.create("));
  });

  it("today records payment.amount for a full cancellation refund instead of the amount the processor returned", () => {
    // PIN. The Stripe response is right there — `amount: refund.amount / 100` is
    // read into refundResult — but both writes ignore it and use the payment's
    // original amount. A full refund sends no `amount`, so the processor returns
    // only the PaymentIntent's REMAINING balance; whenever a partial refund was
    // already taken, this over-credits the customer in the ledger and marks the
    // category settled while money is still owed.
    const src = code("cancel-rental-refund");
    expect(src.replace(/\s+/g, " ")).toContain("amount: refund.amount / 100");
    expect(
      src.replace(/\s+/g, " "),
      pinNote("delete this pin and drop `.fails` from the case below.") +
        "  The full-refund path no longer records payment.amount.",
    ).toContain("paymentUpdate.refund_amount = Number(payment.amount) || 0;");
  });

  it.fails("should record what the processor actually returned on a full cancellation refund", () => {
    // Remove the `.fails` marker once cancel-rental-refund/index.ts:495-501 and
    // :541-543 drive both the payment row and the ledger split from
    // refund.amount / 100.
    const src = code("cancel-rental-refund");
    expect(src.replace(/\s+/g, " ")).not.toContain("paymentUpdate.refund_amount = Number(payment.amount) || 0;");
  });

  it("today throws before it can refund anything on a rental with two card payments, because the list is declared after it is filled", () => {
    // PIN — critical, and the ordinary case rather than an edge one: a
    // charged-deposit rental normally has two payments (the function says so
    // itself), so for those tenants cancellation cannot work at all.
    //
    // `unrefundedOtherPayments` is ASSIGNED at :155, inside the payment-lookup
    // else, and `let`-DECLARED at :171, below it. A `let` is hoisted but
    // uninitialised, so the assignment throws "Cannot access
    // 'unrefundedOtherPayments' before initialization", the outer catch answers
    // 500, and nothing downstream runs: the rental is never marked Cancelled,
    // the deposit hold is never released, the Bonzah policies are never
    // cancelled.
    const src = code("cancel-rental-refund");
    const assigned = at(src, "unrefundedOtherPayments = stripePayments.slice(1)", "The multi-payment report is gone.");
    const declared = at(src, "let unrefundedOtherPayments:", "The declaration is gone.");

    expect(
      assigned < declared,
      pinNote("delete this pin and drop `.fails` from the case below.") +
        `  The declaration now precedes the assignment (assign@${assigned} declare@${declared}).`,
    ).toBe(true);

    // And the assignment is genuinely reached on the 2+ payment path.
    expect(src.replace(/\s+/g, " ")).toContain("if (stripePayments && stripePayments.length > 1) {");
  });

  it.fails("should declare unrefundedOtherPayments above the branch that fills it", () => {
    // Remove the `.fails` marker once the `let` at cancel-rental-refund/index.ts:171
    // is moved above the payment-lookup block at :128.
    const src = code("cancel-rental-refund");
    expect(src.indexOf("let unrefundedOtherPayments:")).toBeLessThan(
      src.indexOf("unrefundedOtherPayments = stripePayments.slice(1)"),
    );
  });
});

// ===========================================================================
// THE REFUND WINDOW AND THE PER-PAYMENT REFUND COUNT.
//
// Both are declared as capabilities, in the module whose own binding rule says
// "every behavioural difference between processors lives HERE". The manifest is
// imported and executed for real below — it is one of the few modules under
// supabase/functions with no https:// import — and then the cases check who
// reads it. Nobody does.
// ===========================================================================
describe("stripe/refund-edge-cases — the refund window", () => {
  /** Every function in this family that could enforce a window or a count. */
  const REFUND_FAMILY = [
    "process-refund",
    "schedule-refund",
    "process-scheduled-refund",
    "cancel-rental-refund",
    "reverse-payment",
  ];

  it("declares a 365-day window and a 20-refund ceiling for Square, and no ceiling at all for Stripe", () => {
    // Square's published limits; Stripe's are MAX_SAFE_INTEGER, meaning "no
    // ceiling that matters at our volumes". These are the numbers any
    // enforcement would have to read, so they are asserted for real rather than
    // described.
    expect(SQUARE_CAPABILITIES.refundWindowDays).toBe(365);
    expect(SQUARE_CAPABILITIES.maxPartialRefundsPerPayment).toBe(20);
    expect(SQUARE_CAPABILITIES.refundsSettleAsynchronously).toBe(true);

    expect(STRIPE_CAPABILITIES.refundWindowDays).toBe(Number.MAX_SAFE_INTEGER);
    expect(STRIPE_CAPABILITIES.maxPartialRefundsPerPayment).toBe(Number.MAX_SAFE_INTEGER);
    expect(STRIPE_CAPABILITIES.refundsSettleAsynchronously).toBe(false);

    // The window is a plain day count, so "has it expired" is one subtraction:
    // a charge taken 400 days ago is 400 - 365 = 35 days past Square's window,
    // while the same charge on Stripe is inside it by construction.
    const ageDays = 400;
    expect(ageDays - capabilitiesFor("square").refundWindowDays).toBe(35);
    expect(ageDays > capabilitiesFor("square").refundWindowDays).toBe(true);
    expect(ageDays > capabilitiesFor("stripe").refundWindowDays).toBe(false);
  });

  it("today enforces neither: no refund function looks at a payment's age or at how many refunds it already has", () => {
    // PIN. An exhaustive read of the family: both names appear only in their own
    // declarations. A refund past the window fails at the processor with an
    // opaque error the operator cannot act on, and the 21st partial refund fails
    // at Square AFTER our ledger has been told to expect it.
    const readers = REFUND_FAMILY.filter((fn) => /refundWindowDays|maxPartialRefundsPerPayment/.test(code(fn)));
    expect(
      readers,
      pinNote("delete this pin and drop `.fails` from the two cases below.") +
        `  ${readers.length ? readers.join(", ") + " now read the ceilings." : ""}`,
    ).toEqual([]);

    // Nor is there any age arithmetic in the function that owns the refund
    // dialog: the only mention of created_at is an ordering clause.
    const src = code("process-refund");
    expect(
      [...src.matchAll(/created_at/g)].length,
      pinNote("delete this pin and drop `.fails` from the window case below.") +
        "  process-refund now reads created_at more than once, so it may finally be doing " +
        "age arithmetic.",
    ).toBe(1);
    expect(src).toContain('.order("created_at"');
  });

  it.fails("should refuse a refund past the provider's window locally, before the provider is called", () => {
    // Remove the `.fails` marker once a refund path compares the payment's age
    // against capabilitiesFor(provider).refundWindowDays and refuses with our
    // own message — the same shape as the availableForRefund guard, which is the
    // model for "refuse before the processor, in words the operator can act on".
    const readers = REFUND_FAMILY.filter((fn) => /refundWindowDays/.test(code(fn)));
    expect(readers.length).toBeGreaterThan(0);
  });

  it.fails("should refuse the 21st partial refund on a payment the provider caps at 20", () => {
    // Remove the `.fails` marker once a refund path counts the payment's settled
    // refunds against capabilitiesFor(provider).maxPartialRefundsPerPayment.
    // This is the only per-payment refund-count limit in the system; unenforced,
    // the 21st refund fails at the processor with a ledger row already promised.
    const readers = REFUND_FAMILY.filter((fn) => /maxPartialRefundsPerPayment/.test(code(fn)));
    expect(readers.length).toBeGreaterThan(0);
  });

  it("keeps the one refund capability that IS consulted on the only axis that can switch partials off", () => {
    // supportsPartialRefund is read exactly once, in the seam, and it is the
    // only thing that can disable partial refunds for a provider. It is dead
    // code today — both providers are true — which is precisely why it needs a
    // test: provider #3 with no partial refunds is the case it exists for.
    const seam = shared("payments/refund.ts");
    expect(
      seam.replace(/\s+/g, " "),
      "The partial-refund capability is no longer consulted. A provider that cannot do " +
        "partial refunds would then be sent one and answer with its own error, after our " +
        "side had already decided the refund was going ahead.",
    ).toContain("if (spec.amountCents !== undefined && !caps.supportsPartialRefund) {");
    expect(
      seam,
      "The unsupported case no longer returns a SKIP. A skip is handled:true with no " +
        "error flag, and every caller is written against that shape — an error here would " +
        "be reported to the operator as a completed refund by the branch that follows.",
    ).toContain('skip("provider_no_partial_refund"');
    expect(STRIPE_CAPABILITIES.supportsPartialRefund).toBe(true);
    expect(SQUARE_CAPABILITIES.supportsPartialRefund).toBe(true);
  });
});

// ===========================================================================
// LAYER 2 — live.
//
// ONE CASE, and it is the harmless one. It needs D247_LIVE_TESTS=1 and an anon
// key, moves no money and writes nothing: the required-field check answers it
// before the function reads anything at all, and if that check were ever
// deleted an anon caller is 401'd by the authorization block instead — a second,
// independent barrier.
//
// The money-moving live cases for this surface already exist in
// partial-payment.test.ts (successive partials, the over-balance refusal) and
// refund.test.ts (a full refund), each behind the full ladder up to
// D247_LIVE_ALLOW_MONEY_MOVEMENT=1 and a one-shot fixture rental. Adding more
// spenders of that fixture here would make all of them skip on a complete pass,
// so this file deliberately adds none.
// ===========================================================================
describe("stripe/refund-edge-cases — live (Layer 2)", () => {
  it("live: a refund of zero is refused outright rather than being treated as a full refund", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip(
        "D247_LIVE_ANON_KEY is not set. Supabase's gateway 401s a request with no apikey " +
          "header before the function is invoked, so this probe would measure the gateway " +
          "rather than process-refund.",
      );
      return;
    }

    // 0 is the number an operator's empty field sends. The sibling
    // schedule-refund turns it into a FULL refund of the payment
    // (`refundAmount || payment.amount`), so this is worth proving on the path
    // that moves money today.
    const res = await liveCall(
      "process-refund",
      {
        rentalId: NON_EXISTENT_RENTAL_ID,
        refundType: "full",
        refundAmount: 0,
        category: "Rental",
        reason: "drive247 spine suite — zero-amount guard probe",
      },
      { token: status.target.anonKey },
    );

    expect(
      res.status,
      "Expected 400 from process-refund's required-field check.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        "  A 401 means the check now sits BELOW the authorization block — a real change, " +
        "healthy or not. Anything else is FAILURE MODE (b): " +
        classifyLive(res).explain,
    ).toBe(400);

    expect(
      String(res.json?.error ?? res.text),
      "process-refund answered 400 but not with the required-field message. Either the " +
        "wording changed (failure mode (a)) or a zero amount is now being accepted and " +
        "refused later, which is the shape that turns 0 into 'everything'.",
    ).toMatch(/valid refundAmount/i);

    // Nothing here should have needed rounding, but assert the helper is the one
    // this suite compares money with, so a future money-bearing case in this
    // file uses the same one.
    expect(round2(0)).toBe(0);
  });
});
