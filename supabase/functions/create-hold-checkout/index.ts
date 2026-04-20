// Creates a Stripe Checkout Session that authorises the tenant's security
// deposit amount WITHOUT capturing it (manual capture mode). Used by admins to
// (a) place a hold via a new Checkout tab or (b) email the payment link to the
// customer — both cases end up with the same auth-only PaymentIntent on the
// same saved card.
//
// Input:  { rentalId, successUrl?, cancelUrl? }
// Output: { url, sessionId, amount } or { skipped: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getStripeClient,
  getConnectAccountId,
  getStripeOptions,
  type StripeMode,
} from '../_shared/stripe-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { rentalId, successUrl, cancelUrl } = await req.json()
    if (!rentalId) return errorResponse('rentalId is required', 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select('id, tenant_id, customer_id, deposit_hold_status')
      .eq('id', rentalId)
      .single()
    if (rentalError || !rental) return errorResponse('Rental not found', 404)

    if (rental.deposit_hold_status === 'held') {
      return jsonResponse({ skipped: 'hold_already_active' })
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, security_deposit_enabled, global_deposit_amount, currency_code, company_name')
      .eq('id', rental.tenant_id)
      .single()
    if (tenantError || !tenant) return errorResponse('Tenant not found', 404)

    if (!tenant.security_deposit_enabled) {
      return jsonResponse({ skipped: 'deposit_disabled_for_tenant' })
    }
    const depositAmount = Number(tenant.global_deposit_amount) || 0
    if (depositAmount <= 0) {
      return jsonResponse({ skipped: 'deposit_amount_is_zero' })
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('email, name, stripe_customer_id')
      .eq('id', rental.customer_id)
      .single()

    const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || 'test'
    const stripe = getStripeClient(stripeMode)
    const stripeOptions = getStripeOptions(getConnectAccountId(tenant as any))

    const currency = (tenant.currency_code || 'usd').toLowerCase()
    const origin = req.headers.get('origin') || ''

    const sessionParams: any = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Security Deposit Hold — ${tenant.company_name || 'Rental'}`,
              description: `Authorisation only. This amount is held on your card and will be released when the rental ends.`,
            },
            unit_amount: Math.round(depositAmount * 100),
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        // KEY: authorise only, do NOT capture. Admin captures or releases later.
        capture_method: 'manual',
        // Save the card so subsequent holds / rollovers can reuse the PM.
        setup_future_usage: 'off_session',
        metadata: {
          type: 'security_deposit_hold',
          rental_id: rentalId,
          tenant_id: rental.tenant_id,
          customer_id: rental.customer_id,
        },
      },
      metadata: {
        type: 'security_deposit_hold',
        rental_id: rentalId,
        tenant_id: rental.tenant_id,
      },
      success_url: successUrl || `${origin}/rentals/${rentalId}?hold=placed&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${origin}/rentals/${rentalId}?hold=cancelled`,
    }

    if (customer?.stripe_customer_id) {
      sessionParams.customer = customer.stripe_customer_id
    } else if (customer?.email) {
      sessionParams.customer_email = customer.email
    }

    const session = await stripe.checkout.sessions.create(sessionParams, stripeOptions)

    return jsonResponse({
      url: session.url,
      sessionId: session.id,
      amount: depositAmount,
    })
  } catch (err) {
    console.error('create-hold-checkout error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(message, 500)
  }
})
