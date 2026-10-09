// Subscription pausing — the rules and the Stripe calls, shared by
// `subscription-pause` (the tenant's request) and `subscription-pause-run`
// (the runner that starts and ends pauses on time).
//
// The rules are twins of apps/portal/src/lib/subscription-pause.ts, which the
// portal's Pause dialog uses to explain a date before it is sent. Keep them in
// step: this copy is the one that decides.
//
// HOW A PAUSE BILLS. Stripe `pause_collection` with behavior "void": the
// subscription stays active, invoices still come due on the usual day and are
// voided instead of charged, and Stripe lifts the pause by itself at
// `resumes_at`. The billing anchor never moves — a tenant billed on the 20th
// is billed on the 20th again after the pause (Rule 4).

import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "./subscription-stripe.ts";

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
/* Stripe                                                                    */
/* ------------------------------------------------------------------------ */

// deno-lint-ignore no-explicit-any
type Db = any;

interface SubLite {
  stripe_subscription_id: string | null;
  stripe_account: string | null;
}

// deno-lint-ignore no-explicit-any
async function stripeFor(db: Db, tenantId: string, sub: SubLite): Promise<any> {
  const mode = await getSubscriptionStripeMode(db, tenantId);
  const account = sub.stripe_account === "uae"
    ? "uae"
    : sub.stripe_account === "uk"
      ? "uk"
      : await getTenantSubscriptionAccount(db, tenantId);
  return getSubscriptionStripeClientForAccount(account, mode);
}

/** Pause collection until `endsAt`. Stripe resumes by itself at that moment. */
export async function stripePause(db: Db, tenantId: string, sub: SubLite, endsAt: Date): Promise<void> {
  if (!sub.stripe_subscription_id) throw new Error("No Stripe subscription");
  const stripe = await stripeFor(db, tenantId, sub);
  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    pause_collection: { behavior: "void", resumes_at: Math.floor(endsAt.getTime() / 1000) },
  });
}

/** Collection back on (an empty value clears pause_collection). */
export async function stripeResume(db: Db, tenantId: string, sub: SubLite): Promise<void> {
  if (!sub.stripe_subscription_id) throw new Error("No Stripe subscription");
  const stripe = await stripeFor(db, tenantId, sub);
  await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: "" });
}

export function errText(e: unknown): string {
  return ((e as { message?: string })?.message ?? String(e)).slice(0, 300);
}
