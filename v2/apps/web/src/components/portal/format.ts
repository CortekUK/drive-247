/**
 * Date and time formatting for the portal.
 *
 * Everything here takes DATE-ONLY 'YYYY-MM-DD' strings and goes through
 * `parseDateOnly`. `new Date('2026-09-01')` parses as UTC midnight, so west of
 * Greenwich it renders the PREVIOUS day — a customer in Dallas would be told
 * their car is due back on the 2nd when the contract says the 3rd. See the trap
 * note at the top of `@/lib/domain/date-utils`.
 */

import { formatClockLabel, normalizeClock } from '@/components/booking/time-utils';
import { parseDateOnly } from '@/lib/domain';

/** "12 Mar 2026" */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return parseDateOnly(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "Wed 12 Mar 2026" — for headings where the weekday helps. */
export function formatDateWithWeekday(iso: string | null): string | null {
  if (!iso) return null;
  return parseDateOnly(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * "12 – 15 Mar 2026", collapsing whatever the two dates share.
 *
 * The year is printed once when both fall in it and the month once when both
 * share it, because the repetition is what makes a range hard to read at a
 * glance. An open-ended rental (no end date) renders as "From 12 Mar 2026".
 */
export function formatDateRange(startIso: string, endIso: string | null): string {
  const start = parseDateOnly(startIso);

  if (!endIso) {
    return `From ${formatDate(startIso) ?? startIso}`;
  }

  const end = parseDateOnly(endIso);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth && start.getDate() === end.getDate()) {
    return formatDate(startIso) ?? startIso;
  }

  const startLabel = start.toLocaleDateString(undefined, {
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
    ...(sameYear ? {} : { year: 'numeric' }),
  });

  const endLabel = end.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return `${startLabel} – ${endLabel}`;
}

/**
 * "12 Mar 2026 at 10:00 AM", or just the date when no time was recorded.
 *
 * `normalizeClock` first: `rentals.pickup_time` is a Postgres `time` column and
 * arrives as 'HH:MM:SS', which `formatClockLabel` rejects and echoes back raw —
 * so without this the customer is shown "at 10:00:00".
 */
export function formatDateTime(iso: string | null, clock: string | null): string | null {
  const date = formatDate(iso);
  if (!date) return null;
  const normalized = normalizeClock(clock);
  if (!normalized) return date;
  return `${date} at ${formatClockLabel(normalized)}`;
}

/**
 * A `timestamptz` — NOT a date column. `new Date()` is correct here and
 * `parseDateOnly` would be wrong: these carry a real instant.
 */
export function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "in 3 days" / "today" / "tomorrow" / "6 days ago". Null past a month out. */
export function relativeDayLabel(
  iso: string | null,
  now: Date = new Date(),
): string | null {
  if (!iso) return null;

  const target = parseDateOnly(iso);
  const startOfTarget = Date.UTC(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  );
  const startOfToday = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startOfTarget - startOfToday) / 86_400_000);

  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1 && days <= 31) return `in ${days} days`;
  if (days < -1 && days >= -31) return `${Math.abs(days)} days ago`;
  return null;
}
