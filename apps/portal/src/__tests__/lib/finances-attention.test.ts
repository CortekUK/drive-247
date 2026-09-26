/**
 * Needs attention (design §4): each rule with a case that fires and a case
 * that must not; sorted by money at stake; decline reasons never reveal a
 * lost/stolen/fraud flag.
 */
import { describe, expect, it } from 'vitest';
import { buildFinanceModel } from '@/lib/finances/model';
import type { FinanceRawData } from '@/lib/finances/types';
import { attempt, CTX, emptyRaw, occurrence, payment, plan, rental } from '../helpers/finances-fixture';

const kinds = (raw: FinanceRawData) => buildFinanceModel(raw, CTX).attention.map((a) => `${a.kind}:${a.amountCents}`);

function withPlan() {
  const raw = emptyRaw();
  raw.customers = [{ id: 'c1', name: 'Ada Okafor' }];
  raw.rentals = [rental('r1', 'c1', { rental_number: 'R-1042' })];
  raw.plans = [plan('pl', 'r1', 'c1')];
  return raw;
}

describe('card declined', () => {
  it('fires on a failed occurrence, with the remaining amount at stake', () => {
    const raw = withPlan();
    raw.occurrences = [occurrence('o1', 'pl', 'r1', 1, '2026-09-20', 150.0, 50.0, 'failed', { next_attempt_at: '2026-09-27T14:00:00Z' })];
    raw.attempts = [
      attempt('a1', 'o1', 1, { decline_code: 'processing_error' }),
      attempt('a2', 'o1', 2, { decline_code: 'insufficient_funds' }),
    ];
    const [item] = buildFinanceModel(raw, CTX).attention;
    expect(item).toMatchObject({ kind: 'card_declined', amountCents: 10000, rentalId: 'r1', customerId: 'c1', occurrenceId: 'o1', paymentIds: [] });
    expect(item.title).toBe('Card declined — Ada Okafor');
    // The LAST attempt's reason, and the retry day in the plan's zone.
    expect(item.detail).toContain('Payment 1 of 1 on R-1042, due Sun 20 Sep');
    expect(item.detail).toContain('Your card has insufficient funds.');
    expect(item.detail).toContain('tried again on Sun 27 Sep');
  });

  it('never puts a lost/stolen/fraud code into words', () => {
    for (const code of ['lost_card', 'stolen_card', 'fraudulent', 'pickup_card']) {
      const raw = withPlan();
      raw.occurrences = [occurrence('o1', 'pl', 'r1', 1, '2026-09-20', 100.0, 0, 'failed')];
      raw.attempts = [attempt('a1', 'o1', 1, { decline_code: code, error_code: 'card_declined' })];
      const [item] = buildFinanceModel(raw, CTX).attention;
      const words = `${item.title} ${item.detail}`.toLowerCase();
      expect(words).toContain('your card was declined. please use a different card or contact your bank.');
      for (const leak of ['lost', 'stolen', 'fraud', 'pickup', 'pick up']) expect(words).not.toContain(leak);
    }
  });

  it('does not fire on a paid, scheduled or due occurrence', () => {
    const raw = withPlan();
    raw.occurrences = [
      occurrence('o1', 'pl', 'r1', 1, '2026-09-20', 100.0, 100.0, 'paid'),
      occurrence('o2', 'pl', 'r1', 2, '2026-09-27', 100.0, 0, 'scheduled'),
      occurrence('o3', 'pl', 'r1', 3, '2026-09-25', 100.0, 0, 'due'),
    ];
    expect(kinds(raw)).toEqual([]);
  });
});

describe('needs the customer', () => {
  it('fires on requires_action', () => {
    const raw = withPlan();
    raw.occurrences = [occurrence('o1', 'pl', 'r1', 1, '2026-09-24', 80.0, 0, 'requires_action')];
    const [item] = buildFinanceModel(raw, CTX).attention;
    expect(item).toMatchObject({ kind: 'needs_customer', amountCents: 8000, occurrenceId: 'o1' });
    expect(item.title).toBe('Waiting for Ada Okafor to confirm');
  });

  it('does not fire on processing (the charge is in flight)', () => {
    const raw = withPlan();
    raw.occurrences = [occurrence('o1', 'pl', 'r1', 1, '2026-09-24', 80.0, 0, 'processing')];
    expect(kinds(raw)).toEqual([]);
  });
});

describe('awaiting review', () => {
  it("fires on verification_status 'pending'", () => {
    const raw = emptyRaw();
    raw.customers = [{ id: 'c1', name: 'Ada Okafor' }];
    raw.payments = [payment('p1', 'c1', 'r1', 120.0, { verification_status: 'pending', method: 'Zelle' })];
    const [item] = buildFinanceModel(raw, CTX).attention;
    expect(item).toMatchObject({ kind: 'awaiting_review', amountCents: 12000, paymentIds: ['p1'] });
    expect(item.detail).toBe('$120.00 by Zelle on Fri 25 Sep for R1 is waiting for approval.');
  });

  it('does not fire once approved, rejected, or voided', () => {
    const raw = emptyRaw();
    raw.payments = [
      // Different amounts, so the duplicate rule stays out of this case.
      payment('a', 'c1', 'r1', 10.0, { verification_status: 'approved' }),
      payment('b', 'c1', 'r1', 11.0, { verification_status: 'rejected' }),
      payment('c', 'c1', 'r1', 12.0, { verification_status: 'pending', status: 'Reversed' }),
      payment('d', 'c1', 'r1', 13.0, { verification_status: 'pending', status: 'Pending', capture_status: 'cancelled' }),
    ];
    expect(kinds(raw)).toEqual([]);
  });
});

describe('possible duplicate', () => {
  it('fires on two captured payments, same rental, same amount, same day — the copy is at stake', () => {
    const raw = emptyRaw();
    raw.payments = [payment('p1', 'c1', 'r1', 250.0), payment('p2', 'c1', 'r1', 250.0), payment('p3', 'c1', 'r1', 250.0)];
    const [item] = buildFinanceModel(raw, CTX).attention;
    // 3 payments → 2 extra copies → 2 × 25000.
    expect(item).toMatchObject({ kind: 'possible_duplicate', amountCents: 50000, rentalId: 'r1', paymentIds: ['p1', 'p2', 'p3'] });
    expect(item.detail).toBe('3 payments of $250.00 on Fri 25 Sep for R1.');
  });

  it('does not fire across rentals, amounts, days — or when one is only a hold', () => {
    const raw = emptyRaw();
    raw.payments = [
      payment('a', 'c1', 'r1', 250.0),
      payment('b', 'c1', 'r2', 250.0), // other rental
      payment('c', 'c1', 'r1', 250.01), // other amount
      payment('d', 'c1', 'r1', 250.0, { payment_date: '2026-09-24' }), // other day
      payment('e', 'c1', 'r1', 250.0, { status: 'Pending', capture_status: 'requires_capture' }), // not money
      payment('f', 'c1', 'r1', 250.0, { status: 'Refunded', refund_amount: 250.0 }), // already refunded
    ];
    expect(kinds(raw)).toEqual([]);
  });
});

describe('unapplied credit', () => {
  it('fires on a captured Credit or Partial payment with money left', () => {
    const raw = emptyRaw();
    raw.payments = [
      payment('p1', 'c1', 'r1', 300.0, { status: 'Credit', remaining_amount: 300.0 }),
      payment('p2', 'c1', 'r1', 90.0, { status: 'Partial', remaining_amount: 12.5, payment_date: '2026-09-20' }),
    ];
    expect(kinds(raw)).toEqual(['unapplied_credit:30000', 'unapplied_credit:1250']);
  });

  it('does not fire on a hold, on Applied, or on nothing left', () => {
    const raw = emptyRaw();
    raw.payments = [
      payment('a', 'c1', 'r1', 300.0, { status: 'Credit', capture_status: 'requires_capture', remaining_amount: 300.0, payment_date: '2026-09-01' }),
      payment('b', 'c1', 'r1', 300.0, { status: 'Applied', remaining_amount: 0, payment_date: '2026-09-02' }),
      payment('c', 'c1', 'r1', 300.0, { status: 'Partial', remaining_amount: 0, payment_date: '2026-09-03' }),
    ];
    expect(kinds(raw)).toEqual([]);
  });
});

describe('ordering', () => {
  it('is by money at stake, largest first', () => {
    const raw = withPlan();
    raw.occurrences = [
      occurrence('o1', 'pl', 'r1', 1, '2026-09-20', 40.0, 0, 'failed'),
      occurrence('o2', 'pl', 'r1', 2, '2026-09-22', 500.0, 0, 'requires_action'),
    ];
    raw.payments = [
      payment('p1', 'c1', 'r1', 120.0, { verification_status: 'pending' }),
      payment('p2', 'c1', 'r1', 75.0, { status: 'Credit', remaining_amount: 75.0, payment_date: '2026-09-02' }),
    ];
    expect(kinds(raw)).toEqual(['needs_customer:50000', 'awaiting_review:12000', 'unapplied_credit:7500', 'card_declined:4000']);
  });
});
