/**
 * Customer Management Service — the timing core (Deno copy).
 *
 * TWIN of apps/admin/lib/customer-management/schedule.ts. Everything below the
 * header is byte-identical to that file and is MEANT to stay that way: the
 * admin app shows an operator when a mail will go out, this runner decides
 * when it actually does, and the two answering differently is the one bug
 * nobody would notice until an operator complained.
 *
 * This monorepo has no shared package (`packages/*` is declared but unused —
 * CLAUDE.md), which is why it is a copy rather than an import; the same
 * arrangement lib/notifications-v2/types.ts documents for its portal twin.
 * apps/admin/__tests__/lib/customer-management-schedule.test.ts compares the
 * two files with their headers stripped and fails on any difference, so
 * editing one and forgetting the other cannot reach production.
 *
 * Regenerate rather than hand-edit:
 *   node -e ...   (see the commit that introduced this module)
 */

/* -------------------------------------------------------------------------- */
/* The three automations                                                      */
/* -------------------------------------------------------------------------- */

export type AutomationId = "signup" | "renewal" | "receipt";

export const AUTOMATION_IDS: readonly AutomationId[] = ["signup", "renewal", "receipt"] as const;

/**
 * What an automation's `offset_days` is measured FROM — the thing most worth
 * being unambiguous about. The signup sequence counts FORWARD from the day the
 * operator signed up; a renewal reminder counts BACKWARD from the day they
 * will next be charged. The same number 7 means opposite things.
 */
export type OffsetDirection = "after_signup" | "before_renewal" | "on_event";

export const AUTOMATION_OFFSET_DIRECTION: Record<AutomationId, OffsetDirection> = {
  signup: "after_signup",
  renewal: "before_renewal",
  receipt: "on_event",
};

/* -------------------------------------------------------------------------- */
/* Developer Test Mode: time compression                                      */
/* -------------------------------------------------------------------------- */

/**
 * The compression curve, anchored on the points that were asked for:
 * day 0 is immediate, 7 days behaves like 1 minute, 14 days like 3 minutes.
 *
 * ── WHY SECONDS AND NOT MINUTES ─────────────────────────────────────────────
 *
 * The obvious unit is minutes, and it does not work. A sequence with steps at
 * day 0, 3, 7 and 14 compresses to 0, 0, 1 and 3 minutes — day 0 and day 3
 * land in the same minute, so those two emails arrive together and the one
 * thing a rehearsal exists to show you, THE ORDER, is the one thing you cannot
 * see. Rounding them apart instead moves day 7 off its anchor.
 *
 * At second resolution both anchors hold exactly (7 -> 60s, 14 -> 180s) and
 * day 3 lands at 26s: distinct, ordered, nothing bumped.
 */
const TEST_ANCHORS: readonly (readonly [days: number, seconds: number])[] = [
  [0, 0],
  [7, 60],
  [14, 180],
] as const;

/** Human form of the anchors, so the UI can state what test mode will do. */
export const TEST_MODE_ANCHOR_LABELS: readonly string[] = [
  "7 days -> 1 minute",
  "14 days -> 3 minutes",
] as const;

/**
 * One offset in days -> its rehearsal delay in seconds.
 *
 * Linear between the anchors. Beyond the last anchor it continues at that
 * segment's rate (2/7 of a minute per day) rather than flattening, so a step
 * someone adds at day 30 is still later than the day-14 one instead of
 * colliding with it.
 */
export function testOffsetSeconds(offsetDays: number): number {
  if (!Number.isFinite(offsetDays) || offsetDays <= 0) return 0;

  for (let i = 1; i < TEST_ANCHORS.length; i++) {
    const [d0, s0] = TEST_ANCHORS[i - 1];
    const [d1, s1] = TEST_ANCHORS[i];
    if (offsetDays <= d1) {
      const span = d1 - d0;
      if (span <= 0) return s1;
      return Math.round(s0 + ((offsetDays - d0) / span) * (s1 - s0));
    }
  }

  const [dPrev, sPrev] = TEST_ANCHORS[TEST_ANCHORS.length - 2];
  const [dLast, sLast] = TEST_ANCHORS[TEST_ANCHORS.length - 1];
  const rate = (sLast - sPrev) / (dLast - dPrev);
  return Math.round(sLast + (offsetDays - dLast) * rate);
}

/**
 * Compress a whole SET of offsets at once, guaranteeing that distinct offsets
 * stay distinct and in order.
 *
 * `testOffsetSeconds` is a curve and says nothing about collisions; two steps
 * a few hours apart would round to the same second. A rehearsal in which the
 * day-3 mail can arrive before the day-0 mail is worse than no rehearsal,
 * because it teaches you a sequence your operators will never receive. So the
 * set is sorted, mapped, then walked once to push any tie one second later.
 *
 * Returns a map keyed by the ORIGINAL offset value.
 */
export function compressOffsets(offsetDays: readonly number[]): Map<number, number> {
  const unique = [...new Set(offsetDays)].sort((a, b) => a - b);
  const out = new Map<number, number>();
  let previous = -1;
  for (const days of unique) {
    const seconds = Math.max(testOffsetSeconds(days), previous + 1);
    out.set(days, seconds);
    previous = seconds;
  }
  return out;
}

/**
 * Renewal reminders in a rehearsal: a countdown, one minute apart.
 *
 * Renewal offsets count BACKWARD from the payment, so the biggest offset is
 * the first email ("3 days left"), not the last. Feeding them through the
 * signup curve would play the countdown in reverse — "1 day left" first. So
 * the largest offset fires immediately and each day after it is one minute:
 * 3 days left -> 0 min, 2 days left -> 1 min, 1 day left -> 2 min.
 */
export function renewalTestSeconds(offsetDays: readonly number[]): Map<number, number> {
  const max = Math.max(0, ...offsetDays);
  return new Map(offsetDays.map((d) => [d, Math.max(0, max - d) * 60]));
}

/**
 * Of the renewal reminders already due for one tenant, the one to send.
 *
 * Only the most recent: if a tenant comes into scope (or a cron outage ends)
 * with one day left, they get "1 day left" — not the 3-day, 2-day and 1-day
 * emails in the same minute. The others are logged as superseded.
 */
export function latestDueIndex(dueTimes: readonly number[]): number {
  let best = -1;
  for (let i = 0; i < dueTimes.length; i++) {
    if (best === -1 || dueTimes[i] > dueTimes[best]) best = i;
  }
  return best;
}

/** "3 days" / "1 day" — for "{{days_until_renewal_text}} left". */
export function daysText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/* -------------------------------------------------------------------------- */
/* Due times                                                                  */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/**
 * When a signup-sequence step falls due.
 *
 * Production: `signedUpAt + offset_days`.
 * Test mode:  `anchorAt + compressed(offset_days)`, where `anchorAt` is the
 *             moment the rehearsal started — NOT the signup date. An account
 *             created months ago is already past every offset, so anchoring on
 *             signup would fire the whole sequence at once and show you
 *             nothing.
 */
export function signupStepDueAt(args: {
  signedUpAt: string | Date | null;
  offsetDays: number;
  testMode: boolean;
  /** Required in test mode: when the rehearsal started. */
  anchorAt?: string | Date | null;
  /** Pass the value from `compressOffsets` to keep a whole set ordered. */
  compressedSeconds?: number;
}): Date | null {
  if (args.testMode) {
    const anchor = toDate(args.anchorAt);
    if (!anchor) return null;
    const seconds = args.compressedSeconds ?? testOffsetSeconds(args.offsetDays);
    return new Date(anchor.getTime() + seconds * 1000);
  }

  const signedUp = toDate(args.signedUpAt);
  if (!signedUp) return null;
  return new Date(signedUp.getTime() + args.offsetDays * DAY_MS);
}

/**
 * A reminder that repeats until the operator does the thing it asks for
 * (connect Stripe, send the Bonzah form): every `everyMs` from its first due
 * time — with first = day 3 and every = 3 days, that is day 3, 6, 9, ...
 *
 * Returns only the LATEST occurrence already due, never the backlog: a tenant
 * who comes into scope on day 10 gets the day-9 reminder, not three at once.
 * Null while the first one is not yet due.
 */
export function latestRepeatDue(args: {
  firstDueAt: Date;
  everyMs: number;
  now: Date;
}): { occurrence: number; dueAt: Date } | null {
  if (!(args.everyMs > 0)) return null;
  const elapsed = args.now.getTime() - args.firstDueAt.getTime();
  if (elapsed < 0) return null;
  const occurrence = Math.floor(elapsed / args.everyMs);
  return { occurrence, dueAt: new Date(args.firstDueAt.getTime() + occurrence * args.everyMs) };
}

/**
 * The repeat interval in milliseconds. In a rehearsal it is compressed on the
 * same curve as the offsets (3 days -> 26 sec), so the repeats are watchable.
 */
export function repeatEveryMs(days: number, testMode: boolean): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  return testMode ? Math.max(1, testOffsetSeconds(days)) * 1000 : days * DAY_MS;
}

/**
 * When a renewal reminder falls due: `billingDate - offset_days`.
 *
 * ── TEST MODE DOES NOT MOVE THE RENEWAL DATE ────────────────────────────────
 *
 * It cannot. That date belongs to a live Stripe subscription, and the whole
 * point of this reminder is that it refers to a real charge. So a rehearsal
 * anchors on `anchorAt` exactly as the signup sequence does, and the email's
 * own {{renewal_date}} still shows the tenant's REAL next charge — what you
 * read in the rehearsal is what the operator would read. The compression
 * rehearses the SEQUENCE, never the arithmetic.
 */
export function renewalReminderDueAt(args: {
  billingDate: string | Date | null;
  offsetDays: number;
  testMode: boolean;
  anchorAt?: string | Date | null;
  compressedSeconds?: number;
}): Date | null {
  if (args.testMode) {
    const anchor = toDate(args.anchorAt);
    if (!anchor) return null;
    const seconds = args.compressedSeconds ?? testOffsetSeconds(args.offsetDays);
    return new Date(anchor.getTime() + seconds * 1000);
  }

  const billing = toDate(args.billingDate);
  if (!billing) return null;
  return new Date(billing.getTime() - args.offsetDays * DAY_MS);
}

/* -------------------------------------------------------------------------- */
/* Which subscription, and whether we may remind them at all                  */
/* -------------------------------------------------------------------------- */

/** The columns this module reads off `tenant_subscriptions`. */
export interface SubscriptionFacts {
  status: string;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at: string | null;
  created_at: string;
}

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Pick the one subscription that represents a tenant today.
 *
 * A tenant migrated between the two Stripe platforms KEEPS ITS RETIRED UK ROW
 * alongside the live UAE one, so "the tenant's subscription" is not a single
 * row, and taking the first would date a reminder from a subscription that
 * stopped billing a year ago. Prefer a live status, then the most recent — the
 * same rule as `selectSubscription` in the Rental Companies page
 * (app/admin/(protected)/rentals/page.tsx:206).
 */
export function selectSubscription<T extends SubscriptionFacts>(
  rows: readonly T[] | null | undefined,
): T | null {
  if (!rows || rows.length === 0) return null;
  const live = rows.filter((r) => LIVE_STATUSES.has(r.status));
  const pool = live.length > 0 ? live : rows;
  return pool.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
}

export type RenewalSkipReason =
  | "no_subscription"
  | "not_live"
  | "scheduled_to_cancel"
  | "past_due"
  | "no_billing_date"
  | "billing_date_passed";

/**
 * The date the tenant will next ACTUALLY be charged, or a reason not to remind
 * them.
 *
 * Every branch here is a wrong email we would otherwise send, and they are
 * taken from the derivation the Rental Companies page already had to get right
 * (rentals/page.tsx:263-300):
 *
 *   SCHEDULED TO CANCEL — `cancel_at` is set when an operator cancels but
 *     keeps the period they have paid for. The row stays 'active' until it
 *     lapses, so a naive query finds a healthy subscription with a future
 *     `current_period_end` and we cheerfully tell somebody who has ALREADY
 *     LEFT that we are about to charge them again. There is no next invoice.
 *
 *   PAST DUE — when a charge fails, Stripe still advances
 *     `current_period_end` by a full period. Reminding them about a renewal
 *     next month while they owe for last month is both wrong and the most
 *     irritating mail we could send at that moment. Dunning is Stripe's job.
 *
 *   TRIALING — bills at `trial_end`, not at `current_period_end`.
 */
export function nextBillingDate(
  sub: SubscriptionFacts | null,
  now: Date,
): { date: Date | null; skip: RenewalSkipReason | null } {
  if (!sub) return { date: null, skip: "no_subscription" };
  if (!LIVE_STATUSES.has(sub.status)) return { date: null, skip: "not_live" };

  if (
    (sub.status === "active" || sub.status === "trialing") &&
    sub.cancel_at &&
    toTime(sub.cancel_at) > now.getTime()
  ) {
    return { date: null, skip: "scheduled_to_cancel" };
  }

  if (sub.status === "past_due") return { date: null, skip: "past_due" };

  const raw = sub.status === "trialing" && sub.trial_end ? sub.trial_end : sub.current_period_end;
  const date = toDate(raw);
  if (!date) return { date: null, skip: "no_billing_date" };
  if (date.getTime() <= now.getTime()) return { date: null, skip: "billing_date_passed" };

  return { date, skip: null };
}

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The value that makes a send unrepeatable, stored on the log row under a
 * unique index on (tenant_id, automation, step_key, cycle_key).
 *
 * - signup  one-shot per tenant per step, so the cycle is a constant.
 * - renewal RECURS. Keyed on the billing day, so each period earns one
 *   reminder and a tenant on monthly billing is reminded twelve times a year
 *   rather than once ever.
 * - receipt keyed on the payment's own id, which is what makes a replayed
 *   Stripe webhook harmless.
 *
 * A rehearsal NEVER shares a key with production. Without the prefix, testing
 * the day-7 mail for Northwind would file a 'sent' row that permanently
 * suppresses the real one — a test that breaks the thing it was testing. The
 * run id makes repeated rehearsals independent of each other too.
 */
export function cycleKey(args: {
  automation: AutomationId;
  /** renewal: the billing date. receipt: the payment / invoice id. */
  anchor?: string | Date | null;
  /** signup, repeating reminder only: which repeat (0 = the first one). */
  occurrence?: number;
  testMode?: boolean;
  testRunId?: string | null;
}): string {
  let base: string;
  switch (args.automation) {
    case "signup":
      base = args.occurrence === undefined ? "once" : `rep:${args.occurrence}`;
      break;
    case "renewal": {
      const d = toDate(args.anchor);
      base = d ? isoDay(d) : "unknown";
      break;
    }
    case "receipt":
      base = typeof args.anchor === "string" && args.anchor ? args.anchor : "unknown";
      break;
  }
  if (!args.testMode) return base;
  return `test:${args.testRunId || "adhoc"}:${base}`;
}

/** `YYYY-MM-DD` in UTC — the billing day, not the reader's calendar day. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toTime(value: string | Date | null | undefined): number {
  const d = toDate(value);
  return d ? d.getTime() : Number.NaN;
}

/** A compressed delay as the UI says it: "26 sec", "1 min", "5 min 10 sec". */
export function formatSeconds(total: number): string {
  if (total <= 0) return "immediately";
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins === 0) return `${secs} sec`;
  if (secs === 0) return `${mins} min`;
  return `${mins} min ${secs} sec`;
}
