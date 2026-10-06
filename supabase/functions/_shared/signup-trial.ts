// =============================================================================
// Free trials on self-serve signup — the rules every signup function shares.
//
// A super admin sets `signup_plans.trial_days` per plan. When it is above 0 the
// signup subscription is created with `trial_period_days`: nothing is charged
// today, the card is SAVED through the subscription's `pending_setup_intent`
// (instead of paid through the first invoice's PaymentIntent), and Stripe
// charges it automatically when the trial ends.
//
// THE TRAP THIS FILE EXISTS FOR. Every signup function used to treat
// `status === "trialing"` as "paid". With a trial, Stripe puts the subscription
// in `trialing` THE MOMENT IT IS CREATED — before any card is entered. Without
// `isSecured`, opening the card step and closing the tab would have counted as
// a completed payment and provisioned a free portal with no card on file.
//
// So a trialing subscription only counts once its card is saved, and
// `trial_settings.end_behavior.missing_payment_method = "cancel"` is the
// backstop: a trial that somehow ends with no card cancels instead of leaving
// an unpaid invoice behind.
// =============================================================================

/** The longest trial the admin page may set. Matches the DB CHECK. */
export const MAX_TRIAL_DAYS = 30;

/** 0 for anything that is not a whole number of days in range. */
export function normaliseTrialDays(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_TRIAL_DAYS ? n : 0;
}

/** Spread into `stripe.subscriptions.create` — empty when there is no trial. */
export function trialCreateParams(trialDays: number): Record<string, unknown> {
  if (trialDays <= 0) return {};
  return {
    trial_period_days: trialDays,
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
  };
}

function pendingSetupIntent(sub: any): any | null {
  const si = sub?.pending_setup_intent;
  return si && typeof si === "object" ? si : null;
}

/**
 * Has this subscription got what the signup needs to go ahead?
 *
 *   active   — the first invoice is paid.
 *   trialing — only once a card is saved: the subscription has a default
 *              payment method, or its setup intent has succeeded.
 *
 * Pass a subscription retrieved with `expand: ["pending_setup_intent"]`;
 * without the expansion a trialing subscription with no default card reads as
 * unsecured, which fails safe.
 */
export function isSecured(sub: any): boolean {
  if (!sub) return false;
  if (sub.status === "active") return true;
  if (sub.status !== "trialing") return false;
  if (sub.default_payment_method) return true;
  return pendingSetupIntent(sub)?.status === "succeeded";
}

/** A trialing subscription still waiting for its card. */
export function isAwaitingCard(sub: any): boolean {
  return sub?.status === "trialing" && !isSecured(sub);
}

/** The client secret the browser confirms to save the card, while it still can. */
export function setupClientSecretOf(sub: any): string | null {
  const si = pendingSetupIntent(sub);
  if (!si || typeof si.client_secret !== "string") return null;
  return ["requires_payment_method", "requires_confirmation", "requires_action"].includes(si.status)
    ? si.client_secret
    : null;
}

/** The card the setup intent saved, when Stripe did not copy it onto the subscription. */
export function savedPaymentMethodOf(sub: any): string | null {
  const si = pendingSetupIntent(sub);
  if (si?.status !== "succeeded") return null;
  const pm = si.payment_method;
  return typeof pm === "string" ? pm : typeof pm?.id === "string" ? pm.id : null;
}

/** ISO date the trial ends, or null. */
export function trialEndIso(sub: any): string | null {
  return typeof sub?.trial_end === "number" ? new Date(sub.trial_end * 1000).toISOString() : null;
}

/**
 * Whether an existing, not-yet-secured subscription was made under different
 * trial terms than the plan now has — the admin switched the trial on or off,
 * or changed its length, mid-signup. Such a subscription is replaced so the
 * visitor gets what the pricing card now says.
 */
export function trialTermsChanged(sub: any, trialDays: number): boolean {
  const hasTrial = typeof sub?.trial_end === "number" && typeof sub?.trial_start === "number";
  if (trialDays <= 0) return hasTrial;
  if (!hasTrial) return true;
  const days = Math.round((sub.trial_end - sub.trial_start) / 86_400);
  return days !== trialDays;
}
