import { parseDateString } from "@/lib/calculate-rental-price";

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
  return parseDateString(String(value).split("T")[0]);
}
