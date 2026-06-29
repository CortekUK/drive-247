// Shared Stripe client helper for per-tenant mode support
// This module provides functions to get the correct Stripe client and keys based on tenant's mode

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export type StripeMode = 'test' | 'live';

/**
 * Get Stripe client initialized with the correct API key for the given mode
 */
export function getStripeClient(mode: StripeMode): Stripe {
  const secretKey = mode === 'live'
    ? Deno.env.get('STRIPE_LIVE_SECRET_KEY')
    : Deno.env.get('STRIPE_TEST_SECRET_KEY');

  if (!secretKey) {
    throw new Error(`Missing Stripe secret key for ${mode} mode`);
  }

  return new Stripe(secretKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Get publishable key for the given mode
 */
export function getPublishableKey(mode: StripeMode): string {
  const key = mode === 'live'
    ? Deno.env.get('STRIPE_LIVE_PUBLISHABLE_KEY')
    : Deno.env.get('STRIPE_TEST_PUBLISHABLE_KEY');

  if (!key) {
    throw new Error(`Missing Stripe publishable key for ${mode} mode`);
  }

  return key;
}

/**
 * Get webhook secret for the given mode
 */
export function getWebhookSecret(mode: StripeMode): string {
  const secret = mode === 'live'
    ? Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')
    : Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET');

  if (!secret) {
    throw new Error(`Missing Stripe webhook secret for ${mode} mode`);
  }

  return secret;
}

/**
 * Get Connect webhook secret (live mode only)
 */
export function getConnectWebhookSecret(): string {
  const secret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET');

  if (!secret) {
    throw new Error('Missing Stripe Connect webhook secret');
  }

  return secret;
}

/**
 * Get tenant's Stripe mode from database
 */
export async function getTenantStripeMode(
  supabase: SupabaseClient,
  tenantId: string
): Promise<StripeMode> {
  const { data, error } = await supabase
    .from('tenants')
    .select('stripe_mode')
    .eq('id', tenantId)
    .single();

  if (error || !data) {
    console.error('Failed to get tenant stripe mode, defaulting to test:', error);
    return 'test'; // Safe default
  }

  return (data.stripe_mode as StripeMode) || 'test';
}

/**
 * Get the appropriate Stripe Connect account ID for a tenant
 * - In test mode: Returns shared test Connect account
 * - In live mode: Returns tenant's own Connect account (if onboarding complete)
 */
export function getConnectAccountId(tenant: {
  stripe_mode: string;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
}): string | null {
  if (tenant.stripe_mode === 'test') {
    // All test tenants use the shared test Connect account
    return Deno.env.get('STRIPE_TEST_CONNECT_ACCOUNT_ID') || null;
  }

  if (tenant.stripe_mode === 'live' && tenant.stripe_onboarding_complete) {
    // Live tenants use their own Connect account
    return tenant.stripe_account_id;
  }

  return null; // No routing - payment goes to platform
}

/**
 * Create Stripe options object for API calls targeting connected accounts
 */
export function getStripeOptions(connectAccountId: string | null): Stripe.RequestOptions | undefined {
  return connectAccountId ? { stripeAccount: connectAccountId } : undefined;
}

/**
 * payment_method_options.card for a deposit-hold PaymentIntent.
 *
 * - request_extended_authorization: asks the card network to keep the hold
 *   alive up to ~30 days (Visa/Amex/Discover support it). WITHOUT this the auth
 *   expires at the network default of ~7 days — which is what silently killed
 *   GMT's deposit holds on every rental that ran longer than a week.
 * - request_multicapture: lets a partial capture keep the remainder authorised
 *   on the SAME PaymentIntent instead of releasing it.
 *
 * Both use "if_available" so Stripe ignores them where the card/account doesn't
 * support the feature (a hold is still placed, just at the 7-day default).
 */
export const DEPOSIT_HOLD_CARD_OPTIONS = {
  request_extended_authorization: 'if_available' as const,
  request_multicapture: 'if_available' as const,
};

/**
 * Ordered card-feature variants for a deposit hold, richest → plainest.
 *
 * "if_available" is *supposed* to make Stripe silently ignore a feature the
 * card/account doesn't support, but Connect accounts not approved for these
 * features actually throw "This account is not eligible for the requested card
 * features." (GMT's live account, acct_1SrIFEPcUIaEGCY0, does exactly this).
 * Any function that requests these features must downgrade through this list
 * until one succeeds, otherwise the whole call 500s.
 *
 * Order matters: we keep request_extended_authorization as long as possible so
 * eligible accounts retain the ~30-day hold lifetime; only the final `null`
 * falls back to the ~7-day network default (still kept alive by the
 * refresh-deposit-holds cron).
 */
export const DEPOSIT_HOLD_CARD_VARIANTS: Array<Record<string, string> | null> = [
  { request_extended_authorization: 'if_available', request_multicapture: 'if_available' },
  { request_extended_authorization: 'if_available' },
  null,
];

/** True when Stripe rejected a request because the account lacks a requested card feature. */
export function isCardFeatureIneligibleError(err: unknown): boolean {
  return String(err instanceof Error ? err.message : err)
    .toLowerCase()
    .includes('not eligible for the requested card features');
}

/**
 * Create a deposit-hold PaymentIntent, gracefully downgrading premium card
 * features (extended authorization, multicapture) when the Connect account is
 * not eligible for them. `basePayload` must NOT include payment_method_options
 * — this adds the right card block per attempt. `idempotencyKey` is suffixed
 * per variant so each downgraded retry is its own idempotent request.
 */
export async function createDepositHoldIntentWithFallback(
  stripe: Stripe,
  basePayload: Record<string, unknown>,
  requestOpts: Stripe.RequestOptions & { idempotencyKey: string }
): Promise<Stripe.PaymentIntent> {
  let lastErr: unknown = null;
  for (let i = 0; i < DEPOSIT_HOLD_CARD_VARIANTS.length; i++) {
    const card = DEPOSIT_HOLD_CARD_VARIANTS[i];
    const payload = card
      ? { ...basePayload, payment_method_options: { card } }
      : basePayload;
    const opts = i === 0
      ? requestOpts
      : { ...requestOpts, idempotencyKey: `${requestOpts.idempotencyKey}-cf${i}` };
    try {
      const pi = await stripe.paymentIntents.create(payload as any, opts);
      if (i > 0) console.warn(`[deposit-hold] card features downgraded to variant ${i} (account not eligible for full set)`);
      return pi;
    } catch (err) {
      if (isCardFeatureIneligibleError(err) && i < DEPOSIT_HOLD_CARD_VARIANTS.length - 1) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error('Failed to create deposit-hold PaymentIntent');
}

/**
 * Work out when a deposit-hold PaymentIntent ACTUALLY expires.
 *
 * Stripe surfaces the real deadline on the authorising charge as
 * `payment_method_details.card.capture_before` (unix seconds). When extended
 * authorization is granted this is ~30 days out; otherwise it's the ~7-day
 * default. We previously hardcoded +31 days everywhere, so the DB always
 * claimed the hold was alive long after Stripe had expired it. This reads the
 * truth from Stripe, expanding latest_charge when needed, and falls back to a
 * conservative 7 days if Stripe hasn't surfaced a deadline yet.
 *
 * @returns ISO timestamp string for deposit_hold_expires_at
 */
export async function resolveHoldExpiry(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent,
  stripeOptions?: Stripe.RequestOptions
): Promise<string> {
  try {
    const latestCharge = (paymentIntent as any).latest_charge;
    let charge: any = latestCharge && typeof latestCharge === 'object' ? latestCharge : null;

    if (!charge && typeof latestCharge === 'string') {
      charge = await stripe.charges.retrieve(latestCharge, stripeOptions);
    }

    const captureBefore = charge?.payment_method_details?.card?.capture_before;
    if (captureBefore) {
      return new Date(captureBefore * 1000).toISOString();
    }
  } catch (err) {
    console.warn('[HOLD-EXPIRY] Could not read capture_before, defaulting to 7 days:', err);
  }

  // Conservative default: standard card authorizations expire ~7 days out.
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 7);
  return fallback.toISOString();
}
