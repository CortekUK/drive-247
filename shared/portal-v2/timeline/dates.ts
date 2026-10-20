/**
 * `parseLocalDate` from apps/portal/src/lib/date-utils.ts, for the shared
 * timeline: a date-only "2026-09-30" is that day at LOCAL midnight. `new
 * Date("2026-09-30")` is UTC midnight and renders the 29th west of Greenwich.
 */
export function parseLocalDate(value: string | null | undefined): Date {
  if (!value) return new Date(NaN);
  const s = String(value).split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  return new Date(value);
}
