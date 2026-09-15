/**
 * The hero-tab graph numbers (lib/hero-series.ts).
 *
 * Every expected value below was worked out by hand from the fixture, not
 * produced by running the code: a chart that passes against numbers the code
 * computed for itself proves nothing.
 *
 * "Today" is Tue 15 Sep 2026, 14:00 local, unless a test says otherwise.
 */
import { describe, expect, it } from 'vitest';
import { flowSeries, stockSeries } from '@/lib/hero-series';

const TODAY = new Date(2026, 8, 15, 14, 0);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0);

describe('flowSeries — last 7 days against the 7 before', () => {
  // Current window: Sep 9 .. Sep 15. Previous: Sep 2 .. Sep 8.
  const events = [
    { at: at(2026, 9, 9, 10), amount: 100 }, // first day of the current window
    { at: at(2026, 9, 15, 9), amount: 50 }, // today, earlier than "now"
    { at: at(2026, 9, 8, 23), amount: 20 }, // last day of the previous window
    { at: at(2026, 9, 1), amount: 999 }, // before both windows
    { at: at(2026, 9, 16), amount: 5 }, // tomorrow: not history yet
    { at: new Date('not a date'), amount: 7 }, // unparseable
  ];
  const s = flowSeries(events, '7d', TODAY);

  it('has seven running-total points', () => {
    expect(s.points.map((p) => p.current)).toEqual([100, 100, 100, 100, 100, 100, 150]);
    expect(s.points.map((p) => p.previous)).toEqual([0, 0, 0, 0, 0, 0, 20]);
  });

  it('headlines the two window totals', () => {
    expect(s.currentTotal).toBe(150);
    expect(s.previousTotal).toBe(20);
  });

  it('labels each point with its own day in each window', () => {
    expect(s.points[0].currentLabel).toBe('Sep 9');
    expect(s.points[0].previousLabel).toBe('Sep 2');
    expect(s.points[6].currentLabel).toBe('Sep 15');
    expect(s.startLabel).toBe('Sep 9');
    expect(s.endLabel).toBe('Today');
  });
});

describe('flowSeries — counts, and a daylight-saving change', () => {
  it('counts bookings one each', () => {
    const s = flowSeries([{ at: at(2026, 9, 14), amount: 1 }, { at: at(2026, 9, 14, 18), amount: 1 }], '7d', TODAY);
    expect(s.currentTotal).toBe(2);
    expect(s.points[5].current).toBe(2); // Sep 14 is index 5
    expect(s.points[4].current).toBe(0);
  });

  it('keeps events on their calendar day across the US clocks-back night (Nov 1 2026)', () => {
    // Today Tue Nov 3 2026 → current window Oct 28 .. Nov 3.
    const today = new Date(2026, 10, 3, 9, 0);
    const s = flowSeries(
      [
        { at: new Date(2026, 9, 31, 23, 30), amount: 1 }, // index 3
        { at: new Date(2026, 10, 1, 0, 30), amount: 1 }, // index 4
        { at: new Date(2026, 10, 2, 0, 5), amount: 1 }, // index 5
      ],
      '7d',
      today,
    );
    expect(s.points.map((p) => p.current)).toEqual([0, 0, 0, 1, 2, 3, 3]);
  });
});

describe('flowSeries — 3 months in weeks', () => {
  // 13 weeks = 91 days ending today: Jun 17 .. Sep 15 2026. Previous: Mar 18 .. Jun 16.
  it('places days into 7-day buckets from the window start', () => {
    const s = flowSeries(
      [
        { at: at(2026, 6, 17), amount: 1 }, // current bucket 0
        { at: at(2026, 9, 10), amount: 1 }, // current bucket 12 (Sep 9 .. Sep 15)
        { at: at(2026, 6, 16), amount: 1 }, // previous bucket 12 (90 days after Mar 18)
        { at: at(2026, 3, 18), amount: 1 }, // previous bucket 0
      ],
      '3m',
      TODAY,
    );
    expect(s.points[0].current).toBe(1);
    expect(s.points[11].current).toBe(1);
    expect(s.points[12].current).toBe(2);
    expect(s.points[0].previous).toBe(1);
    expect(s.points[11].previous).toBe(1);
    expect(s.points[12].previous).toBe(2);
    expect(s.points[12].currentLabel).toBe('Sep 9 – Sep 15');
    expect(s.startLabel).toBe('Jun 17');
  });
});

describe('flowSeries — 12 months', () => {
  // Current: Oct 2025 .. Sep 2026. Previous: Oct 2024 .. Sep 2025.
  it('puts month edges on the right side of the window boundary', () => {
    const s = flowSeries(
      [
        { at: at(2025, 10, 1, 0), amount: 10 }, // current index 0
        { at: at(2025, 9, 30, 23), amount: 20 }, // previous index 11
        { at: at(2024, 10, 1), amount: 30 }, // previous index 0
        { at: at(2024, 9, 30), amount: 40 }, // before both
      ],
      '12m',
      TODAY,
    );
    expect(s.currentTotal).toBe(10);
    expect(s.previousTotal).toBe(50);
    expect(s.points[0].current).toBe(10);
    expect(s.points[0].previous).toBe(30);
    expect(s.points[10].previous).toBe(30);
    expect(s.points[11].previous).toBe(50);
    expect(s.points[0].currentLabel).toBe('Oct 2025');
    expect(s.points[11].currentLabel).toBe('Sep 2026');
  });
});

describe('stockSeries', () => {
  const dayOfMonth = (d: Date) => d.getDate();

  it('samples the last day of each daily bucket, and today last', () => {
    const s = stockSeries(dayOfMonth, '7d', TODAY);
    expect(s.points.map((p) => p.current)).toEqual([9, 10, 11, 12, 13, 14, 15]);
    expect(s.points.map((p) => p.previous)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(s.currentTotal).toBe(15);
    expect(s.previousTotal).toBe(8);
  });

  it('samples month ends, but never past today', () => {
    const s = stockSeries(dayOfMonth, '12m', TODAY);
    expect(s.points[0].current).toBe(31); // Oct 31 2025
    expect(s.points[4].current).toBe(28); // Feb 28 2026
    expect(s.points[11].current).toBe(15); // Sep 2026 is sampled today, the 15th
    expect(s.points[11].previous).toBe(30); // Sep 30 2025
  });

  it('treats a non-number level as zero', () => {
    const s = stockSeries(() => Number.NaN, '7d', TODAY);
    expect(s.currentTotal).toBe(0);
  });
});
