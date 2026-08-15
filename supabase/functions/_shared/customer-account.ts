// Per-platform-account Stripe Customer resolution (Own Stripe / UAE migration)
//
// PROBLEM THIS SOLVES
// -------------------
// `customers.stripe_customer_id` is a SINGLE shared column, but a Stripe
// Customer object is scoped to exactly one platform account (uk vs uae) AND one
// mode. Before this module, every "new charge" path validated the stored id
// against the tenant's CURRENT account and, on a miss, re-minted a fresh
// customer and OVERWROTE the shared column. The first UAE charge for a tenant
// that still had live UK rentals therefore clobbered the UK customer id — the
// customer's saved card vanished from the portal and the operator's
// "charge saved card" started failing with no_card_on_file on the UK rental.
//
// FIX
// ---
// Two dedicated columns, `stripe_customer_id_uk` and `stripe_customer_id_uae`,
// hold the id per account. A UK id and a UAE id can now coexist and neither can
// clobber the other. The legacy `stripe_customer_id` column is frozen (kept for
// any not-yet-migrated reader) and is no longer written by these paths.
//
// SELF-HEALING: the resolver validates against live Stripe. When a per-account
// column is empty it tries the legacy shared id, and if that id actually lives
// on the requested account it ADOPTS it into the per-account column. So the fix
// is correct even where the one-time backfill was incomplete or wrong — no bulk
// migration has to be perfect for money to route correctly.

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { PlatformAccount, validateStripeCustomerId } from './stripe-client.ts'

/** Column holding the Stripe Customer id for each platform account. */
export const CUSTOMER_ID_COLUMN: Record<PlatformAccount, 'stripe_customer_id_uk' | 'stripe_customer_id_uae'> = {
  uk: 'stripe_customer_id_uk',
  uae: 'stripe_customer_id_uae',
}

/** Everything the resolver needs off a customers row. Select all three. */
export const CUSTOMER_ACCOUNT_COLUMNS =
  'stripe_customer_id, stripe_customer_id_uk, stripe_customer_id_uae'

export interface CustomerAccountFields {
  stripe_customer_id?: string | null
  stripe_customer_id_uk?: string | null
  stripe_customer_id_uae?: string | null
}

/**
 * Return a Stripe Customer id that is USABLE on `account` (validated live), or
 * null when none exists there yet (the caller then mints one and calls
 * {@link setCustomerIdForAccount}).
 *
 * Order:
 *  1. the per-account column — validate; use if live.
 *  2. the legacy shared id — validate against THIS account; if it lives here,
 *     adopt it into the per-account column and use it.
 *  3. otherwise null.
 *
 * NEVER touches the other account's column, so a UK id can never be lost when
 * resolving for UAE and vice-versa.
 */
export async function getCustomerIdForAccount(params: {
  supabase: SupabaseClient
  stripe: Stripe
  account: PlatformAccount
  /** Connected-account option, when charging on a connected account. */
  stripeAccount?: string | null
  /** The customers row PK, used to persist an adopted legacy id. */
  customerRowId: string
  customer: CustomerAccountFields
}): Promise<string | null> {
  const { supabase, stripe, account, stripeAccount, customerRowId, customer } = params
  const opts = stripeAccount ? { stripeAccount } : undefined
  const col = CUSTOMER_ID_COLUMN[account]

  const perAccount = customer[col]
  if (perAccount) {
    const ok = await validateStripeCustomerId(stripe, perAccount, opts)
    if (ok) return ok
    // Stored per-account id is gone on Stripe — fall through to mint (caller).
  }

  const legacy = customer.stripe_customer_id
  if (legacy && legacy !== perAccount) {
    const ok = await validateStripeCustomerId(stripe, legacy, opts)
    if (ok) {
      // The legacy shared id belongs to THIS account — adopt it so future
      // lookups skip the extra round-trip. Best-effort; correctness does not
      // depend on the write succeeding.
      await supabase.from('customers').update({ [col]: ok }).eq('id', customerRowId)
      return ok
    }
  }

  return null
}

/**
 * Persist a freshly-minted (or otherwise known-good) Stripe Customer id for
 * `account`. Writes ONLY the per-account column; the legacy shared column is
 * intentionally left untouched.
 */
export async function setCustomerIdForAccount(
  supabase: SupabaseClient,
  customerRowId: string,
  account: PlatformAccount,
  stripeCustomerId: string,
): Promise<void> {
  const col = CUSTOMER_ID_COLUMN[account]
  const { error } = await supabase
    .from('customers')
    .update({ [col]: stripeCustomerId })
    .eq('id', customerRowId)
  if (error) {
    console.error(`[customer-account] failed to persist ${col}=${stripeCustomerId} for customer ${customerRowId}:`, error)
  }
}
