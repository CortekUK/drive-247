// Bonzah date rules shared by the UI.
//
// KEEP THIS FILE BYTE-IDENTICAL in apps/booking/src/lib and apps/portal/src/lib
// (same convention as calculate-rental-price.ts / coverage-labels.ts).
//
// Bonzah sells same-day cover: a policy may start TODAY, as long as the start
// time is still ahead on Bonzah's clock, which is US Eastern (probed on live
// 2026-10-28; see resolveBonzahTripStart in supabase/functions/_shared/
// bonzah-client.ts). The bonzah-create-quote edge function moves a start of
// today-or-earlier up to "now" and returns HTTP 400 when that leaves zero
// insurable days. Every UI that quotes, gates, or buys Bonzah coverage must
// mirror this rule, or it promises premiums the purchase step then refuses —
// billing customers for coverage that never exists (GoNiko, Jul 2026: an
// extension charged $26.95 with no policy behind it).

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
 * Today's date (YYYY-MM-DD) in America/New_York — the earliest date a Bonzah
 * policy can start, because Bonzah validates trip starts on the Eastern clock.
 */
export function getBonzahToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Today's date (YYYY-MM-DD) in `timeZone` (the tenant's), or Eastern if unknown/invalid. */
export function getTodayInZone(timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'America/New_York' }).format(new Date());
  } catch {
    return getBonzahToday();
  }
}

/**
 * Bonzah's rule (Brandon Rockow, 2026-10-28): "Insurance can never be added
 * after the rental starts, but it can be added the same day as the rental
 * starts." Same day is the rental's own calendar day, judged on the tenant's
 * clock. Mirrors the guard in bonzah-create-quote. Applies to a rental's first
 * policy; an extension may only continue cover that has not yet lapsed.
 */
export function bonzahRentalHasStarted(
  rentalStart: string | null | undefined,
  timeZone?: string | null
): boolean {
  if (!rentalStart) return false;
  return String(rentalStart).slice(0, 10) < getTodayInZone(timeZone);
}

/**
 * Tomorrow's date (YYYY-MM-DD) in America/Los_Angeles. Calendar arithmetic on
 * the Pacific date parts, not now+24h: adding fixed milliseconds drifts on the
 * 25-hour DST fall-back day.
 */
export function getPacificTomorrow(): string {
  const [y, m, d] = getPacificToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Earliest start Bonzah will accept for a coverage window that would begin on
 * `dateStr` (YYYY-MM-DD): the later of the requested start and Bonzah-today.
 * Mirrors resolveBonzahTripStart in bonzah-create-quote.
 */
export function clampToBonzahStart(dateStr: string): string {
  const today = getBonzahToday();
  const date = String(dateStr).slice(0, 10);
  return date > today ? date : today;
}

/**
 * Whether Bonzah can insure anything in a window ending `endDate` (YYYY-MM-DD).
 * Date ranges are end-exclusive (matching splitDateRange in bonzah-create-quote),
 * so coverage exists only when the end is strictly after the earliest possible
 * start — i.e. strictly after Bonzah-today.
 */
export function bonzahCanInsureThrough(endDate: string | null | undefined): boolean {
  if (!endDate) return false;
  return String(endDate).slice(0, 10) > getBonzahToday();
}
