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
 * Minutes a first policy must be bought before pickup. Cover has to be in
 * force before the rental starts or it is void. Mirrors
 * MIN_MINUTES_BEFORE_PICKUP in supabase/functions/_shared/bonzah-client.ts.
 */
export const BONZAH_MIN_MINUTES_BEFORE_PICKUP = 30;

/** The instant of wall-clock `date` (YYYY-MM-DD) + `time` (HH:MM[:SS]) in `timeZone`. */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const [hh, mm] = String(time).split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(t)).map((x) => [x.type, x.value])
    );
    const hour = p.hour === '24' ? 0 : Number(p.hour);
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute)) - t;
  };
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

/**
 * Why a rental's first Bonzah policy cannot be bought right now, or null when
 * it can. Mirrors the guards in bonzah-create-quote:
 * - never after the start day (Bonzah, Brandon Rockow, 2026-10-28);
 * - at least BONZAH_MIN_MINUTES_BEFORE_PICKUP before pickup, so the policy is
 *   in force before the car leaves. Checked only when a pickup time is known.
 */
export function bonzahOriginalBlockedReason(
  startDate: string | null | undefined,
  pickupTime: string | null | undefined,
  timeZone?: string | null
): string | null {
  if (!startDate) return null;
  if (bonzahRentalHasStarted(startDate, timeZone)) {
    return 'Bonzah insurance can be added before a rental starts or on the day it starts, but never after. This rental has already started.';
  }
  if (!pickupTime) return null;
  let pickupAt: Date;
  try {
    pickupAt = zonedInstant(startDate, pickupTime, timeZone || 'America/New_York');
  } catch {
    return null;
  }
  if (Number.isNaN(pickupAt.getTime())) return null;
  if (pickupAt.getTime() < Date.now() + BONZAH_MIN_MINUTES_BEFORE_PICKUP * 60_000) {
    return `Bonzah cover has to be bought at least ${BONZAH_MIN_MINUTES_BEFORE_PICKUP} minutes before pickup, so the policy is in place before the rental starts. Set the pickup time at least ${BONZAH_MIN_MINUTES_BEFORE_PICKUP} minutes from now, or use the customer's own policy.`;
  }
  return null;
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
