/**
 * Calendar days for Finances. Pure.
 *
 * Every date here is a 'YYYY-MM-DD' day in the TENANT's timezone. A day is
 * never passed through `new Date('YYYY-MM-DD')` (UTC midnight — the day before
 * anywhere west of Greenwich); calendar maths uses UTC day numbers, which have
 * no DST.
 */

import { addDays, dayNumber, todayInZone } from "@/lib/payment-plans-ui/format";
import type { Period } from "./types";

export type ISODate = string;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The next-7-days window the Upcoming card counts: today and the six days after it. */
export const UPCOMING_WINDOW_DAYS = 7;

/** Today in the tenant's zone (browser zone when the tenant has none). */
export function tenantToday(timeZone: string | null | undefined, now: Date = new Date()): ISODate {
  return todayInZone(timeZone || undefined, now);
}

/** The day part of a date or timestamp column, or null when it is not one. */
export function dayOf(value: string | null | undefined): ISODate | null {
  if (!value) return null;
  const d = String(value).split("T")[0].split(" ")[0];
  return ISO_DAY.test(d) ? d : null;
}

/** The calendar day an instant falls on in `timeZone`. */
export function instantDay(instant: string | null | undefined, timeZone: string | null | undefined): ISODate | null {
  if (!instant) return null;
  const t = new Date(instant);
  if (Number.isNaN(t.getTime())) return null;
  return todayInZone(timeZone || undefined, t);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysFrom(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from);
}

export interface DayRange {
  /** Inclusive; null = unbounded. */
  from: ISODate | null;
  /** Inclusive; null = unbounded. */
  to: ISODate | null;
}

function lastDayOfMonth(today: ISODate): ISODate {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

/**
 * A period as an inclusive day range.
 *
 *   today  — today.
 *   7d     — the last 7 days ending today ("past", for money that came in and
 *            bills raised) or the 7 days starting today ("future", for money
 *            still to come).
 *   month  — the whole calendar month containing today.
 *   all    — unbounded.
 *   custom — `{ from, to }` as given (inclusive both ends).
 */
export function periodRange(period: Period, today: ISODate, direction: "past" | "future" = "past"): DayRange {
  if (period === "all") return { from: null, to: null };
  if (period === "today") return { from: today, to: today };
  if (period === "7d") {
    return direction === "future"
      ? { from: today, to: addDays(today, UPCOMING_WINDOW_DAYS - 1) }
      : { from: addDays(today, -(UPCOMING_WINDOW_DAYS - 1)), to: today };
  }
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: lastDayOfMonth(today) };
  if (period && typeof period === "object") {
    return { from: dayOf(period.from), to: dayOf(period.to) };
  }
  return { from: null, to: null };
}

/**
 * Is `day` inside the range? A row with no day is inside only an unbounded
 * range — it can't be placed in any bounded one.
 */
export function inRange(day: ISODate | null, range: DayRange): boolean {
  if (range.from === null && range.to === null) return true;
  if (!day) return false;
  if (range.from !== null && day < range.from) return false;
  if (range.to !== null && day > range.to) return false;
  return true;
}

/** The Upcoming card's window: [today, today + 6]. */
export function upcomingWindow(today: ISODate): DayRange {
  return { from: today, to: addDays(today, UPCOMING_WINDOW_DAYS - 1) };
}
