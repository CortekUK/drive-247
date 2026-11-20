/**
 * Time-aware occupancy for the booking site.
 *
 * `availability-rules.ts` judges a car by whole DAYS, and TRAX keeps a
 * generated copy of it, so that file stays as it is. This module adds the
 * clock. A rental that comes back at 10:00 frees the car for a pickup later
 * the same day — the overlap trigger has worked that way since 2026-10-30
 * (supabase/migrations/20261030120000_rental_overlap_time_aware.sql) — and the
 * tenant's turnaround buffer is measured in minutes from that return, on BOTH
 * sides: a trip is also refused when its own return would crowd the next
 * rental's pickup.
 *
 * Rows without times keep whole-day behaviour, as the trigger reads them: a
 * missing pickup time is 00:00, a missing return time is 23:59:59.
 *
 * Pure: no database, no React. Tested in src/__tests__/lib.
 */
import { OUT_NOW_STATUSES } from "./availability-rules";

/** Mirrors `FALLBACK_TIMEZONE` in components/booking/booking-rules.ts. */
export const FALLBACK_OPERATOR_TIMEZONE = "America/Chicago";

export interface TimedRentalRow {
  vehicle_id?: string | null;
  status?: string | null;
  /** 'YYYY-MM-DD' */
  start_date: string;
  /** 'HH:MM' or 'HH:MM:SS', the operator's wall clock; null reads as 00:00. */
  pickup_time?: string | null;
  end_date: string | null;
  /** Null reads as 23:59:59. */
  return_time?: string | null;
}

export interface TimedTrip {
  pickupDate: string;
  pickupTime: string;
  dropoffDate: string;
  dropoffTime: string;
}

/** Epoch milliseconds. `end` is +Infinity for a car with no return date yet. */
export interface Interval {
  start: number;
  end: number;
}

export type TimedClash = "rented" | "buffer";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const DAY_MS = 86_400_000;
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

function clockParts(clock: string | null | undefined, fallback: string): [number, number, number] | null {
  const m = CLOCK.exec(String(clock ?? "").trim()) ?? CLOCK.exec(fallback);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  return [h, mi, s];
}

function minuteOfDay(clock: string | null | undefined): number | null {
  const parts = clockParts(clock, "");
  return parts ? parts[0] * 60 + parts[1] : null;
}

function dateParts(isoDate: string): [number, number, number] | null {
  if (!ISO_DATE.test(isoDate)) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  return [y, m, d];
}

/** The wall clock read as if it were UTC — zone-free arithmetic, as the trigger does it. */
function naiveMs(isoDate: string, clock: string | null | undefined, fallbackClock: string): number | null {
  const date = dateParts(isoDate);
  const time = clockParts(clock, fallbackClock);
  if (!date || !time) return null;
  return Date.UTC(date[0], date[1] - 1, date[2], time[0], time[1], time[2]);
}

function isoAddDays(isoDate: string, days: number): string {
  const date = dateParts(isoDate);
  if (!date) return isoDate;
  return new Date(Date.UTC(date[0], date[1] - 1, date[2]) + days * DAY_MS).toISOString().slice(0, 10);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zoneOffsetMs(at: number, timeZone: string): number {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, fmt);
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(at))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return asUtc - at;
}

/**
 * A wall-clock date and time in the operator's zone, as an instant. The same
 * two-pass offset lookup as `zonedWallClockToInstant` in
 * components/booking/time-utils.ts, repeated here so this module stays free of
 * component imports and testable on its own.
 */
export function wallClockToMs(
  isoDate: string,
  clock: string | null | undefined,
  timeZone: string,
  fallbackClock: string,
): number | null {
  const naive = naiveMs(isoDate, clock, fallbackClock);
  if (naive === null) return null;
  try {
    const firstPass = naive - zoneOffsetMs(naive, timeZone);
    return naive - zoneOffsetMs(firstPass, timeZone);
  } catch {
    return naive;
  }
}

/** The customer's trip as an instant range; null until both ends are usable. */
export function tripInterval(trip: TimedTrip, timeZone: string): Interval | null {
  const start = wallClockToMs(trip.pickupDate, trip.pickupTime, timeZone, "00:00");
  const end = wallClockToMs(trip.dropoffDate, trip.dropoffTime, timeZone, "23:59:59");
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

function isStillOut(row: TimedRentalRow, todayIso: string): boolean {
  return !!row.status && OUT_NOW_STATUSES.has(row.status) && row.end_date !== null && row.end_date < todayIso;
}

/**
 * When a rental holds the car, as an instant range. Open-ended (PAYG) and
 * overdue-but-still-out rentals hold it indefinitely.
 */
export function rentalInterval(row: TimedRentalRow, timeZone: string, todayIso: string): Interval | null {
  const start = wallClockToMs(row.start_date, row.pickup_time, timeZone, "00:00");
  if (start === null) return null;
  if (row.end_date === null || isStillOut(row, todayIso)) return { start, end: Number.POSITIVE_INFINITY };
  const end = wallClockToMs(row.end_date, row.return_time, timeZone, "23:59:59");
  if (end === null) return null;
  return { start, end: Math.max(start, end) };
}

/**
 * Whether a trip collides with a rental, and how. 'rented' when the two
 * overlap; 'buffer' when they only come within the turnaround buffer of each
 * other — before the trip or after it.
 */
export function timedClash(trip: Interval, rental: Interval, bufferMinutes: number): TimedClash | null {
  if (trip.start < rental.end && trip.end > rental.start) return "rented";
  const buffer = Math.max(0, bufferMinutes) * 60_000;
  if (buffer > 0 && trip.start < rental.end + buffer && trip.end + buffer > rental.start) return "buffer";
  return null;
}

export interface HeldDays {
  /** Days the car is held from midnight to midnight — a date picker greys these out. */
  whole: string[];
  /**
   * Boundary days the car goes out after 00:00 or comes back before 23:59.
   * Still pickable: whether the TIMES clash is for `timedClash` to say.
   */
  partial: string[];
}

/** Which calendar days a rental holds, for a date-only picker. Bounded by `horizonIso`. */
export function heldDays(row: TimedRentalRow, todayIso: string, horizonIso: string): HeldDays {
  const out: HeldDays = { whole: [], partial: [] };
  if (!dateParts(row.start_date)) return out;
  const openEnded = row.end_date === null || isStillOut(row, todayIso);
  const lastDay = openEnded ? horizonIso : (row.end_date as string);
  if (!dateParts(lastDay) || lastDay < row.start_date) return out;
  const startMinute = minuteOfDay(row.pickup_time);
  const endMinute = openEnded ? null : minuteOfDay(row.return_time);
  const startsMidday = startMinute !== null && startMinute > 0;
  const endsMidday = endMinute !== null && endMinute < LAST_MINUTE_OF_DAY;
  let day = row.start_date;
  // Hard stop so a corrupt end_date cannot spin forever painting a calendar.
  for (let guard = 0; day <= lastDay && guard < 800; guard += 1) {
    const first = day === row.start_date;
    const last = day === lastDay;
    const partial = (first && startsMidday) || (last && endsMidday);
    (partial ? out.partial : out.whole).push(day);
    day = isoAddDays(day, 1);
  }
  return out;
}

const TRIGGER_IGNORES = new Set(["Cancelled", "Rejected", "Closed"]);

/**
 * The overlap trigger's own rule, on naive wall clocks, so the checkout can
 * say "taken" in a sentence before the database says it in an exception:
 *
 *   start_date + COALESCE(pickup_time, 00:00) < new end
 *   AND COALESCE(end_date + COALESCE(return_time, 23:59:59), infinity) > new start
 *
 * for every other rental of the car not Cancelled, Rejected or Closed.
 */
export function overlapsLikeTrigger(row: TimedRentalRow, trip: TimedTrip): boolean {
  if (row.status && TRIGGER_IGNORES.has(row.status)) return false;
  const rentalStart = naiveMs(row.start_date, row.pickup_time, "00:00");
  const rentalEnd = row.end_date === null ? Number.POSITIVE_INFINITY : naiveMs(row.end_date, row.return_time, "23:59:59");
  const tripStart = naiveMs(trip.pickupDate, trip.pickupTime, "00:00");
  const tripEnd = naiveMs(trip.dropoffDate, trip.dropoffTime, "23:59:59");
  if (rentalStart === null || rentalEnd === null || tripStart === null || tripEnd === null) return false;
  return rentalStart < tripEnd && rentalEnd > tripStart;
}
