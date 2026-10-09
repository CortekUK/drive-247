/**
 * Subscription pausing — the date rules, for the Billing → Pause dialog.
 *
 * Twin of supabase/functions/_shared/subscription-pause.ts, which is the copy
 * that decides (the `subscription-pause` edge function runs it again). This
 * one lets the dialog explain a date before anything is sent. Keep them in step.
 *
 * Dates are calendar days as "YYYY-MM-DD", worked in UTC so both copies agree.
 */

export const PAUSE_MIN_MONTHS = 1;
export const PAUSE_MAX_MONTHS = 2;
/** No pause may start in the last N days before a bill. */
export const PAUSE_BLOCKED_LAST_DAYS = 10;

const DAY_MS = 86_400_000;

export const MSG_MONTHS = "Can only pause for minimum 1 month and max 2 months.";
export const MSG_MAX =
  "You can pause for at most 2 months. Your account switches back on automatically when the 2 months are up.";
export const msgLastDays = (days: number) =>
  `You can not pause right now, as your subscription fee has ${days} day${days === 1 ? "" : "s"} left.`;

/* ------------------------------------------------------------------------ */
/* Calendar days, in UTC                                                     */
/* ------------------------------------------------------------------------ */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseYmd(ymd: string): Date | null {
  if (!YMD.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

export function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Same day N months later; the 31st becomes the month's last day when needed. */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), last), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
}

/** The first bill on or after `from`, stepping from a known bill date by the interval. */
export function nextBillOnOrAfter(knownBill: Date, interval: string, from: Date): Date {
  // Always counted from the known bill, never bill-to-bill, so a bill on the
  // 31st comes back to the 31st after a short month.
  const step = interval === "year" ? 12 : 1;
  let n = 0;
  while (addMonths(knownBill, n - step).getTime() >= from.getTime()) n -= step;
  while (addMonths(knownBill, n).getTime() < from.getTime()) n += step;
  return addMonths(knownBill, n);
}

/* ------------------------------------------------------------------------ */
/* The rules                                                                 */
/* ------------------------------------------------------------------------ */

export type PauseCheck =
  | { ok: true; months: 1 | 2; startsAt: Date; endsAt: Date; startDate: string; endDate: string }
  | { ok: false; code: string; message: string };

/**
 * Rules 2, 3 and 5 for a requested pause:
 *   - it starts today or later (a day of slack either side of UTC midnight, so
 *     "today" means the tenant's today too);
 *   - it is exactly 1 or 2 calendar months long: 30 Oct → 30 Nov or 30 Dec
 *     (Rule 5), and never longer (Rule 2);
 *   - it does not start in the last 10 days before a bill (Rule 3).
 *
 * `knownBill` is any bill date of the subscription — the current period end.
 */
export function checkPause(args: {
  startDate: string;
  endDate: string;
  now: Date;
  knownBill: Date;
  interval: string;
}): PauseCheck {
  const start = parseYmd(args.startDate);
  const end = parseYmd(args.endDate);
  if (!start || !end) return { ok: false, code: "bad_dates", message: "Pick a start and an end date." };
  if (end.getTime() <= start.getTime()) {
    return { ok: false, code: "bad_dates", message: "The end date must be after the start date." };
  }

  const todayUtc = new Date(Date.UTC(args.now.getUTCFullYear(), args.now.getUTCMonth(), args.now.getUTCDate()));
  if (start.getTime() < todayUtc.getTime() - DAY_MS) {
    return { ok: false, code: "in_past", message: "A pause can't start in the past." };
  }

  if (end.getTime() > addMonths(start, PAUSE_MAX_MONTHS).getTime()) {
    return { ok: false, code: "too_long", message: MSG_MAX };
  }
  let months: 1 | 2 | null = null;
  for (const m of [1, 2] as const) {
    if (toYmd(addMonths(start, m)) === args.endDate) months = m;
  }
  if (!months) return { ok: false, code: "not_whole_months", message: MSG_MONTHS };

  // A pause that starts today starts now; a later one at the start of its day.
  const startsAt = start.getTime() <= args.now.getTime() ? new Date(args.now) : start;
  const endsAt = end;

  const bill = nextBillOnOrAfter(args.knownBill, args.interval, startsAt);
  const daysLeft = Math.max(0, Math.ceil((bill.getTime() - startsAt.getTime()) / DAY_MS));
  if (daysLeft <= PAUSE_BLOCKED_LAST_DAYS) {
    return { ok: false, code: "last_days", message: msgLastDays(daysLeft) };
  }

  return { ok: true, months, startsAt, endsAt, startDate: args.startDate, endDate: args.endDate };
}

/* ------------------------------------------------------------------------ */
/* Portal-only helpers                                                       */
/* ------------------------------------------------------------------------ */

/** A day picked in the calendar (local midnight) as "YYYY-MM-DD". */
export function localYmd(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** "YYYY-MM-DD" back to a local-midnight Date, for the calendar. */
export function ymdToLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The bills that fall inside a pause (voided, not charged), and the first one after it. */
export function billsAroundPause(knownBill: Date, interval: string, startsAt: Date, endsAt: Date) {
  const skipped: Date[] = [];
  let bill = nextBillOnOrAfter(knownBill, interval, startsAt);
  for (let i = 0; bill.getTime() < endsAt.getTime() && i < 6; i++) {
    skipped.push(bill);
    bill = nextBillOnOrAfter(knownBill, interval, new Date(bill.getTime() + 1));
  }
  return { skipped, nextBill: nextBillOnOrAfter(knownBill, interval, endsAt) };
}
