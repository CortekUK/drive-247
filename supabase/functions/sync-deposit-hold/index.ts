// Given a Stripe Checkout Session ID created by create-hold-checkout, retrieve
// its PaymentIntent and persist the hold metadata on the rental. Idempotent —
// safe to call multiple times; bails if a hold is already recorded.
//
// Input:  { sessionId, rentalId? }
// Output: { success, status, amount } or { skipped: reason }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getConnectAccountId,
  getChargePlatformAccount,
  getStripeClientForAccount,
  getStripeOptions,
  resolveHoldExpiryDetailed,
  type StripeMode,
} from '../_shared/stripe-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { sessionId, rentalId: rentalIdInput } = await req.json()
    if (!sessionId) return errorResponse('sessionId is required', 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // We don't know the tenant yet — first try to resolve rental via input
    // rentalId, otherwise fall back to the Stripe session metadata. That
    // requires us to try each tenant's Stripe mode; to keep it simple, derive
    // the tenant from the rental row.
    let rentalId = rentalIdInput as string | undefined
    if (!rentalId) {
      // Fall back: search payments table for a matching session id (unlikely
      // for hold-only sessions; we write payments only for captured money).
      return errorResponse('rentalId is required for hold sync', 400)
    }

    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select('id, tenant_id, customer_id, deposit_hold_status, deposit_hold_payment_intent_id, platform_account')
      .eq('id', rentalId)
      .single()
    if (rentalError || !rental) return errorResponse('Rental not found', 404)

    if (rental.deposit_hold_status === 'held' && rental.deposit_hold_payment_intent_id) {
      return jsonResponse({ skipped: 'hold_already_held' })
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code')
      .eq('id', rental.tenant_id)
      .single()

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || 'test'
    // The hold-checkout session was created by create-hold-checkout on the
    // tenant's CURRENT charge platform, so resolve the same way here.
    const platformAccount = getChargePlatformAccount(tenant ?? {})
    const stripe = getStripeClientForAccount(platformAccount, stripeMode)
    const connectAccountId = getConnectAccountId(tenant as any)
    const stripeOptions = getStripeOptions(connectAccountId)

    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ['payment_intent', 'payment_intent.latest_charge'] },
      stripeOptions
    )

    const pi = session.payment_intent as any
    if (!pi || typeof pi === 'string') {
      return errorResponse('Session has no expanded PaymentIntent', 422)
    }
    if (pi.status !== 'requires_capture') {
      return errorResponse(`Hold not active (PI status: ${pi.status})`, 422)
    }

    const amount = (pi.amount || 0) / 100
    const pmId =
      typeof pi.payment_method === 'string'
        ? pi.payment_method
        : pi.payment_method?.id || null
    const stripeCustomerId =
      typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null

    // Read the REAL expiry from Stripe (capture_before) rather than assuming 31 days.
    const expiry = await resolveHoldExpiryDetailed(stripe, pi, stripeOptions)

    // ANCHORING. This hold lives on `platformAccount` / `connectAccountId` /
    // `stripeMode` / `pi.currency`, and every later capture, release and refresh
    // must use exactly those — never the tenant's row as it reads that day.
    const holdCurrency = String(pi.currency || tenant?.currency_code || 'usd').toLowerCase()
    const nowIso = new Date().toISOString()

    const update: Record<string, unknown> = {
      deposit_hold_payment_intent_id: pi.id,
      deposit_hold_status: 'held',
      deposit_hold_status_changed_at: nowIso,
      deposit_hold_amount: amount,
      deposit_hold_placed_at: nowIso,
      deposit_hold_expires_at: expiry.expiresAt,
      deposit_hold_expiry_source: expiry.source,
      deposit_hold_extended_auth: expiry.extendedAuth,
      deposit_hold_window_seconds: expiry.windowSeconds,
      deposit_hold_payment_method_id: pmId,
      deposit_hold_stripe_customer_id: stripeCustomerId,
      // Hold-scoped anchor columns. These, not rentals.platform_account, are
      // what refresh/reconcile prefer — so recording them here means a hold
      // synced from Checkout is resolvable even when the rental-level anchor is
      // ambiguous (see below).
      deposit_hold_connect_account_id: connectAccountId,
      deposit_hold_stripe_mode: stripeMode,
      deposit_hold_currency: holdCurrency,
    }

    // rentals.platform_account is the rental's MONEY ANCHOR: capture, release,
    // refresh and refund all resolve their Stripe keys from it. This function
    // used to overwrite it unconditionally from the tenant's CURRENT payment
    // model, on a path reached by a browser redirect after Checkout success.
    // So a rental whose payments were taken on 'uk' could be re-stamped 'uae'
    // by a customer landing on a success URL mid-migration, after which every
    // later operation on those payments targeted the wrong Stripe account.
    //
    // The column is NOT NULL DEFAULT 'uk', so "don't overwrite non-null" cannot
    // be taken literally — a fresh rental for a UAE tenant also reads 'uk'.
    // What makes the value load-bearing is money already anchored to it. So:
    // stamp it only when no payment row is anchored to the current value.
    if (rental.platform_account !== platformAccount) {
      const { count: anchoredPayments, error: anchorCountError } = await supabase
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('rental_id', rental.id)
        .eq('platform_account', rental.platform_account)

      if (anchorCountError) {
        // Could not prove the anchor is safe to move — so don't move it.
        console.error(
          `sync-deposit-hold: could not check anchored payments for rental ${rental.id}; ` +
            `leaving platform_account='${rental.platform_account}' alone:`,
          anchorCountError
        )
      } else if ((anchoredPayments ?? 0) > 0) {
        console.error(
          `sync-deposit-hold: PLATFORM DIVERGENCE on rental ${rental.id} — ` +
            `${anchoredPayments} payment(s) anchored to '${rental.platform_account}' but this ` +
            `hold was placed on '${platformAccount}'. Keeping the existing anchor; the hold is ` +
            `resolvable via deposit_hold_connect_account_id/deposit_hold_stripe_mode.`
        )
      } else {
        // Nothing is anchored to the old value — it is the column default, not
        // a record of where money lives. Safe to record where this hold sits.
        update.platform_account = platformAccount
      }
    }

    // Persist hold details on the rental. Also backfill customer.stripe_customer_id
    // if the customer didn't have one yet (Checkout creates/links one).
    const { error: updateError } = await supabase
      .from('rentals')
      .update(update)
      .eq('id', rental.id)
    if (updateError) return errorResponse(`Failed to persist hold: ${updateError.message}`, 500)

    if (stripeCustomerId) {
      // Overwrite unconditionally (not just when NULL): a stored id that
      // differs from the one Stripe just used is stale — e.g. minted in a
      // different mode/account era — and keeping it would strand the row on a
      // dead id (Kedic incident) while orphaning a fresh Checkout-created
      // customer on every subsequent hold. NOTE: no .neq() filter here — in
      // Postgres NULL != x is NULL, so .neq would skip the backfill-when-NULL
      // case; an unconditional idempotent write covers both.
      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', rental.customer_id)
    }

    return jsonResponse({
      success: true,
      status: 'held',
      amount,
      paymentIntentId: pi.id,
    })
  } catch (err) {
    console.error('sync-deposit-hold error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(message, 500)
  }
})
