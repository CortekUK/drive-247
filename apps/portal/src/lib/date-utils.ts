// Date helpers for rental date columns (start_date, end_date, etc.) that are
// stored in Postgres as `date` (no timezone) and arrive in JS as a YYYY-MM-DD
// string. Using `new Date("2026-05-27")` on these would parse them as UTC
// midnight, which in any negative-UTC timezone (Eastern, Central, Pacific…)
// renders as the previous calendar day — producing classic off-by-one bugs in
// the rentals list, extension dialog, and any "starts on" / "ends on" copy.

/**
 * Parse a YYYY-MM-DD date string as local midnight, so it formats to the same
 * calendar day the operator entered. Accepts timestamps too (anything with a
 * 'T') and passes them through to `new Date` unchanged.
 *
 * Returns an Invalid Date (`new Date(NaN)`) when the input is null/undefined
 * so callers can guard with `isNaN(d.getTime())` instead of crashing.
 */
export function parseLocalDate(value: string | null | undefined): Date {
  if (!value) return new Date(NaN);
  const s = String(value).split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  return new Date(value);
}

/**
 * Format a date column for display in the operator's local timezone. Hides
 * the off-by-one timezone trap and gives a consistent `en-US` short date
 * everywhere we render rental dates.
 *
 * Returns the `fallback` string for null/undefined/invalid inputs so callers
 * don't render "Invalid Date" or "NaN/NaN/NaN".
 */
export function formatLocalDate(
  value: string | null | undefined,
  fallback = '—',
): string {
  const d = parseLocalDate(value);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleDateString('en-US');
}
