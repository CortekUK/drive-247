/**
 * Finances — the pure parts of the screen: the URL state, the action gates,
 * the sums the footer writes out, and the export.
 *
 * Every expected figure below is worked out by hand from the design's own
 * fixture (docs/FINANCES_DESIGN.md §3.1), never produced by the code under
 * test: R1's booking bill is $550.00 total, $530.00 paid, $20.00 credited,
 * $0.00 balance; its extension bill is $200.00 owed; the drift bill is $100.00
 * charged, nothing paid, and a ledger balance of $0.00.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@/lib/finances/types';
import { DRIFT, R1_BOOKING, R1_EXTENSION, receipt, upcoming } from '../helpers/finances-ui-fixtures';

// The side panel and the fines view import the Supabase client; nothing here reads it.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {}, supabaseUntyped: {} }));
import {
  DEFAULT_STATE,
  financesQuery,
  isFiltered,
  modelFiltersOf,
  parseFinancesUrl,
  patchFinancesState,
} from '@/components/finances/finances-url';
import {
  canCollectOnBill,
  canRefund,
  canRemoveLink,
  canReverse,
  canReview,
  listSum,
  refundCategoryOf,
} from '@/components/finances/finance-rules';
import { attentionFixes } from '@/components/finances/needs-attention';
import { paymentMathText } from '@/components/finances/finance-side-panel';
import { fineFiltersOf } from '@/components/finances/fines-view';
import { financesCsv } from '@/components/finances/finances-export';
import { ageingToDraw, collectedMetrics } from '@/components/finances/finances-overview';
import { countActiveFinanceFilters } from '@/components/finances/finances-filter-panel';
import { receiptMethodWords, upcomingStatusWords } from '@/components/finances/finance-words';

/* ── the URL ─────────────────────────────────────────────────────────────── */

describe('URL state', () => {
  it('opens on Billed, this month, nothing filtered', () => {
    expect(parseFinancesUrl(new URLSearchParams(''))).toEqual(DEFAULT_STATE);
    expect(isFiltered(DEFAULT_STATE)).toBe(false);
  });

  it('reads every part back, and a bill key keeps its colons', () => {
    const s = parseFinancesUrl(
      new URLSearchParams('view=received&q=smith&status=pending_review&method=Cash&period=7d&card=collected&panel=bill:r1:ext:e1'),
    );
    expect(s).toMatchObject({ view: 'received', q: 'smith', status: 'pending_review', method: 'Cash', period: '7d', card: 'collected' });
    expect(s.panel).toEqual({ kind: 'bill', id: 'r1:ext:e1' });
    expect(parseFinancesUrl(new URLSearchParams('panel=payments:a,b')).panel).toEqual({ kind: 'payments', ids: ['a', 'b'] });
  });

  it('falls back on anything it does not recognise, rather than throwing', () => {
    const s = parseFinancesUrl(new URLSearchParams('view=ledger&period=forever&card=profit&panel=nonsense'));
    expect(s.view).toBe('billed');
    expect(s.period).toBe('month');
    expect(s.card).toBeNull();
    expect(s.panel).toBeNull();
    // A custom range needs both days, well formed.
    expect(parseFinancesUrl(new URLSearchParams('period=custom&from=2026-09-01')).period).toBe('month');
    expect(parseFinancesUrl(new URLSearchParams('period=custom&from=2026-09-01&to=2026-09-15'))).toMatchObject({
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it('writes only what was chosen, and round-trips', () => {
    expect(financesQuery(DEFAULT_STATE)).toBe('view=billed');
    const s = { ...DEFAULT_STATE, view: 'received' as const, q: 'pi_3P', card: 'collected' as const, panel: { kind: 'payment' as const, id: 'p1' } };
    const q = financesQuery(s);
    expect(parseFinancesUrl(new URLSearchParams(q))).toEqual(s);
  });

  it('a card moves to the view its rows live in', () => {
    expect(patchFinancesState(DEFAULT_STATE, { card: 'collected' })).toMatchObject({ view: 'received', card: 'collected' });
    expect(patchFinancesState(DEFAULT_STATE, { card: 'upcoming' })).toMatchObject({ view: 'upcoming', card: 'upcoming' });
    expect(patchFinancesState({ ...DEFAULT_STATE, view: 'received' }, { card: 'overdue' })).toMatchObject({ view: 'billed' });
  });

  it("switching view drops the other view's status, method, card and panel", () => {
    const s = { ...DEFAULT_STATE, view: 'received' as const, status: 'pending_review', method: 'Cash', card: 'collected' as const, panel: { kind: 'payment' as const, id: 'p1' } };
    expect(patchFinancesState(s, { view: 'billed' })).toMatchObject({ view: 'billed', status: null, method: null, card: null, panel: null });
    // …but a search is shared by every view.
    expect(patchFinancesState({ ...s, q: 'smith' }, { view: 'billed' }).q).toBe('smith');
  });

  it('hands the model exactly the filters on screen', () => {
    const s = parseFinancesUrl(new URLSearchParams('view=received&q=%20smith%20&status=rejected&method=stripe&period=custom&from=2026-09-01&to=2026-09-15'));
    expect(modelFiltersOf(s)).toEqual({
      search: 'smith',
      statuses: ['rejected'],
      methods: ['stripe'],
      period: { from: '2026-09-01', to: '2026-09-15' },
      card: null,
    });
    expect(modelFiltersOf(DEFAULT_STATE)).toEqual({ search: undefined, statuses: undefined, methods: undefined, period: 'month', card: null });
  });
});

/* ── which actions a row offers ──────────────────────────────────────────── */

describe('row actions mirror the screens that offered them before', () => {
  it('review only while awaiting review', () => {
    expect(canReview(receipt({ paymentId: 'a', status: 'pending_review' }))).toBe(true);
    expect(canReview(receipt({ paymentId: 'b', status: 'pending_review', rawStatus: 'Reversed' }))).toBe(false);
    expect(canReview(receipt({ paymentId: 'c' }))).toBe(false);
  });

  it('refund money that landed on a rental, up to what is left', () => {
    expect(canRefund(receipt({ paymentId: 'a' }))).toBe(true);
    expect(canRefund(receipt({ paymentId: 'b', refundedCents: 53000 }))).toBe(false);
    expect(canRefund(receipt({ paymentId: 'c', rentalId: null }))).toBe(false);
    expect(canRefund(receipt({ paymentId: 'd', countsAsReceived: false }))).toBe(false);
  });

  it('remove only an unpaid Stripe checkout link', () => {
    const link = receipt({ paymentId: 'l', countsAsReceived: false, status: 'pending', checkoutSessionId: 'cs_live_abc', verificationStatus: 'pending', rawStatus: 'Pending' });
    expect(canRemoveLink(link)).toBe(true);
    expect(canRemoveLink({ ...link, paymentType: 'InitialFee' })).toBe(false);
    expect(canRemoveLink({ ...link, countsAsReceived: true })).toBe(false);
    // An unpaid link is removed, never reversed — reversing would leave it payable.
    expect(canReverse({ ...link, provider: 'manual' })).toBe(false);
  });

  it('reverse only a payment recorded by hand', () => {
    const cash = receipt({ paymentId: 'm', provider: 'manual', providerRef: null, method: 'Cash' });
    expect(canReverse(cash)).toBe(true);
    expect(canReverse(receipt({ paymentId: 's' }))).toBe(false);
    expect(canReverse(receipt({ paymentId: 'q', provider: 'square' }))).toBe(false);
    expect(canReverse({ ...cash, refundedCents: 100 })).toBe(false);
    expect(canReverse({ ...cash, rawStatus: 'Reversed' })).toBe(false);
  });

  it('refunds the category most of the money went to', () => {
    expect(refundCategoryOf(receipt({ paymentId: 'a' }))).toBe('Rental');
    expect(refundCategoryOf(receipt({ paymentId: 'b', appliedTo: [] }))).toBe('Rental');
    expect(
      refundCategoryOf(
        receipt({
          paymentId: 'c',
          appliedTo: [
            { chargeId: 'x', category: 'Fine', rentalRef: null, amountCents: 3000 },
            { chargeId: 'y', category: 'Tax', rentalRef: null, amountCents: 1000 },
            { chargeId: 'z', category: 'Fine', rentalRef: null, amountCents: 500 },
          ],
        }),
      ),
    ).toBe('Fine');
  });

  it('collects on a bill with money owed, never on one billed day by day or closed', () => {
    expect(canCollectOnBill(R1_EXTENSION)).toBe(true);
    expect(canCollectOnBill(R1_BOOKING)).toBe(false);
    expect(canCollectOnBill({ ...R1_EXTENSION, isPayg: true })).toBe(false);
    expect(canCollectOnBill({ ...R1_EXTENSION, excludedReason: 'cancelled' })).toBe(false);
    expect(canCollectOnBill({ ...R1_EXTENSION, onRental: false, rentalId: '' })).toBe(false);
  });
});

/* ── the footer's sums (hand-derived) ────────────────────────────────────── */

describe('the sum under the list rebuilds the card from its rows', () => {
  const bills = [R1_BOOKING, R1_EXTENSION, DRIFT];

  it('Outstanding: 0 + 200.00 + 0 = 200.00', () => {
    expect(listSum('billed', 'outstanding', { bills })).toEqual({ label: 'Outstanding on these bills', cents: 20000 });
  });

  it('Overdue: only the extension, 200.00', () => {
    expect(listSum('billed', 'overdue', { bills }).cents).toBe(20000);
  });

  it('no card: the balances, 0 + 200.00 + 0', () => {
    expect(listSum('billed', null, { bills })).toEqual({ label: 'Balance across these bills', cents: 20000 });
  });

  it('Collected: what landed, less refunds; a link that was never paid adds nothing', () => {
    const rows = [
      receipt({ paymentId: 'a', amountCents: 53000, netCents: 53000 }),
      receipt({ paymentId: 'b', amountCents: 10000, refundedCents: 2500, netCents: 7500 }),
      receipt({ paymentId: 'c', amountCents: 9999, netCents: 9999, countsAsReceived: false, status: 'pending' }),
    ];
    expect(listSum('received', 'collected', { receipts: rows }).cents).toBe(60500);
  });

  it('Upcoming: the payments still to come', () => {
    const rows = [upcoming({ occurrenceId: 'o1' }), upcoming({ occurrenceId: 'o2', amountCents: 12345 })];
    expect(listSum('upcoming', 'upcoming', { upcoming: rows })).toEqual({ label: 'Due in the next 7 days', cents: 32345 });
  });
});

describe('the payment sentence is written only when it is true', () => {
  it('530.00 received = 500.00 + 30.00 applied', () => {
    expect(paymentMathText(receipt({ paymentId: 'a' }), 'USD')).toBe('$530.00 received = $530.00 applied');
  });

  it('with a refund and money not applied', () => {
    const r = receipt({
      paymentId: 'b',
      amountCents: 60000,
      refundedCents: 5000,
      unappliedCents: 2000,
    });
    // 600.00 − 50.00 = 530.00 applied + 20.00 not applied
    expect(paymentMathText(r, 'USD')).toBe('$600.00 received − $50.00 refunded = $530.00 applied + $20.00 not applied');
  });

  it('says nothing when the figures do not add up, or no money landed', () => {
    expect(paymentMathText(receipt({ paymentId: 'c', amountCents: 99999 }), 'USD')).toBeNull();
    expect(paymentMathText(receipt({ paymentId: 'd', countsAsReceived: false }), 'USD')).toBeNull();
  });
});

/* ── Needs attention's fixes ─────────────────────────────────────────────── */

const item = (over: Partial<AttentionItem> & Pick<AttentionItem, 'kind'>): AttentionItem => ({
  key: `${over.kind}-1`,
  title: 'x',
  detail: '',
  amountCents: 20000,
  rentalId: 'r1',
  customerId: 'c1',
  paymentIds: [],
  occurrenceId: null,
  ...over,
});
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('each attention item offers its own fixes (design §4)', () => {
  const all = { payments: true, plans: true };
  const none = { payments: false, plans: false };

  it('card declined: send link, retry, record payment', () => {
    expect(ids(attentionFixes(item({ kind: 'card_declined', occurrenceId: 'o1' }), all))).toEqual(['send_link', 'retry', 'record_payment']);
  });

  it('needs the customer: send link, record payment — no retry', () => {
    expect(ids(attentionFixes(item({ kind: 'needs_customer', occurrenceId: 'o1' }), all))).toEqual(['send_link', 'record_payment']);
  });

  it('awaiting review: approve, reject, details', () => {
    expect(ids(attentionFixes(item({ kind: 'awaiting_review', paymentIds: ['p9'] }), all))).toEqual(['approve', 'reject', 'open_payment']);
  });

  it('possible duplicate: review them side by side', () => {
    expect(ids(attentionFixes(item({ kind: 'possible_duplicate', paymentIds: ['p1', 'p2'] }), all))).toEqual(['review']);
  });

  it('unapplied credit: open the rental and the customer', () => {
    expect(ids(attentionFixes(item({ kind: 'unapplied_credit', paymentIds: ['p1'] }), all))).toEqual(['open_customer', 'open_rental']);
  });

  it('read-only: no money-moving fix, only ways to look', () => {
    expect(attentionFixes(item({ kind: 'card_declined', occurrenceId: 'o1' }), none)).toEqual([]);
    expect(ids(attentionFixes(item({ kind: 'awaiting_review', paymentIds: ['p9'] }), none))).toEqual(['open_payment']);
    expect(ids(attentionFixes(item({ kind: 'possible_duplicate', paymentIds: ['p1', 'p2'] }), none))).toEqual(['review']);
  });
});

/* ── words, filters, export ──────────────────────────────────────────────── */

describe('plain words', () => {
  it('names the processor, or the method as recorded', () => {
    expect(receiptMethodWords({ provider: 'stripe', method: 'card' })).toBe('Stripe');
    expect(receiptMethodWords({ provider: 'square', method: null })).toBe('Square');
    expect(receiptMethodWords({ provider: 'manual', method: 'bank_transfer' })).toBe('Bank Transfer');
    expect(receiptMethodWords({ provider: 'manual', method: null })).toBe('Recorded by hand');
  });

  it('a paused plan says so before anything else', () => {
    expect(upcomingStatusWords({ status: 'scheduled', nextAttemptOn: null, planStatus: 'paused' }).label).toBe('Plan paused');
    expect(upcomingStatusWords({ status: 'failed', nextAttemptOn: null, planStatus: 'active' })).toEqual({ label: 'Declined', tone: 'danger' });
  });

  it('never says PAYG, installment or FIFO', async () => {
    const words = await import('@/components/finances/finance-words');
    const text = JSON.stringify(words);
    expect(text).not.toMatch(/payg|installment|fifo/i);
  });
});

describe('the overview: the owed card draws the model’s ageing, and never restates it', () => {
  const ageing = (current: number, d1_30: number, d31_60: number, d60_plus: number) => ({
    buckets: [
      { key: 'current' as const, label: 'Current', cents: current },
      { key: 'd1_30' as const, label: '1–30 days', cents: d1_30 },
      { key: 'd31_60' as const, label: '31–60 days', cents: d31_60 },
      { key: 'd60_plus' as const, label: 'Over 60 days', cents: d60_plus },
    ],
    totalCents: current + d1_30 + d31_60 + d60_plus,
    overdueCents: d1_30 + d31_60 + d60_plus,
  });

  it('draws the groups when they add back up to Outstanding and Overdue', () => {
    // R1 on 25 Sep: the extension's 200.00 is 15 days late; the booking nets to 0.
    const drawn = ageingToDraw(ageing(0, 20000, 0, 0), { outstandingCents: 20000, overdueCents: 20000 });
    expect(drawn?.map((b) => [b.key, b.cents])).toEqual([
      ['current', 0],
      ['d1_30', 20000],
      ['d31_60', 0],
      ['d60_plus', 0],
    ]);
  });

  it('draws nothing when they would not — a bar that disagrees with its figure is a second definition', () => {
    expect(ageingToDraw(ageing(0, 20000, 0, 0), { outstandingCents: 20001, overdueCents: 20000 })).toBeNull();
    expect(ageingToDraw(ageing(20000, 0, 0, 0), { outstandingCents: 20000, overdueCents: 20000 })).toBeNull();
    expect(ageingToDraw(undefined, { outstandingCents: 0, overdueCents: 0 })).toBeNull();
  });

  it('the graph is Collected, net of refunds, with the gross as the second line', () => {
    const rows = [
      receipt({ paymentId: 'a', date: '2026-09-20', amountCents: 53000, netCents: 53000 }),
      receipt({ paymentId: 'b', date: '2026-09-21', amountCents: 10000, refundedCents: 2500, netCents: 7500 }),
    ];
    const [collected, count] = collectedMetrics(rows, 'USD');
    expect(collected.key).toBe('collected');
    expect(collected.kind).toBe('flow');
    if (collected.kind !== 'flow' || !collected.secondary) throw new Error('flow with a second line');
    expect(collected.events.map((e) => e.amount)).toEqual([530, 75]);
    expect(collected.secondary.events.map((e) => e.amount)).toEqual([530, 100]);
    // Each on the calendar day it was paid, at local midnight.
    expect(collected.events[0].at.getFullYear()).toBe(2026);
    expect(collected.events[0].at.getMonth()).toBe(8);
    expect(collected.events[0].at.getDate()).toBe(20);
    if (count.kind !== 'flow') throw new Error('flow');
    expect(count.events.map((e) => e.amount)).toEqual([1, 1]);
  });
});

describe('the filter panel counts what narrows the list', () => {
  it('status, method, a figure and a period other than this month; never the search', () => {
    expect(countActiveFinanceFilters(DEFAULT_STATE)).toBe(0);
    expect(countActiveFinanceFilters({ ...DEFAULT_STATE, status: 'open', method: 'Cash', card: 'overdue', period: '7d' })).toBe(4);
    expect(countActiveFinanceFilters({ ...DEFAULT_STATE, q: 'smith' } as typeof DEFAULT_STATE)).toBe(0);
  });
});

describe('the Fines view reads the fines tab its own way', () => {
  it('turns the shared search and status into the fines filters', () => {
    expect(fineFiltersOf(' ABC ', 'Open')).toEqual({ status: ['Open'], vehicleSearch: '', customerSearch: '', search: 'ABC', quickFilter: undefined });
    expect(fineFiltersOf('', 'overdue')).toMatchObject({ status: [], quickFilter: 'overdue' });
  });
});

describe('export', () => {
  it('writes the bills in dollars, and says when one does not add up', () => {
    const csv = financesCsv('billed', 'USD', { bills: [R1_BOOKING, DRIFT] });
    const at = (col: string) => csv.header.indexOf(col);
    expect(csv.rows[0][at('Total')]).toBe(550);
    expect(csv.rows[0][at('Paid')]).toBe(530);
    expect(csv.rows[0][at('Credited')]).toBe(20);
    expect(csv.rows[0][at('Adds up')]).toBe('Yes');
    expect(csv.rows[1][at('Adds up')]).toBe('No, by 100');
  });
});
