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
 *   - STOCK: a level that is true on a given day (cars on rent). Each point is
 *            the level on the last day of its bucket, and the headline is today's.
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

export type HeroRange = "7d" | "30d" | "3m" | "12m";

export const HERO_RANGES: readonly { key: HeroRange; label: string; compareLabel: string }[] = [
  { key: "7d", label: "Last 7 days", compareLabel: "Previous 7 days" },
  { key: "30d", label: "Last 30 days", compareLabel: "Previous 30 days" },
  { key: "3m", label: "Last 3 months", compareLabel: "Previous 3 months" },
  { key: "12m", label: "Last 12 months", compareLabel: "Previous 12 months" },
];

type Grain = "day" | "week" | "month";

/** 30 daily points, 13 weekly points (91 days), 12 monthly points. */
const SPEC: Record<HeroRange, { grain: Grain; buckets: number }> = {
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
  previous: number;
  /** "Sep 9", "Sep 9 – Sep 15" or "Sep 2026" */
  currentLabel: string;
  previousLabel: string;
}

export interface HeroSeries {
  points: HeroPoint[];
  /** FLOW: the window's total. STOCK: the level on the last point (today). */
  currentTotal: number;
  previousTotal: number;
  /** Axis labels for the two ends of the chart. */
  startLabel: string;
  endLabel: string;
}

interface Window {
  bucketStart(i: number): Date;
  /** Last calendar day inside bucket i. */
  bucketEnd(i: number): Date;
  /** Bucket index for a day, or -1 when the day is outside the window. */
  indexOf(day: Date): number;
}

function makeWindow(start: Date, grain: Grain, buckets: number): Window {
  if (grain === "month") {
    return {
      bucketStart: (i) => addMonths(start, i),
      bucketEnd: (i) => startOfDay(endOfMonth(addMonths(start, i))),
      indexOf: (day) => {
        const i = differenceInCalendarMonths(day, start);
        return i >= 0 && i < buckets ? i : -1;
      },
    };
  }
  const step = grain === "week" ? 7 : 1;
  return {
    bucketStart: (i) => addDays(start, i * step),
    bucketEnd: (i) => addDays(start, (i + 1) * step - 1),
    indexOf: (day) => {
      const d = differenceInCalendarDays(day, start);
      if (d < 0) return -1;
      const i = Math.floor(d / step);
      return i < buckets ? i : -1;
    },
  };
}

function windows(range: HeroRange, today: Date) {
  const { grain, buckets } = SPEC[range];
  const day = startOfDay(today);
  if (grain === "month") {
    const currentStart = subMonths(startOfMonth(day), buckets - 1);
    const previousStart = subMonths(currentStart, buckets);
    return { grain, buckets, current: makeWindow(currentStart, grain, buckets), previous: makeWindow(previousStart, grain, buckets) };
  }
  const span = buckets * (grain === "week" ? 7 : 1);
  const currentStart = subDays(day, span - 1);
  const previousStart = subDays(currentStart, span);
  return { grain, buckets, current: makeWindow(currentStart, grain, buckets), previous: makeWindow(previousStart, grain, buckets) };
}

function bucketLabel(w: Window, grain: Grain, i: number): string {
  if (grain === "month") return format(w.bucketStart(i), "MMM yyyy");
  if (grain === "week") return `${format(w.bucketStart(i), "MMM d")} – ${format(w.bucketEnd(i), "MMM d")}`;
  return format(w.bucketStart(i), "MMM d");
}

function axisStart(w: Window, grain: Grain): string {
  return format(w.bucketStart(0), grain === "month" ? "MMM yyyy" : "MMM d");
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Running totals of dated events: this window against the window before it. */
export function flowSeries(events: readonly HeroEvent[], range: HeroRange, today: Date = new Date()): HeroSeries {
  const { grain, buckets, current, previous } = windows(range, today);
  const cur = new Array<number>(buckets).fill(0);
  const prev = new Array<number>(buckets).fill(0);
  const lastDay = startOfDay(today);

  for (const e of events) {
    if (!isValidDate(e.at)) continue;
    const amount = Number(e.amount);
    if (!Number.isFinite(amount)) continue;
    // A date after today (clock skew, a future-dated import) is not yet history.
    if (differenceInCalendarDays(e.at, lastDay) > 0) continue;
    const ci = current.indexOf(e.at);
    if (ci >= 0) {
      cur[ci] += amount;
      continue;
    }
    const pi = previous.indexOf(e.at);
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
      previous: runPrev,
      currentLabel: bucketLabel(current, grain, i),
      previousLabel: bucketLabel(previous, grain, i),
    };
  });

  return {
    points,
    currentTotal: runCur,
    previousTotal: runPrev,
    startLabel: axisStart(current, grain),
    endLabel: "Today",
  };
}

/** A daily level sampled at the end of each bucket (today, for the last current bucket). */
export function stockSeries(valueOn: (day: Date) => number, range: HeroRange, today: Date = new Date()): HeroSeries {
  const { grain, buckets, current, previous } = windows(range, today);
  const lastDay = startOfDay(today);
  const sample = (day: Date) => {
    const v = Number(valueOn(day));
    return Number.isFinite(v) ? v : 0;
  };

  const points = Array.from({ length: buckets }, (_, i) => {
    const end = current.bucketEnd(i);
    const curDay = differenceInCalendarDays(end, lastDay) > 0 ? lastDay : end;
    return {
      index: i,
      current: sample(curDay),
      previous: sample(previous.bucketEnd(i)),
      currentLabel: bucketLabel(current, grain, i),
      previousLabel: bucketLabel(previous, grain, i),
    };
  });

  return {
    points,
    currentTotal: points[buckets - 1].current,
    previousTotal: points[buckets - 1].previous,
    startLabel: axisStart(current, grain),
    endLabel: "Today",
  };
}
