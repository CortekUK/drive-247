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
  // Current: Oct 1 2025 .. today, Sep 15 2026. Its last month is only half gone,
  // so the previous window, Oct 1 2024 .., stops on the matching day: Sep 15 2025.
  it('puts month edges on the right side of the window boundary', () => {
    const s = flowSeries(
      [
        { at: at(2025, 10, 1, 0), amount: 10 }, // current index 0
        { at: at(2026, 9, 15, 9), amount: 5 }, // current index 11, today
        { at: at(2025, 9, 15, 23), amount: 20 }, // previous index 11: the matching day counts
        { at: at(2025, 9, 16, 0), amount: 25 }, // the day after it: no counterpart yet, counts nowhere
        { at: at(2025, 9, 30, 23), amount: 35 }, // counts nowhere
        { at: at(2024, 10, 1), amount: 30 }, // previous index 0
        { at: at(2024, 9, 30), amount: 40 }, // before both
      ],
      '12m',
      TODAY,
    );
    expect(s.currentTotal).toBe(15);
    expect(s.previousTotal).toBe(50);
    expect(s.points[0].current).toBe(10);
    expect(s.points[0].previous).toBe(30);
    expect(s.points[10].current).toBe(10);
    expect(s.points[10].previous).toBe(30);
    expect(s.points[11].current).toBe(15);
    expect(s.points[11].previous).toBe(50);
  });

  it('labels whole months by name and the month under way by its real days', () => {
    const s = flowSeries([], '12m', TODAY);
    expect(s.points[0].currentLabel).toBe('Oct 2025');
    expect(s.points[0].previousLabel).toBe('Oct 2024');
    expect(s.points[10].currentLabel).toBe('Aug 2026');
    expect(s.points[11].currentLabel).toBe('Sep 1 – Sep 15, 2026');
    expect(s.points[11].previousLabel).toBe('Sep 1 – Sep 15, 2025');
    expect(s.startLabel).toBe('Oct 2025');
  });

  // One customer at noon every day from Sep 16 2024 to Sep 15 2026.
  const steady: { at: Date; amount: number }[] = [];
  for (let d = at(2024, 9, 16); d <= at(2026, 9, 15); d = at(d.getFullYear(), d.getMonth() + 1, d.getDate() + 1)) {
    steady.push({ at: d, amount: 1 });
  }

  it('reads a steady business as steady: equal stretches of calendar on both lines', () => {
    // Oct 31 + Nov 30 + Dec 31 + Jan 31 + Feb 28 + Mar 31 + Apr 30 + May 31 +
    // Jun 30 + Jul 31 + Aug 31 = 335 in both years (neither February is a leap
    // one), then Sep 1 .. 15 adds 15 to each.
    const s = flowSeries(steady, '12m', TODAY);
    expect(s.points[10].current).toBe(335);
    expect(s.points[10].previous).toBe(335);
    expect(s.currentTotal).toBe(350);
    expect(s.previousTotal).toBe(350);
    // The shorter ranges were already equal: 7, 30 and 91 days each side.
    expect([flowSeries(steady, '7d', TODAY).currentTotal, flowSeries(steady, '7d', TODAY).previousTotal]).toEqual([7, 7]);
    expect([flowSeries(steady, '30d', TODAY).currentTotal, flowSeries(steady, '30d', TODAY).previousTotal]).toEqual([30, 30]);
    expect([flowSeries(steady, '3m', TODAY).currentTotal, flowSeries(steady, '3m', TODAY).previousTotal]).toEqual([91, 91]);
  });

  it('on the 1st, compares one day of the month with one day', () => {
    // Today Tue Sep 1 2026: 335 whole months, plus Sep 1 itself, on each side.
    const s = flowSeries(steady, '12m', new Date(2026, 8, 1, 9, 0));
    expect(s.currentTotal).toBe(336);
    expect(s.previousTotal).toBe(336);
    expect(s.points[11].currentLabel).toBe('Sep 1, 2026');
    expect(s.points[11].previousLabel).toBe('Sep 1, 2025');
  });

  it('handles leap days by the calendar', () => {
    // Feb 29 2028 is the last day of its month; a year back is Feb 28 2027, the
    // last day of that one, so both Februaries are whole.
    const leap = flowSeries([], '12m', new Date(2028, 1, 29, 9, 0));
    expect(leap.points[11].currentLabel).toBe('Feb 2028');
    expect(leap.points[11].previousLabel).toBe('Feb 2027');
    // Feb 28 2029 ends its month; Feb 28 2028 does not (Feb 29 follows it).
    const after = flowSeries([], '12m', new Date(2029, 1, 28, 9, 0));
    expect(after.points[11].currentLabel).toBe('Feb 2029');
    expect(after.points[11].previousLabel).toBe('Feb 1 – Feb 28, 2028');
  });
});

describe('stockSeries', () => {
  // A level equal to the day of the month, so every average is a sum of a run
  // of whole numbers divided by its length, easy to work by hand.
  const dayOfMonth = (d: Date) => d.getDate();

  it("draws each day's own level on day ranges, and reads the comparison on today's date one period back", () => {
    const s = stockSeries(dayOfMonth, '7d', TODAY);
    expect(s.points.map((p) => p.current)).toEqual([9, 10, 11, 12, 13, 14, 15]);
    expect(s.points.map((p) => p.previous)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(s.currentTotal).toBe(15); // today, Sep 15
    expect(s.previousTotal).toBe(8); // Sep 8
    expect(s.previousDay).toEqual(new Date(2026, 8, 8));
    expect(s.averaged).toBe(false);

    const m = stockSeries(dayOfMonth, '30d', TODAY);
    expect(m.points[29].current).toBe(15); // Sep 15
    expect(m.points[29].previous).toBe(16); // Aug 16
    expect(m.previousTotal).toBe(16);
    expect(m.previousDay).toEqual(new Date(2026, 7, 16));
  });

  it('averages each week over its seven days on 3 months', () => {
    // Weeks from Jun 17 2026; the previous weeks from Mar 18.
    const s = stockSeries(dayOfMonth, '3m', TODAY);
    expect(s.points[0].current).toBe(20); // Jun 17..23: 140 / 7
    expect(s.points[1].current).toBe(27); // Jun 24..30: 189 / 7
    expect(s.points[2].current).toBe(4); // Jul 1..7, over the month end: 28 / 7
    expect(s.points[12].current).toBe(12); // Sep 9..15: 84 / 7
    expect(s.points[0].previous).toBe(21); // Mar 18..24: 147 / 7
    expect(s.points[12].previous).toBe(13); // Jun 10..16: 91 / 7
    expect(s.currentTotal).toBe(15); // today
    expect(s.previousTotal).toBe(16); // Jun 16: one day, not its week's average
    expect(s.previousDay).toEqual(new Date(2026, 5, 16));
    expect(s.averaged).toBe(true);
  });

  it('averages each month over its days on 12 months, a month under way over its days so far', () => {
    const s = stockSeries(dayOfMonth, '12m', TODAY);
    expect(s.points[0].current).toBe(16); // Oct 2025: 496 / 31
    expect(s.points[0].previous).toBe(16); // Oct 2024
    expect(s.points[4].current).toBe(14.5); // Feb 2026: 406 / 28
    expect(s.points[4].previous).toBe(14.5); // Feb 2025
    expect(s.points[11].current).toBe(8); // Sep 1..15 2026: 120 / 15
    expect(s.points[11].previous).toBe(8); // Sep 1..15 2025
    expect(s.currentTotal).toBe(15); // today
    expect(s.previousTotal).toBe(15); // Sep 15 2025
    expect(s.previousDay).toEqual(new Date(2025, 8, 15));
    expect(s.averaged).toBe(true);
  });

  it("never lets a month's last day stand for the month", () => {
    // One car out Mar 2..29 2026, 28 of March's 31 days, and on no other day.
    const out = (d: Date) => (d >= new Date(2026, 2, 2) && d <= new Date(2026, 2, 29) ? 1 : 0);
    const s = stockSeries(out, '12m', TODAY);
    expect(s.points[5].currentLabel).toBe('Mar 2026');
    expect(s.points[5].current).toBeCloseTo(28 / 31, 12);
    expect(s.points[4].current).toBe(0); // Feb
    expect(s.points[6].current).toBe(0); // Apr
  });

  it('treats a non-number level as zero', () => {
    const s = stockSeries(() => Number.NaN, '7d', TODAY);
    expect(s.currentTotal).toBe(0);
  });
});
