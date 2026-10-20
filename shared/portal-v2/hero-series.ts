/**
 * The numbers behind a hero-tab graph (Rentals, Customers, Vehicles).
 *
 * One line for the chosen period, one dotted line for the period before it, the
 * way Stripe's home chart compares today with yesterday. Pure functions of the
 * data a page already holds and a `today`, so every point is checkable by hand.
 *
 * Two kinds of metric:
 *   - FLOW:  things that happen on a date (a booking made, a customer created).
 *            Each line is a running total inside its own window, so it only
 *            climbs, and its last point is the window's total.
 *   - STOCK: a level that is true on a given day (cars on rent). The headline
 *            is today's level. Each point is the average level over the days
 *            its bucket covers: one day, one week, or one month.
 *
 * EQUAL PERIODS. The previous window ends on the day that matches today, one
 * period back, so the two lines always cover the same stretch of calendar. For
 * 7 days, 30 days and 3 months both windows are whole days ending there. For 12
 * months the current window's last month is only part-way through (Sep 1 to
 * today), so the previous window's last month stops at the same day of the
 * month a year earlier (Sep 1 to Sep 15, 2025), and both are labelled with
 * their real days. Comparing a half month with a whole one would make a steady
 * business look like it is shrinking.
 *
 * ALL TIME. There is no period before the beginning, so "All time" has no
 * previous window: `hasPrevious` is false, `previousTotal` is null, and every
 * point's `previous` and `previousLabel` are null. Its buckets start from ONE
 * `since` day (a flow metric's earliest event, a stock metric's first day of
 * history) and end today, and their size follows how long that is: up to 31
 * days, one point a day (never fewer than 7 points); up to 182 days (26 weeks),
 * one a week, sized to end exactly today; beyond that, one a month from the
 * month `since` falls in, the last one part-way through. Two series built from
 * the same `since` and `today` therefore have the same buckets, index by index.
 *
 * Days are calendar days in the viewer's local time, the same clock the list
 * tables print dates with. Buckets are counted with calendar arithmetic
 * (date-fns), never by adding milliseconds, so a daylight-saving change cannot
 * shift an event into the neighbouring day.
 */

import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";

export type HeroRange = "7d" | "30d" | "3m" | "12m" | "all";

/** `compareLabel` is null for "All time", which has no period before it. */
export const HERO_RANGES: readonly { key: HeroRange; label: string; compareLabel: string | null }[] = [
  { key: "7d", label: "Last 7 days", compareLabel: "Previous 7 days" },
  { key: "30d", label: "Last 30 days", compareLabel: "Previous 30 days" },
  { key: "3m", label: "Last 3 months", compareLabel: "Previous 3 months" },
  { key: "12m", label: "Last 12 months", compareLabel: "Previous 12 months" },
  { key: "all", label: "All time", compareLabel: null },
];

type Grain = "day" | "week" | "month";

/** 30 daily points, 13 weekly points (91 days), 12 monthly points. "All time" is sized from its data. */
const SPEC: Record<Exclude<HeroRange, "all">, { grain: Grain; buckets: number }> = {
  "7d": { grain: "day", buckets: 7 },
  "30d": { grain: "day", buckets: 30 },
  "3m": { grain: "week", buckets: 13 },
  "12m": { grain: "month", buckets: 12 },
};

/** A dated event and what it adds (1 for a count, an amount for money). */
export interface HeroEvent {
  at: Date;
  amount: number;
}

export interface HeroPoint {
  index: number;
  current: number;
  /** Null on "All time", which has no previous window. */
  previous: number | null;
  /** "Sep 9", "Sep 9 – Sep 15" or "Sep 2026" */
  currentLabel: string;
  previousLabel: string | null;
}

export interface HeroSeries {
  points: HeroPoint[];
  /** FLOW: the window's total. STOCK: the level today (previousTotal: on previousDay). */
  currentTotal: number;
  /** Null on "All time". */
  previousTotal: number | null;
  /** False on "All time": there is nothing to compare with, so no chip, legend entry or dotted line. */
  hasPrevious: boolean;
  /** Axis labels for the two ends of the chart. */
  startLabel: string;
  endLabel: string;
  /**
   * STOCK only: the one day `previousTotal` was read on, today's date one period
   * back (Aug 16 for "Last 30 days" on Sep 15). A level has no total over a
   * period, so the chart names this day instead of calling it "Previous 30 days".
   * Absent on "All time".
   */
  previousDay?: Date;
  /** STOCK only: true when each point averages several days (weeks, months). */
  averaged?: boolean;
}

interface Window {
  bucketStart(i: number): Date;
  /** Last calendar day inside bucket i, never later than the window's last day. */
  bucketEnd(i: number): Date;
  /** True when bucket i stops before its natural end (a month still under way). */
  isPartial(i: number): boolean;
  /** Bucket index for a day, or -1 when the day is outside the window. */
  indexOf(day: Date): number;
}

/**
 * `lastDay` is the window's final calendar day: today for the current window,
 * the matching day one period earlier for the previous one.
 */
function makeWindow(start: Date, grain: Grain, buckets: number, lastDay: Date): Window {
  const afterLast = (day: Date) => differenceInCalendarDays(day, lastDay) > 0;
  if (grain === "month") {
    const fullEnd = (i: number) => startOfDay(endOfMonth(addMonths(start, i)));
    return {
      bucketStart: (i) => addMonths(start, i),
      bucketEnd: (i) => (afterLast(fullEnd(i)) ? lastDay : fullEnd(i)),
      isPartial: (i) => afterLast(fullEnd(i)),
      indexOf: (day) => {
        if (afterLast(day)) return -1;
        const i = differenceInCalendarMonths(day, start);
        return i >= 0 && i < buckets ? i : -1;
      },
    };
  }
  const step = grain === "week" ? 7 : 1;
  // Day and week windows are sized to end exactly on lastDay, so no bucket is cut short.
  return {
    bucketStart: (i) => addDays(start, i * step),
    bucketEnd: (i) => addDays(start, (i + 1) * step - 1),
    isPartial: () => false,
    indexOf: (day) => {
      const d = differenceInCalendarDays(day, start);
      if (d < 0 || afterLast(day)) return -1;
      const i = Math.floor(d / step);
      return i < buckets ? i : -1;
    },
  };
}

/** What a series needs about "All time". */
export interface HeroSeriesOptions {
  /**
   * "All time" only: the first day the buckets must cover. Give the SAME day to
   * every series drawn together, so their buckets line up. A missing, invalid or
   * future day reads as today.
   */
  since?: Date;
}

interface Windows {
  grain: Grain;
  buckets: number;
  current: Window;
  /** Null on "All time". */
  previous: Window | null;
}

/** "All time" goes to one point a day up to this many days, one a week up to ALL_WEEKS_MAX. */
const ALL_DAYS_MAX = 31;
/** 26 weeks. */
const ALL_WEEKS_MAX = 182;
/** Fewer points than this do not make a line worth reading. */
const ALL_DAYS_MIN = 7;

function allTimeWindows(today: Date, since: Date | undefined): Windows {
  const day = startOfDay(today);
  const first = isValidDate(since) && differenceInCalendarDays(since, day) < 0 ? startOfDay(since) : day;
  // Calendar days from `first` through today, both counted.
  const span = differenceInCalendarDays(day, first) + 1;
  if (span <= ALL_DAYS_MAX) {
    const buckets = Math.max(ALL_DAYS_MIN, span);
    return { grain: "day", buckets, current: makeWindow(subDays(day, buckets - 1), "day", buckets, day), previous: null };
  }
  if (span <= ALL_WEEKS_MAX) {
    // Whole weeks ending today, so the first one reaches back to or past `first`.
    const buckets = Math.ceil(span / 7);
    return { grain: "week", buckets, current: makeWindow(subDays(day, buckets * 7 - 1), "week", buckets, day), previous: null };
  }
  const start = startOfMonth(first);
  const buckets = differenceInCalendarMonths(day, start) + 1;
  return { grain: "month", buckets, current: makeWindow(start, "month", buckets, day), previous: null };
}

function windows(range: HeroRange, today: Date, since?: Date): Windows {
  if (range === "all") return allTimeWindows(today, since);
  const { grain, buckets } = SPEC[range];
  const day = startOfDay(today);
  if (grain === "month") {
    const currentStart = subMonths(startOfMonth(day), buckets - 1);
    const previousStart = subMonths(currentStart, buckets);
    // Today's date one period back. date-fns clamps a missing day to the month's
    // last (Feb 29 2028 back a year is Feb 28 2027, the whole of that February).
    const previousLast = subMonths(day, buckets);
    return {
      grain,
      buckets,
      current: makeWindow(currentStart, grain, buckets, day),
      previous: makeWindow(previousStart, grain, buckets, previousLast),
    };
  }
  const span = buckets * (grain === "week" ? 7 : 1);
  const currentStart = subDays(day, span - 1);
  const previousStart = subDays(currentStart, span);
  return {
    grain,
    buckets,
    current: makeWindow(currentStart, grain, buckets, day),
    previous: makeWindow(previousStart, grain, buckets, subDays(currentStart, 1)),
  };
}

function bucketLabel(w: Window, grain: Grain, i: number): string {
  if (grain === "month") {
    if (!w.isPartial(i)) return format(w.bucketStart(i), "MMM yyyy");
    // A month still under way names its real days: "Sep 1 – Sep 15, 2026".
    const start = w.bucketStart(i);
    const end = w.bucketEnd(i);
    return differenceInCalendarDays(end, start) === 0
      ? format(start, "MMM d, yyyy")
      : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  if (grain === "week") return `${format(w.bucketStart(i), "MMM d")} – ${format(w.bucketEnd(i), "MMM d")}`;
  return format(w.bucketStart(i), "MMM d");
}

function axisStart(w: Window, grain: Grain): string {
  return format(w.bucketStart(0), grain === "month" ? "MMM yyyy" : "MMM d");
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * The start of the day of the earliest event across every list that is on or
 * before today, or undefined when there is none. The one `since` for "All time"
 * when several flow series are drawn together.
 */
export function earliestEventDay(lists: readonly (readonly HeroEvent[])[], today: Date = new Date()): Date | undefined {
  let earliest: Date | undefined;
  for (const events of lists) {
    for (const e of events) {
      if (!isValidDate(e.at) || differenceInCalendarDays(e.at, today) > 0) continue;
      if (!earliest || e.at.getTime() < earliest.getTime()) earliest = e.at;
    }
  }
  return earliest && startOfDay(earliest);
}

/**
 * Running totals of dated events: this window against the window before it.
 * On "All time", only this window; `since` defaults to the earliest event.
 */
export function flowSeries(
  events: readonly HeroEvent[],
  range: HeroRange,
  today: Date = new Date(),
  options: HeroSeriesOptions = {},
): HeroSeries {
  const since = range === "all" ? (options.since ?? earliestEventDay([events], today)) : undefined;
  const { grain, buckets, current, previous } = windows(range, today, since);
  const cur = new Array<number>(buckets).fill(0);
  const prev = new Array<number>(buckets).fill(0);

  for (const e of events) {
    if (!isValidDate(e.at)) continue;
    const amount = Number(e.amount);
    if (!Number.isFinite(amount)) continue;
    // Each window stops at its last day: a date after today (clock skew, a
    // future-dated import) is not yet history, and a previous-window date after
    // the matching day has no counterpart in the current window.
    const ci = current.indexOf(e.at);
    if (ci >= 0) {
      cur[ci] += amount;
      continue;
    }
    const pi = previous ? previous.indexOf(e.at) : -1;
    if (pi >= 0) prev[pi] += amount;
  }

  let runCur = 0;
  let runPrev = 0;
  const points = cur.map((_, i) => {
    runCur += cur[i];
    runPrev += prev[i];
    return {
      index: i,
      current: runCur,
      previous: previous ? runPrev : null,
      currentLabel: bucketLabel(current, grain, i),
      previousLabel: previous ? bucketLabel(previous, grain, i) : null,
    };
  });

  return {
    points,
    currentTotal: runCur,
    previousTotal: previous ? runPrev : null,
    hasPrevious: previous !== null,
    startLabel: axisStart(current, grain),
    endLabel: "Today",
  };
}

/**
 * A daily level, such as cars on rent.
 *
 * HEADLINE. `currentTotal` is the level today. `previousTotal` is the level on
 * ONE earlier day, today's date one period back, returned as `previousDay`
 * (on Sep 15 2026: Sep 8, Aug 16, Jun 16 and Sep 15 2025 for 7 days, 30 days,
 * 3 months and 12 months). A level has no total over a period, so both are days.
 *
 * POINTS. Each point is the AVERAGE level over exactly the days its label names.
 * A day bucket is that one day, so the 7- and 30-day lines are each day's own
 * level. A week is the mean over its 7 days and a month over its days (a month
 * under way, and its counterpart a year back, over their days so far). So a car
 * out on 28 of March's 31 days reads 0.9 for March, not whatever happened to be
 * true on the 31st, which could be nothing at all.
 *
 * ALL TIME. The headline is still today's level, with nothing to compare it
 * with: no `previousDay`. The buckets start from `options.since` (the first day
 * the metric has history for); without it they start today, the 7-day minimum.
 */
export function stockSeries(
  valueOn: (day: Date) => number,
  range: HeroRange,
  today: Date = new Date(),
  options: HeroSeriesOptions = {},
): HeroSeries {
  const { grain, buckets, current, previous } = windows(range, today, range === "all" ? options.since : undefined);
  const sample = (day: Date) => {
    const v = Number(valueOn(day));
    return Number.isFinite(v) ? v : 0;
  };
  // Walked with date-fns calendar days, so a daylight-saving change neither
  // skips a day nor counts one twice.
  const mean = (w: Window, i: number) => {
    const start = w.bucketStart(i);
    const days = differenceInCalendarDays(w.bucketEnd(i), start) + 1;
    let sum = 0;
    for (let k = 0; k < days; k++) sum += sample(addDays(start, k));
    return sum / days;
  };

  const points = Array.from({ length: buckets }, (_, i) => ({
    index: i,
    current: mean(current, i),
    previous: previous ? mean(previous, i) : null,
    currentLabel: bucketLabel(current, grain, i),
    previousLabel: previous ? bucketLabel(previous, grain, i) : null,
  }));

  // Each window's last bucket ends on its last day: today, and today's date one
  // period back.
  const previousDay = previous ? previous.bucketEnd(buckets - 1) : undefined;
  return {
    points,
    currentTotal: sample(current.bucketEnd(buckets - 1)),
    previousTotal: previousDay ? sample(previousDay) : null,
    hasPrevious: previous !== null,
    startLabel: axisStart(current, grain),
    endLabel: "Today",
    ...(previousDay ? { previousDay } : {}),
    averaged: grain !== "day",
  };
}
