/**
 * Can this tenant's platform plan take a premium integration? PURE — the same
 * preconditions the edge function enforces (build spec D8), asked up front so
 * the dialog can say so instead of offering a Subscribe that will be refused.
 * The function still decides; this only picks the words.
 */
export type PlanState = 'loading' | 'none' | 'past_due' | 'ending' | 'not_monthly' | 'currency' | 'ok';

export interface PlanLike {
  status: string;
  interval?: string | null;
  currency?: string | null;
  current_period_end?: string | null;
  trial_end?: string | null;
  cancel_at?: string | null;
  canceled_at?: string | null;
}

const LIVE = ['active', 'trialing', 'past_due'];

export function planStateOf(plan: PlanLike | null | undefined, isLoading: boolean, priceCurrency = 'usd'): PlanState {
  if (isLoading) return 'loading';
  if (!plan || !LIVE.includes(plan.status)) return 'none';
  if (plan.status === 'past_due') return 'past_due';
  if (plan.cancel_at || plan.canceled_at) return 'ending';
  if ((plan.interval ?? 'month') !== 'month') return 'not_monthly';
  if (String(plan.currency ?? 'usd').toLowerCase() !== priceCurrency.toLowerCase()) return 'currency';
  return 'ok';
}

/** When the next bill is raised: the trial's end while trialing, else the period's end. */
export function nextBillAt(plan: PlanLike | null | undefined): string | null {
  if (!plan) return null;
  if (plan.status === 'trialing') return plan.trial_end ?? plan.current_period_end ?? null;
  return plan.current_period_end ?? null;
}

/** What the dialog says instead of a Subscribe button. */
export const PLAN_STATE_COPY: Record<Exclude<PlanState, 'ok' | 'loading'>, string> = {
  none: 'Premium integrations are added to your Drive247 bill, so start your plan in Billing first.',
  past_due: 'Your last Drive247 bill has not been paid. Settle it in Billing, then come back to subscribe.',
  ending: 'Your Drive247 plan is set to end, so there is no next bill to add this to.',
  not_monthly: 'Premium integrations are billed monthly and your plan is not. Email support@drive-247.com and we will add it for you.',
  currency: 'Your plan is billed in another currency. Email support@drive-247.com and we will add it for you.',
};
