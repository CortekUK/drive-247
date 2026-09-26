/**
 * The Received view: payments → receipts. Status mapping, the CAPTURED rule,
 * provider references, what each payment paid off, and the plan label.
 */
import { describe, expect, it } from 'vitest';
import { buildFinanceModel } from '@/lib/finances/model';
import { receiptStatus } from '@/lib/finances/receipts';
import { attempt, application, charge, CTX, emptyRaw, occurrence, payment, plan, rental } from '../helpers/finances-fixture';

describe('receipt status', () => {
  const cases: [string, Parameters<typeof payment>[4], string][] = [
    ['captured and approved', { status: 'Applied', capture_status: 'captured' }, 'approved'],
    ['manual, no capture status', { status: 'Credit', capture_status: null }, 'approved'],
    ['awaiting review', { status: 'Applied', verification_status: 'pending' }, 'pending_review'],
    ['rejected', { status: 'Applied', verification_status: 'rejected' }, 'rejected'],
    ['voided link', { status: 'Reversed', verification_status: 'pending' }, 'rejected'],
    ['review with a cancelled capture is not actionable', { status: 'Pending', verification_status: 'pending', capture_status: 'cancelled' }, 'pending'],
    ['refunded in full', { status: 'Refunded', refund_amount: 200 }, 'refunded'],
    ['partial refund', { status: 'Partial Refund', refund_amount: 50 }, 'partially_refunded'],
    ['refund recorded on an Applied row', { status: 'Applied', refund_amount: 200 }, 'refunded'],
    ['a link not yet paid', { status: 'Pending', capture_status: 'requires_capture', verification_status: 'approved' }, 'pending'],
    ['a hold wearing a received status', { status: 'Applied', capture_status: 'requires_capture' }, 'pending'],
  ];
  for (const [name, extra, expected] of cases) {
    it(name, () => {
      expect(receiptStatus(payment('p', 'c', 'r', 200, extra))).toBe(expected);
    });
  }
});

describe('the CAPTURED rule', () => {
  it('a requires_capture Pending row is not money: not received, no net, no credit', () => {
    const raw = emptyRaw();
    raw.payments = [payment('hold', 'c1', 'r1', 1577.0, { status: 'Pending', capture_status: 'requires_capture', remaining_amount: 1577.0 })];
    const [r] = buildFinanceModel(raw, CTX).receipts;
    expect(r.countsAsReceived).toBe(false);
    expect(r.netCents).toBe(0);
    expect(r.unappliedCents).toBe(0);
    expect(r.status).toBe('pending');
  });

  it('a requires_capture row with a credit status is not credit either', () => {
    const raw = emptyRaw();
    raw.payments = [payment('p', 'c1', 'r1', 300.0, { status: 'Credit', capture_status: 'requires_capture', remaining_amount: 300.0 })];
    const [r] = buildFinanceModel(raw, CTX).receipts;
    expect([r.countsAsReceived, r.unappliedCents]).toEqual([false, 0]);
  });

  it('captured credit keeps its unapplied remainder; Completed/Refunded rows carry none', () => {
    const raw = emptyRaw();
    raw.payments = [
      payment('a', 'c1', 'r1', 100.0, { status: 'Credit', remaining_amount: 100.0 }),
      payment('b', 'c1', 'r1', 100.0, { status: 'Partial', remaining_amount: 35.5 }),
      payment('c', 'c1', 'r1', 100.0, { status: 'Completed', remaining_amount: 100.0 }),
      payment('d', 'c1', 'r1', 100.0, { status: 'Refunded', remaining_amount: 100.0, refund_amount: 100.0 }),
    ];
    const byId = new Map(buildFinanceModel(raw, CTX).receipts.map((r) => [r.paymentId, r.unappliedCents]));
    expect([byId.get('a'), byId.get('b'), byId.get('c'), byId.get('d')]).toEqual([10000, 3550, 0, 0]);
  });

  it('net is amount minus refund, never below zero', () => {
    const raw = emptyRaw();
    raw.payments = [
      payment('a', 'c1', 'r1', 200.0, { status: 'Partial Refund', refund_amount: 50.0 }),
      payment('b', 'c1', 'r1', 200.0, { status: 'Applied', refund_amount: 250.0 }),
    ];
    const byId = new Map(buildFinanceModel(raw, CTX).receipts.map((r) => [r.paymentId, r]));
    expect([byId.get('a')!.netCents, byId.get('a')!.refundedCents]).toEqual([15000, 5000]);
    expect([byId.get('b')!.netCents, byId.get('b')!.refundedCents]).toEqual([0, 25000]);
  });
});

describe('provider and references', () => {
  it('Stripe: the intent is the reference; a live checkout session proves the mode', () => {
    const raw = emptyRaw();
    raw.payments = [payment('s', 'c1', 'r1', 100.0, { stripe_payment_intent_id: 'pi_123', stripe_checkout_session_id: 'cs_live_abc' })];
    const [r] = buildFinanceModel(raw, CTX).receipts;
    expect([r.provider, r.providerRef, r.providerMode, r.checkoutSessionId]).toEqual(['stripe', 'pi_123', 'live', 'cs_live_abc']);
    expect(r.references).toEqual(['pi_123', 'cs_live_abc']);
  });

  it('Stripe with only an intent: the mode is unknown, never guessed', () => {
    const raw = emptyRaw();
    raw.payments = [payment('s', 'c1', 'r1', 100.0, { stripe_payment_intent_id: 'pi_9' })];
    expect(buildFinanceModel(raw, CTX).receipts[0].providerMode).toBeNull();
  });

  it('Square: told apart by its ids, not by payment_provider (which defaults to stripe)', () => {
    const raw = emptyRaw();
    raw.payments = [payment('q', 'c1', 'r1', 100.0, { payment_provider: 'stripe', square_payment_id: 'sq_pay_1', square_order_id: 'ord_1' })];
    const [r] = buildFinanceModel(raw, CTX).receipts;
    expect([r.provider, r.providerRef]).toEqual(['square', 'sq_pay_1']);
  });

  it('no provider id at all is manual', () => {
    const raw = emptyRaw();
    raw.payments = [payment('m', 'c1', 'r1', 100.0, { method: 'Cash' })];
    const [r] = buildFinanceModel(raw, CTX).receipts;
    expect([r.provider, r.providerRef, r.references]).toEqual(['manual', null, []]);
  });
});

describe('what a payment paid off, and its plan', () => {
  it('lists each charge it was applied to, with category and rental', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r1', 'c1', { rental_number: 'R-1042' })];
    raw.charges = [
      charge('ch1', 'r1', 'c1', 'Rental', 400.0, 0, '2026-09-01'),
      charge('ch2', 'r1', 'c1', 'Fine', 50.0, 20.0, '2026-09-02'),
    ];
    raw.payments = [payment('p1', 'c1', 'r1', 430.0)];
    raw.applications = [application('p1', 'ch1', 400.0), application('p1', 'ch2', 30.0)];
    const [r] = buildFinanceModel(raw, CTX).receipts;
    expect(r.appliedTo).toEqual([
      { chargeId: 'ch1', category: 'Rental', rentalRef: 'R-1042', amountCents: 40000 },
      { chargeId: 'ch2', category: 'Fine', rentalRef: 'R-1042', amountCents: 3000 },
    ]);
  });

  it('a plan payment is "Payment N of M" over the live (non-superseded) occurrences in schedule order', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('r1', 'c1')];
    raw.plans = [plan('pl', 'r1', 'c1')];
    raw.occurrences = [
      occurrence('o-old', 'pl', 'r1', 2, '2026-09-10', 100.0, 0, 'superseded'),
      occurrence('o1', 'pl', 'r1', 1, '2026-09-03', 100.0, 100.0, 'paid'),
      occurrence('o3', 'pl', 'r1', 3, '2026-09-10', 150.0, 150.0, 'paid'),
      occurrence('o4', 'pl', 'r1', 4, '2026-09-17', 150.0, 0, 'scheduled'),
    ];
    raw.attempts = [attempt('a3', 'o3', 1, { status: 'succeeded', payment_id: 'p3', provider_mode: 'test', provider_account: 'acct_1', created_by: 'user-7' })];
    raw.payments = [payment('p3', 'c1', 'r1', 150.0, { payment_plan_occurrence_id: 'o3', stripe_payment_intent_id: 'pi_3' })];
    const [r] = buildFinanceModel(raw, CTX).receipts;
    // Live rows in order: o1 (3rd), o3 (10th), o4 (17th) → o3 is payment 2 of 3.
    expect([r.planLabel, r.occurrenceId]).toEqual(['Payment 2 of 3', 'o3']);
    expect([r.providerMode, r.providerAccount, r.recordedById]).toEqual(['test', 'acct_1', 'user-7']);
  });

  it('a manual plan record is manual, whatever the row says', () => {
    const raw = emptyRaw();
    raw.occurrences = [occurrence('o1', 'pl', 'r1', 1, '2026-09-03', 100.0, 100.0, 'paid')];
    raw.attempts = [attempt('a1', 'o1', 1, { status: 'succeeded', provider: 'manual', payment_id: 'pm' })];
    raw.payments = [payment('pm', 'c1', 'r1', 100.0, { payment_plan_occurrence_id: 'o1', method: 'Zelle' })];
    expect(buildFinanceModel(raw, CTX).receipts[0].provider).toBe('manual');
  });
});
