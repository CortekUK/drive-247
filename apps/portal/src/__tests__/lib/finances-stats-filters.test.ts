/**
 * The math strip and the filter bar. Every expected figure is derived by hand
 * in the comment beside it. Two properties are pinned for EVERY card:
 *   1. the stat is the sum of the rows its card filter returns, and
 *   2. the card filter returns exactly those rows — no more, no fewer.
 * And Outstanding is checked against the per-customer hook computation
 * (lib/finances/balance.ts, the functions use-customer-balance.ts calls).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFinanceModel } from '@/lib/finances/model';
import { cardRows, selectFinances } from '@/lib/finances/filters';
import { periodRange, tenantToday } from '@/lib/finances/period';
import { excludedRentalReason, sumLedgerBalance, sumPaygAccruals } from '@/lib/finances/balance';
import type { FinanceFilters } from '@/lib/finances/types';
import { CTX, tenantFixture as tenant, TODAY } from '../helpers/finances-fixture';

const month: FinanceFilters = { period: 'month' };

afterEach(() => vi.useRealTimers());

describe('the four cards, by hand (today = 2026-09-25, period = this month)', () => {
  const model = buildFinanceModel(tenant(), CTX);
  const { stats } = selectFinances(model, month, TODAY);

  it('Outstanding = 53600 across 3 customers', () => {
    // c1: 30000 + 3000 (r1; the October Rental waits) + 4000 (fine on no rental) = 37000
    // c2: PAYG → its accrual 10000 + 825 + 275 = 11100 (the ledger's 11100 is the same day)
    // c3: cancelled rental → 0
    // c4: 6500 − 1000 = 5500
    expect(stats.outstandingCents).toBe(53600);
    expect(stats.outstandingCustomers).toBe(3);
  });

  it('Overdue = 37000 on 2 rentals', () => {
    // r1: 30000 + 3000 (due 10 Sep); no-rental fine 4000 (due 1 Sep). k6 is due 30 Sep.
    expect(stats.overdueCents).toBe(37000);
    expect(stats.overdueRentals).toBe(2);
  });

  it('Collected = 33000 from 4 payments, refunded 4000 shown beside it', () => {
    // p1 20000 · p2 10000 − 4000 = 6000 · p7 6000 · p8 1000 (Completed counts).
    // Not: p3 (requires_capture), p4 (InitialFee), p5 (August), p6 (Refunded).
    expect([stats.collectedCents, stats.collectedCount, stats.refundedCents]).toEqual([33000, 4, 4000]);
  });

  it('Upcoming · 7 days = 36000 from 4 payments: 2 auto, 1 link', () => {
    // Window 25 Sep – 1 Oct. o2 10000 (due today, auto) · o3 10000 (link) ·
    // o4 10000 − 4000 = 6000 (manual) · o6 10000 (failed, retry 27 Sep, auto).
    // Not: o5 (2 Oct), o7 (failed, no retry), o8 (needs customer), o9
    // (processing), o10 (plan paused), o1 (paid).
    expect([stats.upcomingCents, stats.upcomingCount, stats.upcomingAuto, stats.upcomingLinks]).toEqual([36000, 4, 2, 1]);
  });

  it('matches the per-customer hook computation, summed tenant-wide', () => {
    // Local noon on 2026-09-25, so the hook's browser-local "today" is CTX.today.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 12, 0, 0));
    const raw = tenant();
    let totalCents = 0;
    for (const c of raw.customers) {
      // The hook's three per-customer reads, over the same rows.
      const mine = raw.rentals.filter((r) => r.customer_id === c.id);
      const excluded = new Set(mine.filter((r) => excludedRentalReason(r)).map((r) => r.id));
      const paygIds = new Set(mine.filter((r) => r.is_pay_as_you_go).map((r) => r.id));
      const ledger = raw.charges.filter((k) => k.customer_id === c.id);
      const accruals = raw.accruals.filter((a) => a.rentals?.customer_id === c.id);
      const dollars = sumLedgerBalance(ledger, excluded, paygIds) + sumPaygAccruals(accruals, excluded);
      totalCents += Math.round(dollars * 100);
    }
    expect(totalCents).toBe(53600);
    expect(stats.outstandingCents).toBe(totalCents);
  });
});

describe('each card filter returns exactly the rows behind its number', () => {
  const model = buildFinanceModel(tenant(), CTX);
  const pick = (card: FinanceFilters['card']) => selectFinances(model, { ...month, card }, TODAY);

  it('outstanding', () => {
    const { bills, stats } = pick('outstanding');
    expect(bills.map((b) => b.key).sort()).toEqual(['none:c1', 'r1:booking', 'r2:booking', 'r4:booking']);
    expect(bills.reduce((s, b) => s + b.outstandingCents, 0)).toBe(stats.outstandingCents);
  });

  it('overdue', () => {
    const { bills, stats } = pick('overdue');
    expect(bills.map((b) => b.key).sort()).toEqual(['none:c1', 'r1:booking']);
    expect(bills.reduce((s, b) => s + b.overdueCents, 0)).toBe(stats.overdueCents);
  });

  it('collected', () => {
    const { receipts, stats } = pick('collected');
    expect(receipts.map((r) => r.paymentId).sort()).toEqual(['p1', 'p2', 'p7', 'p8']);
    expect(receipts.reduce((s, r) => s + r.netCents, 0)).toBe(stats.collectedCents);
    expect(receipts.length).toBe(stats.collectedCount);
  });

  it('upcoming', () => {
    const { upcoming, stats } = pick('upcoming');
    expect(upcoming.map((u) => u.occurrenceId).sort()).toEqual(['o2', 'o3', 'o4', 'o6']);
    expect(upcoming.reduce((s, u) => s + u.amountCents, 0)).toBe(stats.upcomingCents);
    // The failed one is expected on its retry day, in the plan's timezone.
    expect(upcoming.find((u) => u.occurrenceId === 'o6')).toMatchObject({ dueDate: '2026-09-18', nextAttemptOn: '2026-09-27', effectiveOn: '2026-09-27' });
  });

  it('the stats never depend on which card is clicked', () => {
    const base = selectFinances(model, month, TODAY).stats;
    for (const card of ['outstanding', 'overdue', 'collected', 'upcoming'] as const) {
      expect(pick(card).stats).toEqual(base);
    }
  });
});

describe('the filter bar narrows the rows AND the numbers together', () => {
  const model = buildFinanceModel(tenant(), CTX);

  it('search reaches a Stripe reference', () => {
    const { receipts, stats } = selectFinances(model, { period: 'all', search: 'PI_777' }, TODAY);
    expect(receipts.map((r) => r.paymentId)).toEqual(['p1']);
    expect(stats.collectedCents).toBe(20000);
  });

  it('search reaches a Square reference', () => {
    const { receipts } = selectFinances(model, { period: 'all', search: 'sqp_42' }, TODAY);
    expect(receipts.map((r) => r.paymentId)).toEqual(['p7']);
  });

  it('search by customer narrows every card to that customer', () => {
    const { stats } = selectFinances(model, { ...month, search: 'ada' }, TODAY);
    // Ada (c1): outstanding 37000, overdue 37000, collected p1 20000 + p2 6000 + p8 1000 = 27000,
    // upcoming (pl1 is hers) 36000.
    expect([stats.outstandingCents, stats.overdueCents, stats.collectedCents, stats.upcomingCents]).toEqual([37000, 37000, 27000, 36000]);
  });

  it('search by vehicle and by rental reference', () => {
    expect(selectFinances(model, { period: 'all', search: 'ab12' }, TODAY).bills.map((b) => b.key)).toEqual(['r1:booking']);
    expect(selectFinances(model, { period: 'all', search: 'R4' }, TODAY).bills.map((b) => b.key)).toEqual(['r4:booking']);
  });

  it("a status narrows only the row kind it belongs to", () => {
    const { bills, stats } = selectFinances(model, { period: 'all', statuses: ['overdue'] }, TODAY);
    expect(bills.map((b) => b.key).sort()).toEqual(['none:c1', 'r1:booking']);
    // Outstanding now sums the overdue bills only: 33000 + 4000. Receipts are untouched.
    expect(stats.outstandingCents).toBe(37000);
    expect(stats.collectedCount).toBe(5); // p5 (August) is in: period 'all'
  });

  it('a payment method narrows receipts; a collection method narrows upcoming', () => {
    const cash = selectFinances(model, { period: 'all', methods: ['cash'] }, TODAY);
    expect(cash.receipts.map((r) => r.paymentId)).toEqual(['p8']);
    expect(cash.stats.upcomingCount).toBe(4);
    const auto = selectFinances(model, { ...month, methods: ['auto_charge'] }, TODAY);
    expect(auto.stats.upcomingCount).toBe(2);
    expect(auto.receipts.length).toBeGreaterThan(1);
  });
});

describe('periods are tenant-local calendar days', () => {
  const model = buildFinanceModel(tenant(), CTX);

  it('today and the last 7 days', () => {
    // today: p7 only. 7 days (19–25 Sep): p1 20000 + p2 6000 + p7 6000.
    expect(selectFinances(model, { period: 'today' }, TODAY).stats.collectedCents).toBe(6000);
    expect(selectFinances(model, { period: '7d' }, TODAY).stats.collectedCents).toBe(32000);
  });

  it('a custom range is inclusive at both ends', () => {
    const { stats } = selectFinances(model, { period: { from: '2026-09-01', to: '2026-09-20' } }, TODAY);
    // p8 (1 Sep) 1000 + p1 (20 Sep) 20000.
    expect(stats.collectedCents).toBe(21000);
  });

  it("'this month' is the tenant's month, even when UTC has already moved on", () => {
    const today = tenantToday('America/New_York', new Date('2026-10-01T02:00:00Z'));
    expect(today).toBe('2026-09-30');
    expect(periodRange('month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('the Upcoming list looks ahead; the Received list looks back', () => {
    const { upcoming, receipts } = selectFinances(model, { period: '7d' }, TODAY);
    // Open rows of active/paused plans effective 25 Sep – 1 Oct.
    expect(upcoming.map((u) => u.occurrenceId).sort()).toEqual(['o10', 'o2', 'o3', 'o4', 'o6', 'o8', 'o9']);
    expect(receipts.every((r) => r.date >= '2026-09-19' && r.date <= '2026-09-25')).toBe(true);
  });

  it('cardRows ignores the period for Outstanding and Overdue (they are as of today)', () => {
    const a = cardRows(model, { period: 'today' }, TODAY);
    const b = cardRows(model, { period: 'all' }, TODAY);
    expect(a.outstanding.map((x) => x.key)).toEqual(b.outstanding.map((x) => x.key));
    expect(a.overdue.map((x) => x.key)).toEqual(b.overdue.map((x) => x.key));
  });
});
