// Bonzah date rules shared by the UI.
//
// ⚠️ KEEP THIS FILE BYTE-IDENTICAL in apps/booking/src/lib and apps/portal/src/lib
// (same convention as calculate-rental-price.ts / coverage-labels.ts).
//
// Bonzah refuses to start a policy "today" — the earliest insurable night
// begins TOMORROW in America/Los_Angeles. The bonzah-create-quote edge
// function clamps trip starts accordingly and returns HTTP 400 when the clamp
// leaves zero insurable days. Every UI that quotes, gates, or buys Bonzah
// coverage must mirror this rule, or it promises premiums the purchase step
// then refuses — billing customers for coverage that never exists (GoNiko,
// Jul 2026: same-day +1 extension charged $26.95 with no policy behind it).

/** Today's date (YYYY-MM-DD) in America/Los_Angeles. */
export function getPacificToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Tomorrow's date (YYYY-MM-DD) in America/Los_Angeles — the earliest date a
 * Bonzah policy can start. Calendar arithmetic on the Pacific date parts, not
 * now+24h: adding fixed milliseconds drifts on the 25-hour DST fall-back day.
 */
export function getPacificTomorrow(): string {
  const [y, m, d] = getPacificToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Earliest start Bonzah will accept for a coverage window that would begin on
 * `dateStr` (YYYY-MM-DD): the later of the requested start and Pacific-tomorrow.
 * Mirrors the clamp in bonzah-create-quote.
 */
export function clampToBonzahStart(dateStr: string): string {
  const tomorrow = getPacificTomorrow();
  const date = String(dateStr).slice(0, 10);
  return date > tomorrow ? date : tomorrow;
}

/**
 * Whether Bonzah can insure anything in a window ending `endDate` (YYYY-MM-DD).
 * Date ranges are end-exclusive (matching splitDateRange in bonzah-create-quote),
 * so coverage exists only when the end is strictly after the earliest possible
 * start — i.e. strictly after Pacific-tomorrow.
 */
export function bonzahCanInsureThrough(endDate: string | null | undefined): boolean {
  if (!endDate) return false;
  return String(endDate).slice(0, 10) > getPacificTomorrow();
}
