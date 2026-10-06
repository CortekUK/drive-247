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

/** The longest trial the admin page may set. Matches the DB CHECKs. */
export const MAX_TRIAL_DAYS = 90;

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

// =============================================================================
// Trials for specific people (`signup_trial_grants`)
//
// A super admin can give a trial to ONE new signup by email, with any length
// up to MAX_TRIAL_DAYS. It overrides the plan's trial, on whichever plan they
// pick. Every read here tolerates the table not existing yet (the migration is
// applied by hand) — a missing table means "no grant", never a failed signup.
// =============================================================================

export interface TrialGrant {
  id: string;
  trialDays: number;
}

export function normaliseEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** The open (unused, not removed) grant for this email, or null. */
export async function findTrialGrant(supabase: any, email: unknown): Promise<TrialGrant | null> {
  const key = normaliseEmail(email);
  if (!key) return null;
  try {
    const { data, error } = await supabase
      .from("signup_trial_grants")
      .select("id, trial_days")
      .eq("email", key)
      .is("used_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const days = normaliseTrialDays(data.trial_days);
    return days > 0 ? { id: data.id as string, trialDays: days } : null;
  } catch {
    return null;
  }
}

/** The trial this signup gets: their personal grant if any, else the plan's. */
export async function resolveTrialDays(
  supabase: any,
  email: unknown,
  plan: { trialDays?: number },
): Promise<number> {
  const grant = await findTrialGrant(supabase, email);
  return grant ? grant.trialDays : normaliseTrialDays(plan.trialDays ?? 0);
}

/**
 * Called once the portal exists: the grant is spent, and the admin list shows
 * which company it went to. Never throws — the tenant is already built, and a
 * grant left open is only a second trial for the same email, which signup
 * cannot reach anyway (the email is now taken).
 */
export async function markTrialGrantUsed(
  supabase: any,
  email: unknown,
  tenantId: string,
  subscriptionId: string | null,
): Promise<void> {
  const key = normaliseEmail(email);
  if (!key) return;
  try {
    await supabase
      .from("signup_trial_grants")
      .update({ used_at: new Date().toISOString(), used_tenant_id: tenantId, used_subscription_id: subscriptionId })
      .eq("email", key)
      .is("used_at", null)
      .is("revoked_at", null);
  } catch (e) {
    console.warn("[signup-trial] could not mark grant used (non-fatal):", e);
  }
}
