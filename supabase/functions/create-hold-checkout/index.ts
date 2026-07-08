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
  getConnectAccountId,
  getChargePlatformAccount,
  getStripeClientForAccount,
  getStripeOptions,
  validateStripeCustomerId,
  DEPOSIT_HOLD_CARD_VARIANTS,
  isCardFeatureIneligibleError,
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
      .select('id, tenant_id, customer_id, deposit_hold_status, deposit_amount_override, auto_extend_enabled')
      .eq('id', rentalId)
      .single()
    if (rentalError || !rental) return errorResponse('Rental not found', 404)

    // AUTO-EXTEND rentals never carry a deposit (renewal pricing replaces it).
    // Manually-extended rentals are allowed: this function is only reached from
    // the portal's Add Hold dialog — a deliberate staff action — so the RevTek/
    // Fabri auto-retry concern does not apply here (GMT incident, Jul 2026).
    if ((rental as any).auto_extend_enabled) {
      return jsonResponse({ skipped: 'auto_extend_rental' })
    }

    if (rental.deposit_hold_status === 'held') {
      return jsonResponse({ skipped: 'hold_already_active' })
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, security_deposit_enabled, global_deposit_amount, currency_code, company_name')
      .eq('id', rental.tenant_id)
      .single()
    if (tenantError || !tenant) return errorResponse('Tenant not found', 404)

    if (!tenant.security_deposit_enabled) {
      return jsonResponse({ skipped: 'deposit_disabled_for_tenant' })
    }
    // Per-rental override beats the tenant default — including an explicit 0,
    // which means the operator unchecked the deposit for this rental and wants
    // NO hold. This function previously ignored deposit_amount_override entirely
    // and always used global_deposit_amount, so it placed a $150 hold even when
    // the operator opted out (and got every custom override wrong too).
    const overrideAmount = rental.deposit_amount_override !== null && rental.deposit_amount_override !== undefined
      ? Number(rental.deposit_amount_override)
      : null
    const depositAmount = overrideAmount !== null
      ? overrideAmount
      : (Number(tenant.global_deposit_amount) || 0)
    if (depositAmount <= 0) {
      return jsonResponse({ skipped: 'deposit_amount_is_zero' })
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('email, name, stripe_customer_id')
      .eq('id', rental.customer_id)
      .single()

    const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || 'test'
    const stripe = getStripeClientForAccount(getChargePlatformAccount(tenant as any), stripeMode)
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

    // Validate the stored id before reuse (scoped per Stripe account+mode; a
    // stale test-era id would fail sessions.create with "No such customer").
    // On stale, fall back to customer_email — the hold flow has no mint step;
    // sync-deposit-hold backfills the fresh id after checkout completes.
    const validHoldCustomerId = await validateStripeCustomerId(stripe, customer?.stripe_customer_id, stripeOptions)
    if (validHoldCustomerId) {
      sessionParams.customer = validHoldCustomerId
    } else if (customer?.email) {
      sessionParams.customer_email = customer.email
    }

    // Ask the card network to extend the hold lifetime (up to ~30 days) and
    // allow multicapture. Without extended authorization the hold dies at the
    // ~7-day default — exactly what silently killed GMT's holds before.
    //
    // "if_available" is *supposed* to be ignored where unsupported, but Connect
    // accounts not approved for these features actually 500 with "This account
    // is not eligible for the requested card features." (GMT's live account,
    // acct_1SrIFEPcUIaEGCY0, does this). place-deposit-hold already handles this;
    // create-hold-checkout (used by the portal "Add Hold" button) did not, so the
    // manual hold button broke for those accounts.
    //
    // Graduated fallback: try both features → keep extended_authorization only
    // (preserves the 30-day hold GMT relies on for long rentals) → drop both.
    let session: any = null
    let lastErr: unknown = null
    for (let i = 0; i < DEPOSIT_HOLD_CARD_VARIANTS.length; i++) {
      const card = DEPOSIT_HOLD_CARD_VARIANTS[i]
      const params = card
        ? { ...sessionParams, payment_method_options: { card } }
        : sessionParams
      try {
        session = await stripe.checkout.sessions.create(params, stripeOptions)
        if (i > 0) {
          console.warn(
            `create-hold-checkout: card features downgraded to variant ${i} for tenant ${rental.tenant_id} (account not eligible for full set)`
          )
        }
        break
      } catch (err) {
        if (isCardFeatureIneligibleError(err) && i < DEPOSIT_HOLD_CARD_VARIANTS.length - 1) {
          lastErr = err
          continue
        }
        throw err
      }
    }
    if (!session) throw lastErr ?? new Error('Failed to create hold checkout session')

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
