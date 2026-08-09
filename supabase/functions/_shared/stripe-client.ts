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
  payment_model?: string | null;
  own_stripe_account_id?: string | null;
  own_stripe_test_account_id?: string | null;
}): string | null {
  // Own Stripe (Standard account connected via OAuth on the UAE platform).
  // Callers that don't select the new columns fall through to the managed path,
  // which is correct for every tenant until their payment_model is flipped.
  if (tenant.payment_model === 'own') {
    if (tenant.stripe_mode === 'test') {
      // Setup phase: new tenants are born on the Own model but only connect
      // their real Stripe account at go-live. Until then let their TEST
      // bookings run on the shared test Connect account, exactly as managed
      // test tenants do. No real money can move in test mode, so there is
      // nothing to misroute.
      return (
        tenant.own_stripe_test_account_id ||
        Deno.env.get('STRIPE_TEST_CONNECT_ACCOUNT_ID') ||
        null
      );
    }
    // LIVE: never fall through to a null (= no stripeAccount) charge — that
    // would silently create the charge on the Drive247 platform balance
    // instead of the operator's account. Fail loud instead.
    if (!tenant.own_stripe_account_id) {
      throw new Error(
        `Tenant is on Own Stripe (payment_model='own') but has no connected LIVE account. ` +
        `Connect Stripe (OAuth) before taking live payments.`
      );
    }
    return tenant.own_stripe_account_id;
  }

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
 * DEPRECATED as a direct request payload — it is only the richest rung of
 * DEPOSIT_HOLD_CARD_VARIANTS below. Sending it without the downgrade ladder
 * makes the whole call 500 on any Connect account not approved for these
 * features (GMT's live account). New callers want
 * createDepositHoldIntentWithFallback.
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
 * falls back to the ~5-7 day network default (still kept alive by the
 * refresh-deposit-holds cron).
 *
 * The third rung (multicapture ALONE) was added Aug 2026. The list previously
 * went [{ext,mc}, {ext}, null], so an account refused the PAIR that would have
 * been granted multicapture on its own dropped straight to no card features at
 * all. GMT (acct_1SrIFEPcUIaEGCY0) is refused the pair; every rung that still
 * wins something is worth trying, because each granted feature is one fewer
 * link the chain has to survive.
 *
 * NOTE ON IDEMPOTENCY KEYS: callers suffix the key with the variant INDEX, so
 * inserting a rung shifts what index 2 means. Within Stripe's 24h replay window
 * a retry can therefore be handed the response the old index-2 (bare) attempt
 * produced. That is benign in both directions — a cached success is a real
 * PaymentIntent we still record, and a cached error just moves the loop on to
 * index 3, which is a brand-new key.
 */
export const DEPOSIT_HOLD_CARD_VARIANTS: Array<Record<string, string> | null> = [
  { request_extended_authorization: 'if_available', request_multicapture: 'if_available' },
  { request_extended_authorization: 'if_available' },
  { request_multicapture: 'if_available' },
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
 * How long we ASSUME an authorization lives when Stripe has not published a
 * capture_before for it.
 *
 * Was 7 days, which was an over-estimate and therefore the dangerous direction.
 * Visa's card-absent, merchant-initiated authorization window is 4d18h — with a
 * 7-day guess plus refresh-deposit-holds' 2-day lookahead, the row is first
 * examined roughly a day AFTER the real authorization already died, which is
 * the silent-death mode this whole workstream exists to kill. An under-estimate
 * costs one harmless early refresh; an over-estimate costs the deposit.
 *
 * Anything derived from this is stamped deposit_hold_expiry_source='fallback'
 * so downstream code can tell a guess from Stripe's own answer.
 */
export const HOLD_EXPIRY_FALLBACK_DAYS = 4;

export type HoldExpirySource = 'stripe_capture_before' | 'fallback';

/** Everything the DB wants to know about an authorization's lifetime. */
export interface HoldExpiryFacts {
  /** ISO timestamp for deposit_hold_expires_at. */
  expiresAt: string;
  /** Whether expiresAt is Stripe's answer or our floor. Maps 1:1 to deposit_hold_expiry_source. */
  source: HoldExpirySource;
  /** true/false when the network told us; null when unknown (never assume "granted"). */
  extendedAuth: boolean | null;
  /** Raw Stripe value ('enabled' | 'disabled'), kept verbatim for the ledger. */
  extendedAuthStatus: string | null;
  /** Seconds the network actually granted; null when we are guessing. */
  windowSeconds: number | null;
}

/**
 * Read the authorization facts off the authorising charge, or null when Stripe
 * has not published them.
 *
 * NEVER invents a value. Callers that need something to store can layer the
 * fallback on top (resolveHoldExpiryDetailed); callers that must not persist a
 * guess — verify-deposit-hold, whose whole job is reconciling against truth —
 * use this directly and leave the stored value alone on null.
 *
 * Throws on transport/auth failures; a caller that cannot tolerate that should
 * wrap it, and MUST NOT read the throw as "no deadline".
 */
export async function readHoldCaptureFacts(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent | Record<string, unknown>,
  stripeOptions?: Stripe.RequestOptions
): Promise<{
  captureBefore: string;
  extendedAuth: boolean | null;
  extendedAuthStatus: string | null;
  windowSeconds: number | null;
} | null> {
  const latestCharge = (paymentIntent as any).latest_charge;
  let charge: any = latestCharge && typeof latestCharge === 'object' ? latestCharge : null;

  // Callers expand latest_charge, so this second round-trip should not happen —
  // but a bare string id here would otherwise cost us the real deadline forever.
  if (!charge && typeof latestCharge === 'string') {
    charge = await stripe.charges.retrieve(latestCharge, stripeOptions);
  }

  const card = charge?.payment_method_details?.card;
  const captureBeforeUnix = card?.capture_before;
  if (typeof captureBeforeUnix !== 'number' || captureBeforeUnix <= 0) return null;

  const extendedAuthStatus = (card?.extended_authorization?.status as string | undefined) ?? null;
  // Measure the granted window from the charge, not from now: a hold read back
  // days later would otherwise look like it was granted a much shorter window.
  const createdUnix = typeof charge?.created === 'number' ? charge.created : Math.floor(Date.now() / 1000);

  return {
    captureBefore: new Date(captureBeforeUnix * 1000).toISOString(),
    extendedAuth: extendedAuthStatus === null ? null : extendedAuthStatus === 'enabled',
    extendedAuthStatus,
    windowSeconds: Math.max(0, captureBeforeUnix - createdUnix),
  };
}

/**
 * Work out when a deposit-hold PaymentIntent ACTUALLY expires, and say where
 * that answer came from.
 *
 * Stripe surfaces the real deadline on the authorising charge as
 * `payment_method_details.card.capture_before` (unix seconds). When extended
 * authorization is granted this is ~30 days out; otherwise it's the ~5-7 day
 * network default. We previously hardcoded +31 days everywhere, so the DB
 * always claimed the hold was alive long after Stripe had expired it.
 *
 * The fallback used to be silent — the only console.warn lived in the catch, so
 * the far more common case (Stripe simply had not published capture_before yet)
 * produced a +7d guess that no log, and no column, distinguished from a real
 * deadline. Both paths now log, and the caller gets the provenance so it can be
 * persisted alongside the timestamp.
 */
export async function resolveHoldExpiryDetailed(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent,
  stripeOptions?: Stripe.RequestOptions
): Promise<HoldExpiryFacts> {
  const piId = (paymentIntent as any)?.id ?? '(unknown)';
  try {
    const facts = await readHoldCaptureFacts(stripe, paymentIntent, stripeOptions);
    if (facts) {
      console.log(
        `[HOLD-EXPIRY] pi=${piId} source=stripe_capture_before expires=${facts.captureBefore} ` +
        `window=${facts.windowSeconds ? Math.round(facts.windowSeconds / 3600) : '?'}h ` +
        `extended_auth=${facts.extendedAuthStatus ?? 'not_reported'}`
      );
      return {
        expiresAt: facts.captureBefore,
        source: 'stripe_capture_before',
        extendedAuth: facts.extendedAuth,
        extendedAuthStatus: facts.extendedAuthStatus,
        windowSeconds: facts.windowSeconds,
      };
    }
    console.warn(
      `[HOLD-EXPIRY] pi=${piId} Stripe published no capture_before; ` +
      `assuming the ${HOLD_EXPIRY_FALLBACK_DAYS}-day floor (source=fallback)`
    );
  } catch (err) {
    console.warn(
      `[HOLD-EXPIRY] pi=${piId} could not read capture_before; ` +
      `assuming the ${HOLD_EXPIRY_FALLBACK_DAYS}-day floor (source=fallback):`,
      err
    );
  }

  return {
    expiresAt: new Date(Date.now() + HOLD_EXPIRY_FALLBACK_DAYS * 86400 * 1000).toISOString(),
    source: 'fallback',
    extendedAuth: null,
    extendedAuthStatus: null,
    // Deliberately null: we do not know what the network granted, and writing
    // the fallback's own length into deposit_hold_window_seconds would make a
    // guess indistinguishable from a measurement.
    windowSeconds: null,
  };
}

/**
 * Back-compat wrapper: same signature and return type this had before
 * provenance was added, for callers owned by other workstreams
 * (capture-deposit-hold, refresh-deposit-holds, sync-deposit-hold,
 * sandbox-refresh-deposit-holds). They get the tightened 4-day floor
 * automatically; only the provenance is dropped on the floor.
 *
 * @returns ISO timestamp string for deposit_hold_expires_at
 */
export async function resolveHoldExpiry(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent,
  stripeOptions?: Stripe.RequestOptions
): Promise<string> {
  return (await resolveHoldExpiryDetailed(stripe, paymentIntent, stripeOptions)).expiresAt;
}

// ---------------------------------------------------------------------------
// Deposit-hold CHAIN bound
//
// Not Stripe-specific, but this is the only module both the placement path
// (place-deposit-hold) and the reconciliation path (verify-deposit-hold)
// already share, and the derivation MUST NOT drift between them: they both
// write rentals.deposit_hold_chain_expires_at, which refresh-deposit-holds
// treats as a hard stop.
// ---------------------------------------------------------------------------

/**
 * How long past the rental's end date the deposit chain keeps re-authorising.
 *
 * PRODUCT DECISION NOT YET MADE. A chained hold has to stop somewhere, and the
 * stopping point is a business call (how long after handback may the operator
 * still charge for damage found later?), not an engineering one. 3 days is a
 * deliberately conservative placeholder — it is NOT a ratified policy. Raise it
 * here once the answer exists; nothing else keys off this number.
 */
export const CHAIN_GRACE_DAYS_AFTER_END = 3;

/**
 * The chain bound implied by a rental's CURRENT end date, or null when the
 * rental is open-ended (rentals.end_date is nullable) — null means "no ceiling
 * yet", which is how the refresher reads it.
 *
 * THIS VALUE IS A SNAPSHOT, NOT AN AUTHORITY. rentals.end_date moves whenever a
 * rental is extended, and an extension does NOT re-run placement — so a bound
 * frozen at placement time would terminate the chain on the ORIGINAL end date
 * and the deposit would silently stop being renewed while the car is still out.
 * Anything that persists this must therefore treat the stored column as a FLOOR
 * that is re-stamped FORWARD whenever a later end date is observed (see
 * verify-deposit-hold), and readers should prefer the live end date where they
 * have it.
 *
 * Pure by design: no `now` floor is applied here, because a caller that
 * re-stamps periodically would otherwise push the ceiling out on every call and
 * the chain would never terminate at all. Placement applies its own floor once,
 * deliberately.
 */
export function chainExpiryFromEndDate(endDate: string | null | undefined): string | null {
  if (!endDate) return null;
  // rentals.end_date is a DATE column, so new Date('2026-11-05') is UTC
  // MIDNIGHT — the START of the last rental day. Anchoring the grace window
  // there would silently cost a day, so anchor on the END of that day.
  const dayStart = new Date(`${String(endDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(dayStart.getTime())) return null;
  return new Date(
    dayStart.getTime() + (CHAIN_GRACE_DAYS_AFTER_END + 1) * 86_400_000 - 1
  ).toISOString();
}

// ---------------------------------------------------------------------------
// Multi-platform-account support (Own Stripe / UAE migration)
//
// Two platform Stripe accounts coexist during the migration:
//   'uk'  — the legacy account. Managed (Express) connected accounts and all
//           money objects created before a tenant is flipped live here.
//   'uae' — the new self-owned account. Operator-owned Standard accounts are
//           OAuth-connected to it; subscriptions/credits move here per tenant.
//
// Rules:
//  * NEW charges for a tenant use the account implied by tenants.payment_model
//    ('managed' → 'uk', 'own' → 'uae').
//  * Operations on EXISTING records (capture, refund, deposit ops) must use the
//    account the record was created under — payments.platform_account /
//    rentals.platform_account — NEVER the tenant's current model.
// ---------------------------------------------------------------------------

export type PlatformAccount = 'uk' | 'uae';

/** Standard column list for tenant selects feeding getConnectAccountId/context helpers. */
export const TENANT_STRIPE_COLUMNS =
  'stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id';

/** Which platform account NEW money objects for this tenant belong to. */
export function getChargePlatformAccount(tenant: { payment_model?: string | null }): PlatformAccount {
  return tenant.payment_model === 'own' ? 'uae' : 'uk';
}

/** Secret key for a platform account + mode. 'uk' preserves the legacy env names. */
function getSecretKeyForAccount(account: PlatformAccount, mode: StripeMode): string {
  const key = account === 'uae'
    ? Deno.env.get(mode === 'live' ? 'STRIPE_UAE_LIVE_SECRET_KEY' : 'STRIPE_UAE_TEST_SECRET_KEY')
    : Deno.env.get(mode === 'live' ? 'STRIPE_LIVE_SECRET_KEY' : 'STRIPE_TEST_SECRET_KEY');
  if (!key) throw new Error(`Missing Stripe secret key for account=${account} mode=${mode}`);
  return key;
}

export function getStripeClientForAccount(account: PlatformAccount, mode: StripeMode): Stripe {
  return new Stripe(getSecretKeyForAccount(account, mode), {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function getPublishableKeyForAccount(account: PlatformAccount, mode: StripeMode): string {
  const key = account === 'uae'
    ? Deno.env.get(mode === 'live' ? 'STRIPE_UAE_LIVE_PUBLISHABLE_KEY' : 'STRIPE_UAE_TEST_PUBLISHABLE_KEY')
    : Deno.env.get(mode === 'live' ? 'STRIPE_LIVE_PUBLISHABLE_KEY' : 'STRIPE_TEST_PUBLISHABLE_KEY');
  if (!key) throw new Error(`Missing Stripe publishable key for account=${account} mode=${mode}`);
  return key;
}

/**
 * All signing secrets a booking webhook should try, in order. During the
 * migration the same endpoint URL is registered on BOTH platform accounts, so
 * verification must attempt each account's secret before rejecting.
 */
export function getWebhookSecretCandidates(mode: StripeMode): string[] {
  return [
    Deno.env.get(mode === 'live' ? 'STRIPE_LIVE_WEBHOOK_SECRET' : 'STRIPE_TEST_WEBHOOK_SECRET'),
    Deno.env.get(mode === 'live' ? 'STRIPE_UAE_LIVE_WEBHOOK_SECRET' : 'STRIPE_UAE_TEST_WEBHOOK_SECRET'),
    // Belt-and-suspenders: own-tenant direct charges produce connected-account
    // events; whichever UAE endpoint they land on, its secret verifies here.
    // Only a LIVE connect secret exists. This must be spread in conditionally
    // rather than selected with a ternary: Deno.env.get('') throws
    // "TypeError: Key is an empty string", and it throws while the array literal
    // is being built — before .filter() can discard it. A ternary falling back to
    // '' therefore takes down every TEST-mode webhook event with an HTTP 500
    // instead of yielding one fewer candidate secret.
    ...(mode === 'live' ? [Deno.env.get('STRIPE_LIVE_CONNECT_WEBHOOK_SECRET')] : []),
    Deno.env.get('STRIPE_UAE_CONNECT_WEBHOOK_SECRET'),
  ].filter((s): s is string => !!s);
}

export function getConnectWebhookSecretCandidates(): string[] {
  return [
    Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET'),
    Deno.env.get('STRIPE_UAE_CONNECT_WEBHOOK_SECRET'),
  ].filter((s): s is string => !!s);
}

/**
 * One-stop context for creating NEW money objects for a tenant.
 * Selects the tenant's stripe columns, resolves mode, platform account,
 * connected account and a correctly-keyed client.
 */
export async function getTenantChargeContext(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{
  tenant: Record<string, unknown>;
  mode: StripeMode;
  platformAccount: PlatformAccount;
  stripe: Stripe;
  connectAccountId: string | null;
  stripeOptions: Stripe.RequestOptions | undefined;
}> {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(TENANT_STRIPE_COLUMNS)
    .eq('id', tenantId)
    .single();
  if (error || !tenant) throw new Error(`getTenantChargeContext: tenant ${tenantId} not found: ${error?.message}`);

  const mode = ((tenant as any).stripe_mode as StripeMode) || 'test';
  const platformAccount = getChargePlatformAccount(tenant as any);
  const connectAccountId = getConnectAccountId(tenant as any);
  return {
    tenant: tenant as Record<string, unknown>,
    mode,
    platformAccount,
    stripe: getStripeClientForAccount(platformAccount, mode),
    connectAccountId,
    stripeOptions: getStripeOptions(connectAccountId),
  };
}

/**
 * Client for operating on an EXISTING record (payments.platform_account /
 * rentals.platform_account). Records created before this migration have no
 * value and default to 'uk' — which is where all their Stripe objects live.
 */
export function getStripeClientForRecord(
  record: { platform_account?: string | null },
  mode: StripeMode
): Stripe {
  const account: PlatformAccount = record.platform_account === 'uae' ? 'uae' : 'uk';
  return getStripeClientForAccount(account, mode);
}

/**
 * Validate a stored Stripe customer id against the account/mode the caller is
 * about to charge on. Stripe Customer objects are scoped to ONE account and
 * ONE mode (test/live) — an id minted while a tenant was in test mode does not
 * exist on their live Connect account, so reusing it makes every charge fail
 * with "No such customer" (Kedic incident, 2026-07: test-era id survived the
 * go-live wipe and broke all portal payment collection for that customer).
 *
 * Returns the id when it is usable on the given account, or null when Stripe
 * reports it missing/deleted there — callers then fall through to their
 * existing mint-a-fresh-customer branch (which persists the new id).
 * Non-"missing" errors (network, auth) are rethrown: they signal real
 * problems that must surface, not a stale id.
 */
export async function validateStripeCustomerId(
  stripe: Stripe,
  storedId: string | null | undefined,
  options?: { stripeAccount?: string },
): Promise<string | null> {
  if (!storedId) return null;
  try {
    const customer = await stripe.customers.retrieve(storedId, options);
    if ((customer as { deleted?: boolean }).deleted === true) {
      console.warn('[stripe-client] Stored Stripe customer is deleted, re-mint needed:', storedId);
      return null;
    }
    return storedId;
  } catch (err) {
    const code = (err as { code?: string; raw?: { code?: string } })?.code
      ?? (err as { raw?: { code?: string } })?.raw?.code;
    if (code === 'resource_missing') {
      console.warn('[stripe-client] Stored Stripe customer not found on current account/mode, re-mint needed:', storedId);
      return null;
    }
    throw err;
  }
}
