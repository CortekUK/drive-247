/**
 * Booking date ranges for customer portal v2.
 *
 * Replaces `formatDateRange` from components/portal/format on every v2 booking
 * surface. That helper drops the month from the START of a range whenever both
 * dates share a month — which is right for a day-first locale ("22 – 29 Oct")
 * but in en-US prints "22 – Oct 29, 2026", where the first number has no month
 * at all. It also drops the start month when only the YEAR is shared, giving
 * "12 – Nov 26, 2026" for a range that starts in October.
 *
 * `Intl.DateTimeFormat#formatRange` is the locale's own answer to the same
 * question, so it collapses only what the locale collapses: "Oct 22 – 29, 2026"
 * and "Oct 12 – Nov 26, 2026" in en-US, "22–29 Oct 2026" in en-GB.
 *
 * Inputs are DATE-ONLY strings and go through `parseDateOnly` — `new Date(
 * '2026-09-01')` is UTC midnight and renders the previous day west of Greenwich.
 */

import { parseDateOnly } from '@nw/lib/domain';

const RANGE = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** "Oct 22 – 29, 2026", "Oct 12 – Nov 26, 2026", or "From Oct 22, 2026" with no end. */
export function formatBookingDates(startIso: string, endIso: string | null): string {
  const start = parseDateOnly(startIso);
  if (!endIso) return `From ${RANGE.format(start)}`;

  const end = parseDateOnly(endIso);
  // A reversed range throws in formatRange; print the two dates plainly instead.
  if (end < start) return `${RANGE.format(start)} – ${RANGE.format(end)}`;
  return RANGE.formatRange(start, end);
}

/** "7 days", or null when the length is not known. */
export function formatNights(nights: number | null): string | null {
  if (nights === null) return null;
  return `${nights} day${nights === 1 ? '' : 's'}`;
}
