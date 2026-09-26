/**
 * The overview's fine metrics, and the scoped fines rules (lib/finances/fines.ts).
 *
 * The metrics replace the header's "Fine analytics" link: "Fines issued"
 * (value, and a count) and "Fines paid", each built from the Fines list's own
 * rows — so every figure is hand-derivable from the rows below.
 *
 *   f1  Toll 75.00   issued 2026-09-01  Paid   resolved 2026-09-10T02:30Z (= 9 Sep in New York)
 *   f2  PCN  30.50   issued 2026-09-01  Open
 *   f3  PCN  12.25   issued 2026-09-05  Paid   no resolved_at, charged 2026-09-06T15:00Z
 *   f4  Toll 10.00   issued 2026-09-07  Paid   neither timestamp → its issue day
 *   f5  Toll  5.00   issued 2026-09-08  Waived
 *
 *   Fines issued        75.00 + 30.50 + 12.25 + 10.00 + 5.00 = 132.75 over 5 fines
 *     1 Sep 105.50 (2) · 5 Sep 12.25 · 7 Sep 10.00 · 8 Sep 5.00
 *   Fines paid          75.00 + 12.25 + 10.00 = 97.25 over 3 fines
 *     9 Sep 75.00 · 6 Sep 12.25 · 7 Sep 10.00
 */
import { describe, expect, it } from 'vitest';
import { FINANCE_METRIC, fineMetrics } from '@/components/finances/finances-overview';
import { fineComputed, fineMatchesSearch, fineMatchesStatus, finePaidDay, finesIssued, finesPaid, type FineRowLike, type RawFineRow } from '@/lib/finances/fines';

const TZ = 'America/New_York';
const FINES: FineRowLike[] = [
  { id: 'f1', amount: 75, issue_date: '2026-09-01', status: 'Paid', resolved_at: '2026-09-10T02:30:00Z', charged_at: '2026-09-10T02:30:00Z' },
  { id: 'f2', amount: 30.5, issue_date: '2026-09-01', status: 'Open' },
  { id: 'f3', amount: '12.25', issue_date: '2026-09-05', status: 'Paid', resolved_at: null, charged_at: '2026-09-06T15:00:00Z' },
  { id: 'f4', amount: 10, issue_date: '2026-09-07', status: 'Paid' },
  { id: 'f5', amount: 5, issue_date: '2026-09-08', status: 'Waived', resolved_at: '2026-09-09T12:00:00Z' },
];

const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);

describe('Fines issued', () => {
  it('is every fine on the list, on its issue day, in cents', () => {
    const issued = finesIssued(FINES);
    expect(issued.map((e) => [e.fineId, e.day, e.cents])).toEqual([
      ['f1', '2026-09-01', 7500],
      ['f2', '2026-09-01', 3050],
      ['f3', '2026-09-05', 1225],
      ['f4', '2026-09-07', 1000],
      ['f5', '2026-09-08', 500],
    ]);
    expect(sum(issued)).toBe(13275);
  });

  it('leaves out a fine with no issue day rather than inventing one', () => {
    expect(finesIssued([{ id: 'x', amount: 9, issue_date: null, status: 'Open' }])).toEqual([]);
  });
});

describe('Fines paid', () => {
  it('is the Paid fines, on the day each was paid, in the tenant’s zone', () => {
    const paid = finesPaid(FINES, TZ);
    expect(paid.map((e) => [e.fineId, e.day, e.cents])).toEqual([
      ['f1', '2026-09-09', 7500], // 02:30 UTC on the 10th is the 9th in New York
      ['f3', '2026-09-06', 1225], // no resolved_at: charged_at
      ['f4', '2026-09-07', 1000], // neither: the issue day
    ]);
    expect(sum(paid)).toBe(9725);
  });

  it('a waived fine is not paid', () => {
    expect(finesPaid(FINES, TZ).some((e) => e.fineId === 'f5')).toBe(false);
    expect(finePaidDay(FINES[4], TZ)).toBe('2026-09-09');
  });
});

describe('the picker’s fine metrics', () => {
  const metrics = fineMetrics(FINES, 'USD', TZ);
  const total = (key: string) => {
    const m = metrics.find((x) => x.key === key)!;
    if (m.kind !== 'flow') throw new Error('flow');
    return Math.round(m.events.reduce((s, e) => s + e.amount, 0) * 100) / 100;
  };

  it('are Fines issued (value), Fines issued (count) and Fines paid, in that order', () => {
    expect(metrics.map((m) => [m.key, m.label])).toEqual([
      [FINANCE_METRIC.finesIssued, 'Fines issued'],
      [FINANCE_METRIC.finesIssuedCount, 'Fines issued (count)'],
      [FINANCE_METRIC.finesPaid, 'Fines paid'],
    ]);
  });

  it('sum to the hand-derived figures: 132.75 issued over 5 fines, 97.25 paid', () => {
    expect(total(FINANCE_METRIC.finesIssued)).toBe(132.75);
    expect(total(FINANCE_METRIC.finesIssuedCount)).toBe(5);
    expect(total(FINANCE_METRIC.finesPaid)).toBe(97.25);
  });

  it('put each event on its calendar day at local midnight', () => {
    const paid = metrics.find((m) => m.key === FINANCE_METRIC.finesPaid)!;
    if (paid.kind !== 'flow') throw new Error('flow');
    expect(paid.events.map((e) => [e.at.getFullYear(), e.at.getMonth() + 1, e.at.getDate(), e.at.getHours()])).toEqual([
      [2026, 9, 9, 0],
      [2026, 9, 6, 0],
      [2026, 9, 7, 0],
    ]);
  });
});

describe('the scoped fines follow the fines tab’s own row rules', () => {
  // 25 Sep 2026, 18:00 UTC.
  const NOW = new Date('2026-09-25T18:00:00Z');
  const row = (over: Partial<RawFineRow>): RawFineRow => ({
    id: 'f-row',
    amount: 100,
    due_date: '2026-09-20',
    status: 'Open',
    reference_no: 'PCN-77',
    type: 'Parking',
    customers: { name: 'Ada Okafor', email: 'ada@example.com', phone: '555' },
    vehicles: { reg: 'NW-01', make: 'Kia', model: 'Rio' },
    authority_payments: [],
    ...over,
  });

  it('overdue: an Open or Charged fine past its due date; nothing else', () => {
    expect(fineComputed(row({}), NOW).isOverdue).toBe(true);
    expect(fineComputed(row({ status: 'Charged' }), NOW).isOverdue).toBe(true);
    expect(fineComputed(row({ status: 'Paid' }), NOW).isOverdue).toBe(false);
    expect(fineComputed(row({ due_date: '2026-10-01' }), NOW).isOverdue).toBe(false);
  });

  it('authority payments: settled once they reach the fine’s amount', () => {
    expect(fineComputed(row({ authority_payments: [{ amount: 40 }, { amount: '60' }] }), NOW)).toMatchObject({ hasAuthorityPayments: true, isAuthoritySettled: true });
    expect(fineComputed(row({ authority_payments: [{ amount: 40 }] }), NOW)).toMatchObject({ hasAuthorityPayments: true, isAuthoritySettled: false });
    expect(fineComputed(row({}), NOW)).toMatchObject({ hasAuthorityPayments: false, isAuthoritySettled: false });
  });

  it('search: reference, type, vehicle and customer, as the fines tab searches', () => {
    for (const q of ['pcn-77', 'park', 'nw-01', 'kia', 'ada', 'example.com']) expect(fineMatchesSearch(row({}), q), q).toBe(true);
    expect(fineMatchesSearch(row({}), 'zzz')).toBe(false);
    expect(fineMatchesSearch(row({}), '   ')).toBe(true);
  });

  it('status chips: a stored status, or the two quick filters', () => {
    expect(fineMatchesStatus(row({ status: 'Paid' }), 'Paid', NOW)).toBe(true);
    expect(fineMatchesStatus(row({ status: 'Paid' }), 'Open', NOW)).toBe(false);
    expect(fineMatchesStatus(row({}), 'overdue', NOW)).toBe(true);
    expect(fineMatchesStatus(row({ status: 'Waived' }), 'overdue', NOW)).toBe(false);
    expect(fineMatchesStatus(row({ due_date: '2026-09-30' }), 'due_next_7', NOW)).toBe(true);
    expect(fineMatchesStatus(row({ due_date: '2026-10-05' }), 'due_next_7', NOW)).toBe(false);
    expect(fineMatchesStatus(row({}), null, NOW)).toBe(true);
  });
});
