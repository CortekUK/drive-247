/**
 * The chart series. Every figure is hand-derived beside it, and every series
 * is also checked against the headline stat it sits under: a chart may never
 * disagree with its number.
 */
import { describe, expect, it } from 'vitest';
import { buildFinanceModel } from '@/lib/finances/model';
import { cardRows, selectFinances } from '@/lib/finances/filters';
import { ageingKey, collectedSeries, outstandingAgeing, upcomingSeries } from '@/lib/finances/series';
import type { FinanceFilters } from '@/lib/finances/types';
import { charge, CTX, emptyRaw, rental, tenantFixture, TODAY } from '../helpers/finances-fixture';

const month: FinanceFilters = { period: 'month' };
const nonZero = <T extends { collectedCents?: number; refundedCents?: number; count?: number; cents?: number }>(xs: T[]) =>
  xs.filter((x) => (x.collectedCents ?? 0) !== 0 || (x.refundedCents ?? 0) !== 0 || (x.count ?? 0) !== 0 || (x.cents ?? 0) !== 0);

describe('collectedSeries', () => {
  const model = buildFinanceModel(tenantFixture(), CTX);

  it('this month, by day: 30 days, the collected days by hand', () => {
    const { series, stats } = selectFinances(model, month, TODAY);
    const c = series.collected;
    expect(c.bucket).toBe('day');
    expect(c.points).toHaveLength(30);
    expect([c.points[0].start, c.points[29].end]).toEqual(['2026-09-01', '2026-09-30']);
    // p8 1000 on 1 Sep · p1 20000 on 20 Sep · p2 10000 − 4000 = 6000 (refund 4000) on 21 Sep · p7 6000 today.
    expect(nonZero(c.points).map((p) => [p.start, p.collectedCents, p.refundedCents, p.count])).toEqual([
      ['2026-09-01', 1000, 0, 1],
      ['2026-09-20', 20000, 0, 1],
      ['2026-09-21', 6000, 4000, 1],
      ['2026-09-25', 6000, 0, 1],
    ]);
    expect([c.totalCollectedCents, c.totalRefundedCents, c.totalCount]).toEqual([stats.collectedCents, stats.refundedCents, stats.collectedCount]);
    expect(c.points.reduce((s, p) => s + p.collectedCents, 0)).toBe(stats.collectedCents);
    expect(c.points.reduce((s, p) => s + p.refundedCents, 0)).toBe(stats.refundedCents);
  });

  it('over 31 days it is drawn in Monday-start weeks, clipped to the period', () => {
    const period = { from: '2026-07-01', to: '2026-09-25' }; // 87 days, 1 Jul is a Wednesday
    const rows = cardRows(model, { period }, TODAY).collected;
    const c = collectedSeries(rows, period, TODAY);
    expect(c.bucket).toBe('week');
    expect(c.points).toHaveLength(13);
    expect([c.points[0].start, c.points[0].end]).toEqual(['2026-07-01', '2026-07-05']);
    expect([c.points[12].start, c.points[12].end]).toEqual(['2026-09-21', '2026-09-25']);
    // Week of 31 Aug: p5 8000 (31 Aug) + p8 1000 (1 Sep). Week of 14 Sep: p1 20000 (Sun 20th).
    // Week of 21 Sep: p2 6000 (refund 4000) + p7 6000.
    expect(nonZero(c.points).map((p) => [p.start, p.end, p.collectedCents, p.refundedCents, p.count])).toEqual([
      ['2026-08-31', '2026-09-06', 9000, 0, 2],
      ['2026-09-14', '2026-09-20', 20000, 0, 1],
      ['2026-09-21', '2026-09-25', 12000, 4000, 2],
    ]);
    expect(c.totalCollectedCents).toBe(selectFinances(model, { period }, TODAY).stats.collectedCents);
    expect(c.totalCollectedCents).toBe(41000);
  });

  it("'all' spans the first collected day to today", () => {
    const { series, stats } = selectFinances(model, { period: 'all' }, TODAY);
    expect(series.collected.bucket).toBe('day'); // 31 Aug → 25 Sep = 26 days
    expect(series.collected.points[0].start).toBe('2026-08-31');
    expect(series.collected.points.at(-1)!.end).toBe(TODAY);
    expect(series.collected.totalCollectedCents).toBe(stats.collectedCents);
    expect(stats.collectedCents).toBe(41000); // 33000 + p5 8000
  });

  it('nothing collected in an unbounded period draws nothing', () => {
    expect(collectedSeries([], 'all', TODAY)).toEqual({ bucket: 'day', points: [], totalCollectedCents: 0, totalRefundedCents: 0, totalCount: 0 });
  });
});

describe('outstandingAgeing', () => {
  it('the tenant fixture, by hand — sums to Outstanding, non-current sums to Overdue', () => {
    const { series, stats } = selectFinances(buildFinanceModel(tenantFixture(), CTX), month, TODAY);
    // current: PAYG accrual 11100 + fine due 30 Sep 6500 − undated adjustment 1000 = 16600
    // 1–30:   r1 30000 + 3000 (15 days late) + no-rental fine 4000 (24 days late) = 37000
    expect(series.ageing.buckets.map((b) => [b.key, b.label, b.cents])).toEqual([
      ['current', 'Current', 16600],
      ['d1_30', '1–30 days', 37000],
      ['d31_60', '31–60 days', 0],
      ['d60_plus', 'Over 60 days', 0],
    ]);
    expect(series.ageing.totalCents).toBe(stats.outstandingCents);
    expect(series.ageing.overdueCents).toBe(stats.overdueCents);
    expect([stats.outstandingCents, stats.overdueCents]).toEqual([53600, 37000]);
  });

  it('bucket edges: 30 days late is 1–30, 31 and 60 are 31–60, 61 is over 60, due today is current', () => {
    expect(['2026-09-25', '2026-08-26', '2026-08-25', '2026-07-27', '2026-07-26', null].map((d) => ageingKey(d, TODAY))).toEqual([
      'current',
      'd1_30',
      'd31_60',
      'd31_60',
      'd60_plus',
      'current',
    ]);
  });

  it('holds both sums even for a bill that is overdue but nets to nothing outstanding', () => {
    const raw = emptyRaw();
    raw.rentals = [rental('ra', 'ca'), rental('r9', 'c9')];
    raw.charges = [
      charge('e0', 'ra', 'ca', 'Tax', 500.0, 500.0, '2026-09-25'), // due today: current
      charge('e1', 'ra', 'ca', 'Tax', 100.0, 100.0, '2026-08-26'), // 30 late
      charge('e2', 'ra', 'ca', 'Tax', 200.0, 200.0, '2026-08-25'), // 31 late
      charge('e3', 'ra', 'ca', 'Tax', 300.0, 300.0, '2026-07-27'), // 60 late
      charge('e4', 'ra', 'ca', 'Tax', 400.0, 400.0, '2026-07-26'), // 61 late
      charge('e5', 'r9', 'c9', 'Tax', 20.0, 20.0, '2026-09-01'), // 24 late …
      charge('e6', 'r9', 'c9', 'Adjustment', -20.0, -20.0, null), // … netted by an undated credit
    ];
    const { series, stats } = selectFinances(buildFinanceModel(raw, CTX), { period: 'all' }, TODAY);
    // current 50000 − 2000 = 48000 · 1–30: 10000 + 2000 = 12000 · 31–60: 20000 + 30000 = 50000 · over 60: 40000
    expect(series.ageing.buckets.map((b) => b.cents)).toEqual([48000, 12000, 50000, 40000]);
    expect([stats.outstandingCents, stats.overdueCents]).toEqual([150000, 102000]);
    expect(series.ageing.totalCents).toBe(stats.outstandingCents);
    expect(series.ageing.overdueCents).toBe(stats.overdueCents);
  });

  it('counts each bill once, whichever card lists it', () => {
    const rows = cardRows(buildFinanceModel(tenantFixture(), CTX), month, TODAY);
    expect(outstandingAgeing([...rows.outstanding, ...rows.overdue, ...rows.overdue], TODAY).totalCents).toBe(53600);
  });
});

describe('upcomingSeries', () => {
  it('seven days from today, by hand, split by collection method', () => {
    const { series, stats } = selectFinances(buildFinanceModel(tenantFixture(), CTX), month, TODAY);
    const u = series.upcoming;
    expect(u.days.map((d) => d.date)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
    // o2 10000 auto today · o6 10000 auto on its retry day (27th) · o3 10000 link (28th) · o4 6000 manual (1 Oct).
    expect(u.days.map((d) => [d.cents, d.count, d.auto.cents, d.link.cents, d.manual.cents])).toEqual([
      [10000, 1, 10000, 0, 0],
      [0, 0, 0, 0, 0],
      [10000, 1, 10000, 0, 0],
      [10000, 1, 0, 10000, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [6000, 1, 0, 0, 6000],
    ]);
    expect([u.totalCents, u.totalCount]).toEqual([stats.upcomingCents, stats.upcomingCount]);
    expect(u.days.reduce((s, d) => s + d.auto.count, 0)).toBe(stats.upcomingAuto);
    expect(u.days.reduce((s, d) => s + d.link.count, 0)).toBe(stats.upcomingLinks);
  });

  it('is seven empty days when nothing is coming', () => {
    const u = upcomingSeries([], TODAY);
    expect(u.days).toHaveLength(7);
    expect([u.totalCents, u.totalCount]).toEqual([0, 0]);
  });
});

describe('the series follow the filter bar with their numbers', () => {
  it("a customer search narrows each chart and its stat together", () => {
    const { series, stats } = selectFinances(buildFinanceModel(tenantFixture(), CTX), { ...month, search: 'ada' }, TODAY);
    expect(series.collected.totalCollectedCents).toBe(stats.collectedCents);
    expect(series.ageing.totalCents).toBe(stats.outstandingCents);
    expect(series.ageing.overdueCents).toBe(stats.overdueCents);
    expect(series.upcoming.totalCents).toBe(stats.upcomingCents);
    expect(stats.collectedCents).toBe(27000);
  });
});
