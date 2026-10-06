/**
 * Customer health score — a 0–100 number that tells the team which operators
 * might leave, so someone can call them before they cancel.
 *
 * Pure arithmetic: no React, no Supabase. The page loads the raw facts and
 * hands them here, so the rules can be tested without a database.
 *
 * ── THE FOUR SIGNALS ────────────────────────────────────────────────────────
 *
 *   Logins    30  when somebody at the company last signed in to the portal
 *   Bookings  30  rentals created in the last 30 days
 *   Payment   25  is the Drive247 subscription being paid
 *   Setup     15  Stripe connected (8) and the Bonzah form sent (7)
 *
 * The example in the brief — no login for two weeks, no bookings this month,
 * last payment failed — lands at 12 + 0 + 0 + 15 = 27: red.
 *
 * ── WHY "STRIPE CONNECTED" MEANS WHAT IT DOES ───────────────────────────────
 *
 * Same rule as the portal's setup progress (apps/portal/src/lib/
 * stripe-connect-status.ts) and the Customer Management runner's
 * `stripeConnected`, so the three never disagree about one tenant.
 */

export type HealthBand = 'healthy' | 'at_risk' | 'critical';

export const BAND_THRESHOLDS = { healthy: 70, atRisk: 40 } as const;

export const MAX_POINTS = { logins: 30, bookings: 30, payment: 25, setup: 15 } as const;

export interface TenantFacts {
  id: string;
  company_name: string | null;
  slug: string | null;
  created_at: string;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
  integration_bonzah: boolean | null;
}

export interface SubscriptionFacts {
  status: string;
  cancel_at: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  created_at: string;
}

export interface InvoiceFacts {
  status: string;
  attempt_count: number | null;
  created_at: string;
}

export interface HealthInput {
  tenant: TenantFacts;
  lastLoginAt: string | null;
  bookingsLast30Days: number;
  subscriptions: readonly SubscriptionFacts[];
  invoices: readonly InvoiceFacts[];
  bonzahFormSent: boolean;
  now: Date;
}

export type PaymentState = 'paid' | 'trialing' | 'cancelling' | 'failed' | 'none';

export interface HealthPart {
  points: number;
  max: number;
  /** What the team reads: "Last login 14 days ago". */
  label: string;
  /** True when this part is pulling the score down. */
  concern: boolean;
}

export interface HealthResult {
  score: number;
  band: HealthBand;
  parts: { logins: HealthPart; bookings: HealthPart; payment: HealthPart; setup: HealthPart };
  daysSinceLogin: number | null;
  bookingsLast30Days: number;
  payment: PaymentState;
  stripeConnected: boolean;
  bonzahFormSent: boolean;
  /** Days since the company signed up — a red score in week one means less. */
  ageDays: number;
}

const DAY_MS = 86_400_000;
const LIVE = new Set(['active', 'trialing', 'past_due', 'unpaid']);

export function bandFor(score: number): HealthBand {
  if (score >= BAND_THRESHOLDS.healthy) return 'healthy';
  if (score >= BAND_THRESHOLDS.atRisk) return 'at_risk';
  return 'critical';
}

export function stripeConnected(t: TenantFacts): boolean {
  return (
    !!t.own_stripe_account_id ||
    !!t.own_stripe_test_account_id ||
    (!!t.stripe_onboarding_complete && t.stripe_account_status === 'active')
  );
}

export function loginPoints(days: number | null): number {
  if (days === null) return 0;
  if (days <= 3) return 30;
  if (days <= 7) return 22;
  if (days <= 14) return 12;
  if (days <= 30) return 5;
  return 0;
}

export function bookingPoints(count: number): number {
  if (count >= 10) return 30;
  if (count >= 6) return 26;
  if (count >= 3) return 20;
  if (count >= 1) return 12;
  return 0;
}

/**
 * The subscription that represents the tenant today: a live one first, then
 * the most recent. A tenant migrated between Stripe platforms keeps its old
 * cancelled row beside the live one — same rule as `selectSubscription` in
 * lib/customer-management/schedule.ts.
 */
export function currentSubscription(rows: readonly SubscriptionFacts[]): SubscriptionFacts | null {
  if (rows.length === 0) return null;
  const live = rows.filter((r) => LIVE.has(r.status));
  const pool = live.length > 0 ? live : rows;
  return pool.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
}

/**
 * Did the last charge fail? The newest invoice that is not void: `open` after
 * at least one attempt, or `uncollectible`, is a failed payment. A brand-new
 * `open` invoice nobody has tried to charge yet is not.
 */
export function lastPaymentFailed(invoices: readonly InvoiceFacts[]): boolean {
  const real = invoices.filter((i) => i.status !== 'void' && i.status !== 'draft');
  if (real.length === 0) return false;
  const latest = real.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  if (latest.status === 'uncollectible') return true;
  return latest.status === 'open' && (latest.attempt_count ?? 0) > 0;
}

export function paymentState(
  subs: readonly SubscriptionFacts[],
  invoices: readonly InvoiceFacts[],
  now: Date,
): PaymentState {
  const sub = currentSubscription(subs);
  if (!sub || !LIVE.has(sub.status)) return 'none';
  if (sub.status === 'past_due' || sub.status === 'unpaid' || lastPaymentFailed(invoices)) return 'failed';
  if (sub.cancel_at && new Date(sub.cancel_at).getTime() > now.getTime()) return 'cancelling';
  if (sub.status === 'trialing') return 'trialing';
  return 'paid';
}

const PAYMENT_POINTS: Record<PaymentState, number> = {
  paid: 25,
  trialing: 18,
  cancelling: 5,
  failed: 0,
  none: 0,
};

const PAYMENT_LABEL: Record<PaymentState, string> = {
  paid: 'Subscription paid',
  trialing: 'On free trial',
  cancelling: 'Cancellation scheduled',
  failed: 'Last payment failed',
  none: 'No active subscription',
};

export function daysBetween(from: string | null, now: Date): number | null {
  if (!from) return null;
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

function loginLabel(days: number | null): string {
  if (days === null) return 'No login in the last 90 days';
  if (days === 0) return 'Logged in today';
  if (days === 1) return 'Last login yesterday';
  return `Last login ${days} days ago`;
}

function bookingLabel(count: number): string {
  if (count === 0) return 'No bookings in the last 30 days';
  return `${count} ${count === 1 ? 'booking' : 'bookings'} in the last 30 days`;
}

export function scoreTenant(input: HealthInput): HealthResult {
  const daysSinceLogin = daysBetween(input.lastLoginAt, input.now);
  const payment = paymentState(input.subscriptions, input.invoices, input.now);
  const stripe = stripeConnected(input.tenant);
  const bonzah = input.bonzahFormSent || !!input.tenant.integration_bonzah;

  const logins = loginPoints(daysSinceLogin);
  const bookings = bookingPoints(input.bookingsLast30Days);
  const pay = PAYMENT_POINTS[payment];
  const setup = (stripe ? 8 : 0) + (bonzah ? 7 : 0);

  const setupLabel =
    stripe && bonzah
      ? 'Stripe and Bonzah set up'
      : !stripe && !bonzah
        ? 'Stripe not connected, Bonzah form not sent'
        : !stripe
          ? 'Stripe not connected'
          : 'Bonzah form not sent';

  const score = logins + bookings + pay + setup;

  return {
    score,
    band: bandFor(score),
    parts: {
      logins: { points: logins, max: MAX_POINTS.logins, label: loginLabel(daysSinceLogin), concern: logins < 22 },
      bookings: {
        points: bookings,
        max: MAX_POINTS.bookings,
        label: bookingLabel(input.bookingsLast30Days),
        concern: bookings === 0,
      },
      payment: {
        points: pay,
        max: MAX_POINTS.payment,
        label: PAYMENT_LABEL[payment],
        concern: payment === 'failed' || payment === 'none' || payment === 'cancelling',
      },
      setup: { points: setup, max: MAX_POINTS.setup, label: setupLabel, concern: setup < MAX_POINTS.setup },
    },
    daysSinceLogin,
    bookingsLast30Days: input.bookingsLast30Days,
    payment,
    stripeConnected: stripe,
    bonzahFormSent: bonzah,
    ageDays: daysBetween(input.tenant.created_at, input.now) ?? 0,
  };
}

/** Ten buckets for the distribution chart: 0–9, 10–19, … 90–100. */
export function scoreBuckets(scores: readonly number[]): { range: string; from: number; count: number; band: HealthBand }[] {
  return Array.from({ length: 10 }, (_, i) => {
    const from = i * 10;
    const to = i === 9 ? 100 : from + 9;
    return {
      range: `${from}–${to}`,
      from,
      count: scores.filter((s) => s >= from && s <= to).length,
      band: bandFor(from),
    };
  });
}
