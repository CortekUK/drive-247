// Given a Stripe Checkout Session ID created by create-hold-checkout, retrieve
// its PaymentIntent and persist the hold metadata on the rental. Idempotent —
// safe to call multiple times; bails if a hold is already recorded.
//
// Input:  { sessionId, rentalId? }
// Output: { success, status, amount } or { skipped: reason }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getStripeClient,
  getConnectAccountId,
  getStripeOptions,
  resolveHoldExpiry,
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
      .select('id, tenant_id, customer_id, deposit_hold_status, deposit_hold_payment_intent_id')
      .eq('id', rentalId)
      .single()
    if (rentalError || !rental) return errorResponse('Rental not found', 404)

    if (rental.deposit_hold_status === 'held' && rental.deposit_hold_payment_intent_id) {
      return jsonResponse({ skipped: 'hold_already_held' })
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
      .eq('id', rental.tenant_id)
      .single()

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || 'test'
    const stripe = getStripeClient(stripeMode)
    const stripeOptions = getStripeOptions(getConnectAccountId(tenant as any))

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
    const expiresAtIso = await resolveHoldExpiry(stripe, pi, stripeOptions)

    // Persist hold details on the rental. Also backfill customer.stripe_customer_id
    // if the customer didn't have one yet (Checkout creates/links one).
    const { error: updateError } = await supabase
      .from('rentals')
      .update({
        deposit_hold_payment_intent_id: pi.id,
        deposit_hold_status: 'held',
        deposit_hold_amount: amount,
        deposit_hold_placed_at: new Date().toISOString(),
        deposit_hold_expires_at: expiresAtIso,
        deposit_hold_payment_method_id: pmId,
        deposit_hold_stripe_customer_id: stripeCustomerId,
      })
      .eq('id', rental.id)
    if (updateError) return errorResponse(`Failed to persist hold: ${updateError.message}`, 500)

    if (stripeCustomerId) {
      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', rental.customer_id)
        .is('stripe_customer_id', null)
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
