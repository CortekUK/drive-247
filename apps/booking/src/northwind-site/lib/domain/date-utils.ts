// Date helpers for DATE-ONLY database columns.
//
// Ported from apps/booking/src/lib/date-utils.ts. The v1 file imports
// `parseDateString` from the pricing engine; this copy does the same, via a
// relative import, so there is exactly ONE date-only parser in v2 and it is the
// same one the pricing engine uses to walk the day loop.
//
// THE DATE TRAP — read before touching anything in here:
// Postgres `date` columns (rentals.start_date / end_date, tenant_holidays
// start/end, vehicle_daily_prices.date, date_of_birth, invoice due dates …)
// arrive over PostgREST as the bare string "YYYY-MM-DD". `new Date("2026-05-27")`
// parses that as UTC midnight, so in every negative-UTC-offset timezone
// (Eastern, Central, Pacific …) it both RENDERS and COMPARES as the previous
// calendar day. In the booking flow that is not a cosmetic bug: the pricing
// engine counts calendar days, so an off-by-one parse silently charges the
// customer for one day more or less than the operator quoted.
// => Always parseDateString / parseDateOnly for `date` columns.
// => NEVER for `timestamptz` columns (created_at, payment timestamps,
//    promotions.start_date/end_date) — those carry a real instant and must keep
//    plain `new Date()`.

import { parseDateString } from './calculate-rental-price';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Parse a DATE-only DB value ("YYYY-MM-DD", or the date part of an ISO string)
 * as LOCAL midnight.
 *
 * Use this for `date` columns — rental start/end dates, date_of_birth, invoice
 * due/issue dates, document/policy dates, etc. — instead of `new Date(value)`.
 * `new Date("YYYY-MM-DD")` parses as UTC midnight, so in negative-UTC-offset
 * timezones it renders AND compares one day early (the "birthday / pickup date
 * shows a day before" bug, and wrong isPast()/isToday() for due dates).
 *
 * Do NOT use for `timestamptz` columns (e.g. promotions.start_date/end_date,
 * created_at, payment timestamps) — those carry a real instant and must keep
 * `new Date()`.
 */
export function parseDateOnly(value: string | Date | null | undefined): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  return parseDateString(String(value).split('T')[0]);
}

/**
 * Serialise a Date back to the "YYYY-MM-DD" shape a `date` column expects,
 * reading the LOCAL calendar fields.
 *
 * This is the inverse of parseDateOnly and the reason it exists is the other
 * half of the same trap: `date.toISOString().split('T')[0]` is the idiom used
 * all over v1, and it is UTC — for anyone west of Greenwich, an evening pickup
 * date serialises as TOMORROW. Never round-trip a picked date through
 * toISOString(); use this.
 */
export function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today, in the viewer's own timezone, as "YYYY-MM-DD" — safe as a date input `min`. */
export function todayDateString(): string {
  return formatDateOnly(new Date());
}

/**
 * Number of billable calendar days between two date-only strings, minimum 1.
 *
 * MIRRORS calculateRentalPriceBreakdown's own day count exactly — same
 * Date.UTC() normalisation, same Math.ceil, same Math.max(1, …). Dates are
 * calendar dates, not elapsed local-time durations: subtracting two local
 * midnights over-counts on the DST fall-back day (25 real hours), which is why
 * both places project onto UTC first.
 *
 * Prefer the `rentalDays` the pricing engine returns whenever you already have
 * a price. This exists for the moments before one exists — validating a
 * minimum rental length, previewing a mileage allowance — and MUST keep the
 * same formula or the two numbers will disagree on a DST boundary.
 */
export function calendarDaysBetween(startDate: string, endDate: string): number {
  const start = parseDateString(startDate);
  const end = parseDateString(endDate);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.ceil((endDay - startDay) / MS_PER_DAY));
}
