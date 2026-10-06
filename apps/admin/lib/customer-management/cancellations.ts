/**
 * Cancellation intelligence — who left, when, and why.
 *
 * Pure: no React, no Supabase. The Cancellations tab loads the rows and hands
 * them here, so the rules can be tested without a database.
 *
 * ── WHO COUNTS ──────────────────────────────────────────────────────────────
 *
 *   LEFT     no live subscription (active / trialing / past_due) AND either a
 *            subscription that was cancelled, or the company was suspended.
 *            Someone whose signup payment simply never completed
 *            (incomplete / incomplete_expired only) never became a customer
 *            and is not counted.
 *   LEAVING  still live, but cancellation is scheduled (cancel_at in the
 *            future) or they have an open cancellation request.
 *   STAYED   still live, went into the v2 cancel flow, and took the help
 *            instead — booked a call ("Book a call" + an issue type) or
 *            accepted the discount. Their reason counts too: it is why they
 *            nearly left.
 *
 * A UAE-migrated operator keeps its cancelled UK row beside the live UAE one;
 * the live row is what decides, so a migration is never counted as churn.
 *
 * ── WHERE THE REASON COMES FROM, most trusted first ─────────────────────────
 *
 *   1. admin     a super admin recorded it (tenant_churn_reasons)
 *   2. request   what they picked / wrote when asking to cancel — the
 *                reason dropdown in v1 and v2 ("CANCELLATION — It's too
 *                expensive. …"), or older v1 free text read for keywords
 *   2b. call     the issue type they picked when they booked a call instead
 *                ("CALL REQUESTED — I need help setting things up. …"), or
 *                "Too expensive" when they took the discount
 *   3. stripe    feedback the customer gave Stripe, then Stripe's own
 *                reason when a payment failed or was disputed
 *   4. inferred  Stripe never connected and setup never completed →
 *                "Never finished setup"
 *   otherwise    "No reason given"
 */

export type ChurnReason =
  | 'too_expensive'
  | 'missing_features'
  | 'switched_tools'
  | 'not_using'
  | 'closing_business'
  | 'technical_problems'
  | 'never_finished_setup'
  | 'setup_help'
  | 'billing_question'
  | 'integration_problems'
  | 'payment_failed'
  | 'other'
  | 'unknown';

export const REASON_LABEL: Record<ChurnReason, string> = {
  too_expensive: 'Too expensive',
  missing_features: 'Missing features',
  switched_tools: 'Switched to another tool',
  not_using: 'Not using it enough',
  closing_business: 'Closing or pausing the business',
  technical_problems: 'Technical problems',
  never_finished_setup: 'Never finished setup',
  setup_help: 'Needed help setting up',
  billing_question: 'Billing or payments question',
  integration_problems: 'Integration problems',
  payment_failed: 'Payment failed',
  other: 'Other',
  unknown: 'No reason given',
};

/** The reasons an admin may record (everything except "no reason given"). */
export const SETTABLE_REASONS: readonly Exclude<ChurnReason, 'unknown'>[] = [
  'too_expensive',
  'missing_features',
  'switched_tools',
  'not_using',
  'closing_business',
  'technical_problems',
  'never_finished_setup',
  'setup_help',
  'billing_question',
  'integration_problems',
  'payment_failed',
  'other',
];

export type ReasonSource = 'admin' | 'request' | 'call' | 'discount' | 'stripe' | 'inferred' | 'none';

export const SOURCE_LABEL: Record<ReasonSource, string> = {
  admin: 'Recorded by admin',
  request: 'They told us when cancelling',
  call: 'Booked a call about it',
  discount: 'Took the discount instead',
  stripe: 'From Stripe',
  inferred: 'Worked out from their setup',
  none: 'Not known',
};

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export interface ChurnTenant {
  id: string;
  company_name: string | null;
  slug: string | null;
  created_at: string;
  status: string | null;
  portal_experience: string | null;
  setup_completed_at: string | null;
  stripe_onboarding_complete: boolean | null;
  stripe_account_status: string | null;
  own_stripe_account_id: string | null;
  own_stripe_test_account_id: string | null;
}

export interface ChurnSubscription {
  status: string;
  plan_name: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  created_at: string;
  cancel_at: string | null;
  canceled_at: string | null;
  ended_at: string | null;
  cancellation_reason: string | null;
  cancellation_feedback: string | null;
  cancellation_comment: string | null;
}

export interface ChurnRequest {
  status: string;
  note: string | null;
  created_at: string;
}

export interface ChurnOverride {
  reason: string;
  note: string | null;
  updated_at: string;
}

export type ChurnState = 'left' | 'leaving' | 'stayed';

export const STATE_LABEL: Record<ChurnState, string> = {
  left: 'Left',
  leaving: 'Leaving',
  stayed: 'Tried to cancel, stayed',
};

export interface ChurnRow {
  tenant: ChurnTenant;
  state: ChurnState;
  /** When they left (or are scheduled to). Null for a suspension with no subscription dates. */
  leftAt: string | null;
  reason: ChurnReason;
  source: ReasonSource;
  /** Their own words, Stripe's comment, or the admin's note. */
  detail: string | null;
  portal: 'v1' | 'v2';
  plan: string | null;
  monthlyCents: number | null;
  currency: string;
  /** Total they paid us over their life. */
  paidCents: number;
  monthsAsCustomer: number | null;
  stripeConnected: boolean;
}

/* -------------------------------------------------------------------------- */
/* Reading what they said                                                      */
/* -------------------------------------------------------------------------- */

/** v2's dropdown, word for word (portal billing-v2/cancel-flow-dialog-v2.tsx). */
const V2_REASON: Record<string, ChurnReason> = {
  "it's too expensive": 'too_expensive',
  "it's missing features i need": 'missing_features',
  "i'm switching to another tool": 'switched_tools',
  "i'm not using it enough": 'not_using',
  "i'm closing or pausing the business": 'closing_business',
  'technical problems': 'technical_problems',
  'something else': 'other',
};

/** Free text (v1, or v2's "tell us more") → a reason, by keywords. */
export function classifyText(text: string | null | undefined): ChurnReason | null {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return null;
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (has('expensive', 'price', 'pricing', 'cost', 'afford', 'cheaper', 'too much money', 'budget')) return 'too_expensive';
  if (has('switch', 'another tool', 'another software', 'another platform', 'competitor', 'moving to', 'going with', 'other system')) return 'switched_tools';
  if (has('feature', 'missing', "doesn't have", 'does not have', 'need a way to', 'wish it')) return 'missing_features';
  if (has('closing', 'closed', 'shut down', 'shutting', 'out of business', 'selling the business', 'pausing', 'pause the business', 'retire')) return 'closing_business';
  if (has('not using', "don't use", 'do not use', 'rarely use', 'no time', 'not enough bookings', 'no bookings')) return 'not_using';
  if (has('bug', 'broken', 'not working', "doesn't work", 'error', 'crash', 'slow', 'glitch', 'problem')) return 'technical_problems';
  if (has('setup', 'set up', 'onboarding', 'complicated', 'confusing', 'too hard')) return 'never_finished_setup';
  return 'other';
}

/** v2's "Book a call" issue types, word for word (cancel-flow-dialog-v2.tsx ISSUE_TYPES). */
const V2_ISSUE: Record<string, ChurnReason> = {
  "something isn't working as expected": 'technical_problems',
  "i need a feature that's missing": 'missing_features',
  'i need help setting things up': 'setup_help',
  'a billing or payments question': 'billing_question',
  'an integration (stripe, e-signing, insurance…)': 'integration_problems',
  'an integration (stripe, e-signing, insurance...)': 'integration_problems',
  'something else': 'other',
};

export type RequestKind = 'cancel' | 'call' | 'discount';

export interface ParsedRequest {
  kind: RequestKind;
  reason: ChurnReason;
  detail: string | null;
}

/**
 * One request's note → what they did, why, and the words worth showing.
 *
 *   "CANCELLATION — <reason>. <words>"      asked to cancel (v1 and v2)
 *   "CALL REQUESTED — <issue type>. <words>" booked a call instead (v2)
 *   "RETENTION OFFER ACCEPTED — …"          took the discount (v2) → too expensive
 *   anything else                           older v1 free text → cancel, keywords
 */
export function parseRequestNote(note: string | null | undefined): ParsedRequest | null {
  const raw = (note ?? '').trim();
  if (!raw) return null;

  if (/^RETENTION OFFER ACCEPTED/i.test(raw)) {
    return { kind: 'discount', reason: 'too_expensive', detail: null };
  }

  const call = raw.match(/^CALL REQUESTED\s*[—-]\s*(.+?)\.(?:\s+([\s\S]*))?$/i);
  if (call) {
    const picked = call[1].trim().toLowerCase();
    const details = call[2]?.trim() || null;
    const mapped = V2_ISSUE[picked];
    return {
      kind: 'call',
      reason: mapped && mapped !== 'other' ? mapped : classifyText(details) ?? 'other',
      detail: details,
    };
  }

  const v2 = raw.match(/^CANCELLATION\s*[—-]\s*(.+?)\.(?:\s+([\s\S]*))?$/);
  if (v2) {
    const picked = v2[1].trim().toLowerCase();
    const details = v2[2]?.trim() || null;
    const mapped = V2_REASON[picked];
    if (mapped && mapped !== 'other') return { kind: 'cancel', reason: mapped, detail: details };
    // "Something else" — their own words may still say which.
    return { kind: 'cancel', reason: classifyText(details) ?? 'other', detail: details };
  }
  return { kind: 'cancel', reason: classifyText(raw) ?? 'other', detail: raw };
}

/** Stripe's customer feedback codes → our reasons. */
export function fromStripeFeedback(code: string | null | undefined): ChurnReason | null {
  switch (code) {
    case 'too_expensive': return 'too_expensive';
    case 'missing_features': return 'missing_features';
    case 'switched_service': return 'switched_tools';
    case 'unused': return 'not_using';
    case 'too_complex': return 'never_finished_setup';
    case 'low_quality': return 'technical_problems';
    case 'customer_service': return 'other';
    case 'other': return 'other';
    default: return null;
  }
}

/* -------------------------------------------------------------------------- */
/* One company                                                                 */
/* -------------------------------------------------------------------------- */

const LIVE = new Set(['active', 'trialing', 'past_due']);
const DAY_MS = 86_400_000;

export function stripeConnected(t: ChurnTenant): boolean {
  return (
    !!t.own_stripe_account_id ||
    !!t.own_stripe_test_account_id ||
    (!!t.stripe_onboarding_complete && t.stripe_account_status === 'active')
  );
}

function latest<T>(rows: readonly T[], at: (r: T) => string | null): T | null {
  let best: T | null = null;
  let bestAt = '';
  for (const r of rows) {
    const v = at(r) ?? '';
    if (best === null || v > bestAt) {
      best = r;
      bestAt = v;
    }
  }
  return best;
}

function toMonthly(sub: ChurnSubscription | null): number | null {
  if (!sub || typeof sub.amount !== 'number') return null;
  return sub.interval === 'year' ? Math.round(sub.amount / 12) : sub.amount;
}

export function resolveChurn(args: {
  tenant: ChurnTenant;
  subscriptions: readonly ChurnSubscription[];
  requests: readonly ChurnRequest[];
  override: ChurnOverride | null;
  paidCents: number;
  now: Date;
}): ChurnRow | null {
  const { tenant, subscriptions, requests, override, now } = args;

  const live = subscriptions.filter((s) => LIVE.has(s.status));
  const cancelled = subscriptions.filter((s) => s.status === 'canceled');
  const parsed = requests
    .map((r) => ({ r, p: parseRequestNote(r.note) }))
    .filter((x): x is { r: ChurnRequest; p: ParsedRequest } => x.p !== null);
  const cancelAsks = parsed.filter((x) => x.p.kind === 'cancel');
  const helpAsks = parsed.filter((x) => x.p.kind !== 'cancel');
  const openRequest = latest(
    cancelAsks.filter((x) => x.r.status === 'pending'),
    (x) => x.r.created_at,
  );
  const lastHelp = latest(helpAsks, (x) => x.r.created_at);

  let state: ChurnState | null = null;
  let leftAt: string | null = null;
  let planSub: ChurnSubscription | null = null;

  if (live.length > 0) {
    const current = latest(live, (s) => s.created_at)!;
    const scheduled = current.cancel_at && new Date(current.cancel_at).getTime() > now.getTime();
    if (scheduled) {
      state = 'leaving';
      leftAt = current.cancel_at;
    } else if (openRequest) {
      state = 'leaving';
      leftAt = openRequest.r.created_at;
    } else if (lastHelp) {
      state = 'stayed';
      leftAt = lastHelp.r.created_at;
    }
    planSub = current;
  } else if (cancelled.length > 0 || tenant.status === 'suspended') {
    state = 'left';
    planSub = latest(cancelled, (s) => s.ended_at ?? s.canceled_at);
    leftAt = planSub ? planSub.ended_at ?? planSub.canceled_at : null;
  }

  if (!state) return null;

  // ---- the reason ---------------------------------------------------------
  let reason: ChurnReason = 'unknown';
  let source: ReasonSource = 'none';
  let detail: string | null = null;

  const said = latest(cancelAsks, (x) => x.r.created_at);
  const feedback = fromStripeFeedback(planSub?.cancellation_feedback);
  const stripePayment =
    planSub?.cancellation_reason === 'payment_failed' || planSub?.cancellation_reason === 'payment_disputed';
  const connected = stripeConnected(tenant);

  if (override && (SETTABLE_REASONS as readonly string[]).includes(override.reason)) {
    reason = override.reason as ChurnReason;
    source = 'admin';
    detail = override.note;
  } else if (said) {
    reason = said.p.reason;
    source = 'request';
    detail = said.p.detail;
  } else if (lastHelp) {
    reason = lastHelp.p.reason;
    source = lastHelp.p.kind === 'call' ? 'call' : 'discount';
    detail = lastHelp.p.detail;
  } else if (feedback) {
    reason = feedback;
    source = 'stripe';
    detail = planSub?.cancellation_comment ?? null;
  } else if (stripePayment) {
    reason = 'payment_failed';
    source = 'stripe';
    detail = planSub?.cancellation_reason === 'payment_disputed' ? 'The payment was disputed.' : null;
  } else if (!connected && !tenant.setup_completed_at) {
    reason = 'never_finished_setup';
    source = 'inferred';
    detail = 'Never connected Stripe, so they never took a payment through Drive247.';
  }

  const firstSub = subscriptions.length ? subscriptions.reduce((a, b) => (a.created_at <= b.created_at ? a : b)) : null;
  const start = firstSub?.created_at ?? tenant.created_at;
  const end = leftAt ?? now.toISOString();
  const months = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / (30.44 * DAY_MS)));

  return {
    tenant,
    state,
    leftAt,
    reason,
    source,
    detail,
    portal: tenant.portal_experience === 'v2' ? 'v2' : 'v1',
    plan: planSub?.plan_name ?? null,
    monthlyCents: toMonthly(planSub),
    currency: planSub?.currency ?? 'usd',
    paidCents: args.paidCents,
    monthsAsCustomer: Number.isFinite(months) ? months : null,
    stripeConnected: connected,
  };
}

/* -------------------------------------------------------------------------- */
/* The report                                                                  */
/* -------------------------------------------------------------------------- */

export type Period = '30' | '90' | '365' | 'all';

export const PERIOD_LABEL: Record<Period, string> = {
  '30': 'Last 30 days',
  '90': 'Last 3 months',
  '365': 'Last 12 months',
  all: 'All time',
};

/** In the period? A row with no date only shows under "All time". */
export function inPeriod(row: ChurnRow, period: Period, now: Date): boolean {
  if (period === 'all') return true;
  if (!row.leftAt) return false;
  const days = Number(period);
  const t = new Date(row.leftAt).getTime();
  return t >= now.getTime() - days * DAY_MS;
}

export interface ReasonShare {
  reason: ChurnReason;
  label: string;
  count: number;
  /** Whole percent of all rows. */
  percent: number;
}

/** Reasons by count, largest first; ties keep the label order. Split by state for the stacked chart. */
export function reasonShares(rows: readonly ChurnRow[]): (ReasonShare & Record<ChurnState, number>)[] {
  const counts = new Map<ChurnReason, Record<ChurnState, number>>();
  for (const r of rows) {
    const c = counts.get(r.reason) ?? { left: 0, leaving: 0, stayed: 0 };
    c[r.state] += 1;
    counts.set(r.reason, c);
  }
  const total = rows.length || 1;
  return [...counts.entries()]
    .map(([reason, c]) => {
      const count = c.left + c.leaving + c.stayed;
      return { reason, label: REASON_LABEL[reason], count, percent: Math.round((count / total) * 100), ...c };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The one-line answer the brief asks for:
 * "Last 3 months: 40% too expensive, 25% never finished setup, 15% switched tools."
 */
export function headline(rows: readonly ChurnRow[], period: Period): string {
  if (rows.length === 0) return `${PERIOD_LABEL[period]}: nobody left.`;
  const top = reasonShares(rows)
    .slice(0, 3)
    .map((s) => `${s.percent}% ${s.label.toLowerCase()}`);
  return `${PERIOD_LABEL[period]}: ${top.join(', ')}.`;
}
