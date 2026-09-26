/**
 * L1 — the runner's OBSERVED side: `observe` and the Finances tie-out
 * (tests/e2e/scenarios/observe.ts), on rows written here by hand.
 *
 * Each case below restates one rule of the portal's Finances tab
 * (apps/portal/src/lib/finances/balance.ts, bills.ts, receipts.ts, filters.ts)
 * with the smallest set of rows that shows it, and the expected numbers are
 * worked by hand in the comment beside them. If the portal's rule changes, the
 * runner's copy must change with it — this file is where that shows.
 */
import { describe, expect, it } from "vitest";
import { compareCheck, compareTieOut, observe, tieOut, type Snapshot, type SnapLedger, type SnapPayment } from "./scenarios/observe.ts";

const R = "rental-1";
const C = "customer-1";

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    takenAt: "2026-10-05T15:00:00.000Z",
    today: "2026-10-05",
    originalEndDate: "2026-10-08",
    endDateShiftDays: 0,
    rental: { id: R, status: "Active", approval_status: "approved", is_pay_as_you_go: false, end_date: "2026-10-08" },
    ledger: [],
    payments: [],
    applications: [],
    extensions: [],
    accruals: [],
    installments: [],
    plan: null,
    occurrences: [],
    attempts: [],
    stripeIntents: null,
    ...over,
  };
}

const charge = (id: string, category: string, amount: number, remaining: number, over: Partial<SnapLedger> = {}): SnapLedger => ({
  id,
  type: "Charge",
  category,
  amount,
  remaining_amount: remaining,
  due_date: "2026-10-05",
  customer_id: C,
  extension_id: null,
  ...over,
});

const pay = (id: string, amount: number, status: string, over: Partial<SnapPayment> = {}): SnapPayment => ({
  id,
  amount,
  refund_amount: null,
  status,
  capture_status: "captured",
  payment_type: "Payment",
  stripe_checkout_session_id: null,
  payment_plan_occurrence_id: null,
  ...over,
});

describe("tieOut — the three Finances numbers for one rental", () => {
  it("a booking paid in full: owes 0, collected 300.00, the bill ties out", () => {
    const s = snap({
      ledger: [charge("c1", "Rental", 300, 0)],
      payments: [pay("p1", 300, "Applied")],
      applications: [{ payment_id: "p1", charge_entry_id: "c1", amount_applied: 300 }],
    });
    // 300.00 − 300.00 applied − 0 credited = 0.00 balance.
    expect(tieOut(s)).toEqual({ outstandingCents: 0, collectedCents: 30000, bills: [{ label: "Booking", totalCents: 30000, paidCents: 30000, creditedCents: 0, balanceCents: 0, tiesOut: true }] });
  });

  it("a Refunded payment is not collected; a Partial Refund collects the net", () => {
    const full = snap({ payments: [pay("p1", 300, "Refunded", { refund_amount: 300 })] });
    expect(tieOut(full).collectedCents).toBe(0);
    // The STATUS decides, not the arithmetic: a Refunded row whose refund_amount
    // was never written is still not money received (lib/payment-status).
    const statusOnly = snap({ payments: [pay("p1", 300, "Refunded", { refund_amount: null })] });
    expect(tieOut(statusOnly).collectedCents).toBe(0);
    const part = snap({ payments: [pay("p1", 300, "Partial Refund", { refund_amount: 100 })] });
    // 300.00 − 100.00 = 200.00.
    expect(tieOut(part).collectedCents).toBe(20000);
  });

  it("a Pending link row, an uncaptured hold and a non-Payment row collect nothing", () => {
    const s = snap({
      payments: [
        pay("link", 200, "Pending", { capture_status: "requires_capture", stripe_checkout_session_id: "cs_test_1" }),
        pay("hold", 100, "Applied", { capture_status: "requires_capture" }),
        pay("fee", 50, "Applied", { payment_type: "InitialFee" }),
        pay("ok", 25, "Completed"),
      ],
    });
    expect(tieOut(s).collectedCents).toBe(2500);
  });

  it("a Rental charge due after today is not owed yet; an Extension Rental charge is owed at once", () => {
    const s = snap({
      ledger: [
        charge("c1", "Rental", 100, 100, { due_date: "2026-10-06" }),
        charge("c2", "Extension Rental", 200, 200, { due_date: "2026-10-10", extension_id: "e1" }),
      ],
      extensions: [{ id: "e1", sequence_number: 1, status: "approved", extension_days: 2, total_amount: 200 }],
    });
    const f = tieOut(s);
    // Only the extension's 200.00 counts (Rental due tomorrow is deferred).
    expect(f.outstandingCents).toBe(20000);
    expect(f.bills.map((b) => [b.label, b.balanceCents])).toEqual([["Booking", 10000], ["Extension #1", 20000]]);
  });

  it("a PAYG rental owes its OPEN accruals, never its ledger rows (both describe the same days)", () => {
    const s = snap({
      rental: { id: R, status: "Active", is_pay_as_you_go: true, payg_closed_at: null },
      ledger: [charge("d1", "Rental", 40, 40), charge("d2", "Rental", 40, 40), charge("d3", "Rental", 40, 40)],
      accruals: [
        { accrual_day_index: 1, invoice_status: "open", daily_rate: 40, tax_amount: 0, service_fee_amount: 0 },
        { accrual_day_index: 2, invoice_status: "open", daily_rate: 40, tax_amount: 0, service_fee_amount: 0 },
        { accrual_day_index: 3, invoice_status: "open", daily_rate: 40, tax_amount: 0, service_fee_amount: 0 },
      ],
    });
    // 3 × 40.00 = 120.00 — not 240.00.
    expect(tieOut(s).outstandingCents).toBe(12000);
    const closed = snap({ ...s, rental: { ...s.rental!, payg_closed_at: "2026-10-05T00:00:00Z" } });
    expect(tieOut(closed).outstandingCents).toBe(0);
  });

  it("a cancelled or rejected rental owes nothing", () => {
    const ledger = [charge("c1", "Rental", 300, 300)];
    expect(tieOut(snap({ ledger, rental: { id: R, status: "Cancelled" } })).outstandingCents).toBe(0);
    expect(tieOut(snap({ ledger, rental: { id: R, status: "Active", approval_status: "rejected" } })).outstandingCents).toBe(0);
  });

  it("a negative charge is Credited; a remaining_amount written with no allocation does NOT tie out", () => {
    const credited = snap({ ledger: [charge("c1", "Rental", 300, 270), charge("adj", "Other", -30, 0)] });
    // Total 300.00, Paid 0, Credited 30.00, Balance 270.00 → 300 − 0 − 30 = 270 ✓.
    expect(tieOut(credited).bills[0]).toEqual({ label: "Booking", totalCents: 30000, paidCents: 0, creditedCents: 3000, balanceCents: 27000, tiesOut: true });
    const drift = snap({ ledger: [charge("c1", "Rental", 300, 0)] });
    // Balance 0 with nothing applied: 300 − 0 − 0 ≠ 0.
    expect(tieOut(drift).bills[0].tiesOut).toBe(false);
  });
});

describe("observe — the named observations", () => {
  const s = snap({
    rental: { id: R, status: "Active", end_date: "2026-10-13", auto_extend_status: "active", auto_extend_paused: false, auto_extend_failed_attempts: 0, auto_extend_charge_count: 1, auto_extend_pending_extension_id: null, auto_extend_next_charge_at: "2026-10-06T07:00:00.000Z" },
    endDateShiftDays: 1,
    ledger: [charge("c1", "Rental", 350, 0), charge("x1", "Extension Rental", 350, 0, { extension_id: "e1" }), { id: "r1", type: "Refund", category: "Rental", amount: -100, remaining_amount: 0, due_date: "2026-10-05", customer_id: C, extension_id: null }],
    payments: [pay("p1", 350, "Applied", { refund_amount: 100 }), pay("p2", 350, "Applied"), pay("l1", 350, "Pending", { capture_status: "requires_capture", stripe_checkout_session_id: "cs_test_x" })],
    applications: [{ payment_id: "p1", charge_entry_id: "c1", amount_applied: 350 }, { payment_id: "p2", charge_entry_id: "x1", amount_applied: 350 }],
    extensions: [{ id: "e1", sequence_number: 1, status: "paid", extension_days: 7, total_amount: 350 }],
    stripeIntents: [{ id: "pi_1", status: "succeeded", amount: 35000 }, { id: "pi_2", status: "canceled", amount: 100 }],
  });
  it.each([
    ["payments.received_count", 2],
    ["payments.received_cents", 70000],
    ["payments.net_received_cents", 60000],
    ["payments.refunded_cents", 10000],
    ["payments.pending_link_count", 1],
    ["payments.non_pending_statuses", ["Applied", "Applied"]],
    ["ledger.charge_cents", 70000],
    ["ledger.remaining_cents", 0],
    ["ledger.extension_charge_cents", 35000],
    ["ledger.refund_row_cents", -10000],
    ["applications.cents", 70000],
    ["extensions.count", 1],
    ["extensions.last.status", "paid"],
    ["extensions.last.days", 7],
    ["extensions.last.total_cents", 35000],
    // end 10-13 is 5 days after the original 10-08, plus the 1 day the runner shifted it back: 6.
    ["rental.end_date_moved_days", 6],
    ["rental.auto_extend_charge_count", 1],
    ["rental.auto_extend_pending", false],
    // 10-06T07:00Z − 10-05T15:00Z = 16 h.
    ["rental.auto_extend_retry_in_hours", 16],
    ["stripe.succeeded_intents", 1],
    ["stripe.succeeded_intent_cents", 35000],
  ] as const)("%s", (key, want) => {
    expect(observe(s, key)).toEqual(want);
  });

  it("plan observations read occurrences and attempts by sequence", () => {
    const p = snap({
      plan: { id: "pl", status: "active" },
      occurrences: [{ id: "o2", seq: 2, status: "scheduled" }, { id: "o1", seq: 1, status: "paid" }],
      attempts: [{ occurrence_id: "o1", attempt_no: 2, method: "checkout_link", status: "succeeded" }, { occurrence_id: "o1", attempt_no: 1, method: "auto_charge", status: "requires_action" }],
      payments: [pay("pp1", 200, "Applied", { payment_plan_occurrence_id: "o1" }), pay("other", 50, "Applied")],
    });
    expect(observe(p, "plan.occurrence_statuses")).toEqual(["paid", "scheduled"]);
    expect(observe(p, "plan.attempt_keys_suffixes")).toEqual(["1:1", "1:2"]);
    expect(observe(p, "plan.card_attempts_for_occurrence_1")).toBe(1);
    expect(observe(p, "plan.payment_count")).toBe(1);
    expect(observe(p, "plan.payment_cents")).toBe(20000);
  });

  it("a Stripe observation is null (never 0) when the runner did not read Stripe", () => {
    expect(observe(snap(), "stripe.succeeded_intents")).toBeNull();
  });
});

describe("compare — expected vs observed, with the derivation carried", () => {
  it("passes and fails honestly, and keeps the math", () => {
    const s = snap({ payments: [pay("p1", 300, "Applied")] });
    expect(compareCheck({ label: "x", observe: "payments.received_cents", expect: { cents: 30000, math: "3 × 100.00 = 300.00" } }, s)).toEqual({ label: "x", expected: 30000, actual: 30000, pass: true, math: "3 × 100.00 = 300.00" });
    expect(compareCheck({ label: "y", observe: "payments.received_count", expect: 2 }, s).pass).toBe(false);
  });
  it("a tie-out produces one assertion per number, per bill, and one per tie", () => {
    const s = snap({ ledger: [charge("c1", "Rental", 300, 300)] });
    const zero = { cents: 0, math: "0.00 = 0.00" };
    const r = compareTieOut("t", { outstanding: { cents: 30000, math: "300.00 = 300.00" }, collected: zero, bills: [{ label: "Booking", total: { cents: 30000, math: "300.00 = 300.00" }, paid: zero, credited: zero, balance: { cents: 30000, math: "300.00 = 300.00" } }] }, s);
    expect(r.map((a) => [a.label, a.pass])).toEqual([
      ["t: Outstanding", true],
      ["t: Collected", true],
      ["t: bills on the rental", true],
      ["t: Booking Total", true],
      ["t: Booking Paid", true],
      ["t: Booking Credited", true],
      ["t: Booking Balance", true],
      ["t: Booking ties out (Total − Paid − Credited = Balance)", true],
    ]);
    const wrong = compareTieOut("t", { outstanding: zero, collected: zero, bills: [] }, s);
    expect(wrong.filter((a) => !a.pass).map((a) => a.label)).toEqual(["t: Outstanding", "t: bills on the rental"]);
  });
});
