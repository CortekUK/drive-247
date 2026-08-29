import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, resolveHoldExpiryDetailed, HOLD_EXPIRY_FALLBACK_DAYS, DEPOSIT_HOLD_CARD_VARIANTS, isCardFeatureIneligibleError, type StripeMode, type PlatformAccount } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

interface PreAuthCheckoutRequest {
  rentalId: string
  customerId: string
  customerEmail: string
  customerName: string
  customerPhone?: string
  vehicleId: string
  vehicleName: string
  totalAmount: number
  pickupDate: string
  returnDate: string
  protectionPlan?: string
  tenantId?: string
  // Bonzah insurance
  insuranceAmount?: number
  bonzahPolicyId?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: PreAuthCheckoutRequest = await req.json()
    const origin = req.headers.get('origin') || 'https://drive-247.com'

    console.log('Creating pre-auth checkout for rental:', body.rentalId)

    // Get tenant_id from rental if not provided
    let tenantId = body.tenantId
    let stripeMode: StripeMode = 'test' // Default to test mode for safety
    let tenantData: any = null

    if (!tenantId && body.rentalId) {
      const { data: rental } = await supabase
        .from('rentals')
        .select('tenant_id')
        .eq('id', body.rentalId)
        .single()
      tenantId = rental?.tenant_id
    }

    // Get tenant's Stripe mode and Connect account if available
    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('payment_provider, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code')
        .eq('id', tenantId)
        .single()

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
        console.log('Tenant loaded:', tenantId, 'mode:', stripeMode)
      }
    }

    // Square cannot vault a card from a hosted payment link — it has no
    // SetupIntent equivalent — so there is no stored credential to charge and no
    // authorisation to place. This is designed out for Square, not merely
    // unbuilt: these features are forced off at tenant creation and rendered
    // disabled in the portal.
    //
    // A SKIP, not a throw. The same reasoning place-deposit-hold gives applies:
    // several callers reach these paths, and turning a deliberately-absent
    // feature into a 500 pages someone for working-as-designed behaviour.
    if ((tenantData as { payment_provider?: string } | null)?.payment_provider === 'square') {
      console.log('[create-preauth-checkout] tenant is on Square — pre-authorisation is not supported.')
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'square_tenant',
          message: 'This tenant processes payments through Square, which cannot pre-authorise a card. Collect the payment as a charge instead.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get currency from tenant settings (Stripe expects lowercase)
    const currencyCode = (tenantData?.currency_code || 'USD').toLowerCase()

    // Get Stripe client for the tenant's platform account + mode
    // ('managed' tenants → legacy UK platform, 'own' tenants → UAE platform)
    const platformAccount: PlatformAccount = tenantData ? getChargePlatformAccount(tenantData) : 'uk'
    const stripe = getStripeClientForAccount(platformAccount, stripeMode)

    // Determine which Connect account to use based on tenant mode/model
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
    console.log('Pre-auth checkout - mode:', stripeMode, 'connectAccount:', stripeAccountId, 'currency:', currencyCode)

    // Build payment_intent_data for Checkout Session
    const paymentMetadata = {
      rental_id: body.rentalId,
      customer_id: body.customerId,
      customer_name: body.customerName,
      customer_email: body.customerEmail,
      vehicle_id: body.vehicleId,
      vehicle_name: body.vehicleName,
      pickup_date: body.pickupDate,
      return_date: body.returnDate,
      protection_plan: body.protectionPlan || 'none',
      booking_source: 'website',
      tenant_id: tenantId || '',
    }

    const paymentIntentData: any = {
      capture_method: 'manual', // KEY: This creates a hold, not a charge
      metadata: paymentMetadata,
      description: `Vehicle Rental: ${body.vehicleName} (${body.pickupDate} - ${body.returnDate})`,
    }

    // For direct charges: create checkout session on connected account
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
    if (stripeAccountId) {
      console.log('Creating checkout session on connected account:', stripeAccountId)
    }

    // Build line items array
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: currencyCode,
          product_data: {
            name: 'Vehicle Rental Deposit',
            description: `${body.vehicleName} - ${body.pickupDate} to ${body.returnDate}`,
            images: [], // Could add vehicle image here
          },
          unit_amount: Math.round(body.totalAmount * 100),
        },
        quantity: 1,
      },
    ]

    // Add insurance line item if present
    if (body.insuranceAmount && body.insuranceAmount > 0) {
      console.log('Adding Bonzah insurance line item:', body.insuranceAmount)
      lineItems.push({
        price_data: {
          currency: currencyCode,
          product_data: {
            name: 'Bonzah Insurance Premium',
            description: 'Rental car insurance coverage',
          },
          unit_amount: Math.round(body.insuranceAmount * 100),
        },
        quantity: 1,
      })
    }

    // Create Stripe Checkout Session (this creates the PaymentIntent internally).
    // Request extended authorization so the booking pre-auth survives longer than
    // the ~7-day card default while it waits for operator approval.
    const baseSessionParams: any = {
      payment_method_types: ['card'],
      mode: 'payment',
      payment_intent_data: paymentIntentData,
      line_items: lineItems,
      customer_email: body.customerEmail,
      client_reference_id: body.rentalId,
      success_url: `${origin}/booking-pending?session_id={CHECKOUT_SESSION_ID}&rental_id=${body.rentalId}`,
      cancel_url: `${origin}/booking-cancelled?rental_id=${body.rentalId}`,
      metadata: {
        rental_id: body.rentalId,
        customer_id: body.customerId,
        booking_source: 'website',
        preauth_mode: 'true',
        stripe_account_id: stripeAccountId || '',
        stripe_mode: stripeMode, // Track which mode was used
        ...(body.bonzahPolicyId ? { bonzah_policy_id: body.bonzahPolicyId } : {}),
      },
    }

    // Some Connect accounts aren't approved for extended_authorization and 500
    // with "not eligible for the requested card features" even on "if_available".
    // Downgrade through the shared variants so booking pre-auths never break for
    // those accounts (e.g. GMT). Falls back to the ~7-day default at worst.
    let session: any = null
    let lastErr: unknown = null
    for (let i = 0; i < DEPOSIT_HOLD_CARD_VARIANTS.length; i++) {
      const card = DEPOSIT_HOLD_CARD_VARIANTS[i]
      const params = card
        ? { ...baseSessionParams, payment_method_options: { card } }
        : baseSessionParams
      try {
        session = await stripe.checkout.sessions.create(params, stripeOptions)
        if (i > 0) console.warn(`create-preauth-checkout: card features downgraded to variant ${i} (account not eligible for full set)`)
        break
      } catch (err) {
        if (isCardFeatureIneligibleError(err) && i < DEPOSIT_HOLD_CARD_VARIANTS.length - 1) {
          lastErr = err
          continue
        }
        throw err
      }
    }
    if (!session) throw lastErr ?? new Error('Failed to create pre-auth checkout session')

    console.log('Pre-auth checkout session created:', session.id)

    // ---- preauth_expires_at: a CONSERVATIVE FLOOR, reconciled by the webhook --
    // Whatever is written here is provisional. At this instant the customer has
    // not completed Checkout, so no authorisation exists, so NOBODY — not even
    // Stripe — knows the real capture deadline yet. This value therefore cannot
    // be the truth; it can only be a floor that is safe to act on until the
    // truth arrives.
    //
    // This used to be a flat now+7d and nothing ever corrected it. Two things
    // were wrong. First, 7 days is not a card-network guarantee — Stripe
    // publishes the real deadline as capture_before on the authorising charge,
    // and without extended authorization a Visa card-absent,
    // merchant-initiated window is ~4d18h, so 7 days was an OVER-estimate, the
    // dangerous direction. Second, the clock does not start until the customer
    // actually completes Checkout, so an authorisation created two days later
    // inherited a deadline measured from the wrong moment. The portal's
    // pending-bookings expiry badge and the payment-links panel read this
    // column directly, so both errors reached operators as fact.
    //
    // Second half of the fix lives in stripe-webhook-live / stripe-webhook-test
    // (reconcilePreauthExpiry): once the PaymentIntent is authorised they read
    // the charge's capture_before and overwrite this column with Stripe's own
    // answer, measured from the real authorisation moment. They persist nothing
    // they did not read from Stripe, so a floor is never laundered into a fact.
    //
    // resolveHoldExpiryDetailed is the single place that knows how to read
    // Stripe's answer and, when Stripe has not published one yet, how to fall
    // back to the conservative floor rather than an optimistic guess. At this
    // point the PaymentIntent is unconfirmed and has no charge, so the floor
    // (HOLD_EXPIRY_FALLBACK_DAYS, deliberately SHORTER than the old 7 days) is
    // what we normally get: understating coverage is the safe direction, since
    // nobody plans a capture against a window that has already closed.
    // Deliberately AFTER the session exists and fully wrapped: the session is
    // already created and returned to the customer, so nothing in here may be
    // allowed to fail the checkout. No `expand` on sessions.create for the same
    // reason — a Stripe change there would break booking for every tenant.
    let preauthExpiresAtIso = new Date(
      Date.now() + HOLD_EXPIRY_FALLBACK_DAYS * 86400 * 1000
    ).toISOString()
    try {
      const createdPiId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id
      if (createdPiId) {
        const createdPi = await stripe.paymentIntents.retrieve(
          createdPiId,
          { expand: ['latest_charge'] },
          stripeOptions
        )
        const expiry = await resolveHoldExpiryDetailed(stripe, createdPi, stripeOptions)
        preauthExpiresAtIso = expiry.expiresAt
        console.log(
          `Pre-auth expiry floor for session ${session.id}: ${preauthExpiresAtIso} ` +
            `(source: ${expiry.source}) — the webhook reconciles this against the ` +
            `charge's capture_before once the card is authorised`
        )
      } else {
        console.warn(
          `Pre-auth session ${session.id} exposed no PaymentIntent id; ` +
            `using the ${HOLD_EXPIRY_FALLBACK_DAYS}-day floor for preauth_expires_at`
        )
      }
    } catch (expiryErr) {
      console.warn(
        `Pre-auth expiry resolution failed for session ${session.id}; ` +
          `using the ${HOLD_EXPIRY_FALLBACK_DAYS}-day floor:`,
        expiryErr
      )
    }

    // Create payment record in database with pre-auth status
    // Note: PaymentIntent ID will be updated by webhook after checkout completes
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        customer_id: body.customerId,
        rental_id: body.rentalId,
        vehicle_id: body.vehicleId,
        amount: body.totalAmount,
        payment_date: new Date().toISOString().split('T')[0],
        method: 'Stripe',
        payment_type: 'InitialFee',
        status: 'Pending',
        verification_status: 'auto_approved', // Stripe verified payment
        is_manual_mode: true,
        stripe_checkout_session_id: session.id,
        capture_status: 'requires_capture',
        preauth_expires_at: preauthExpiresAtIso,
        booking_source: 'website',
        tenant_id: tenantId,
        platform_account: platformAccount,
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Error creating payment record:', paymentError)
      // Don't fail the checkout - just log the error
    }

    // Update session metadata with payment_id for webhook
    // (Stripe doesn't let us update session metadata after creation, so we track via checkout_session_id)

    console.log('Payment record created:', payment?.id)

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        paymentId: payment?.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error creating pre-auth checkout:', error)

    let errorMessage = 'Unable to create payment session. Please try again.'
    let statusCode = 400

    if (error instanceof Stripe.errors.StripeError) {
      switch (error.type) {
        case 'StripeCardError':
          errorMessage = 'There was an issue with your card. Please check your card details.'
          break
        case 'StripeRateLimitError':
          errorMessage = 'Too many requests. Please wait a moment and try again.'
          statusCode = 429
          break
        case 'StripeInvalidRequestError':
          errorMessage = 'Invalid payment request. Please check your booking details.'
          break
        case 'StripeAPIError':
        case 'StripeConnectionError':
          errorMessage = 'Payment service temporarily unavailable. Please try again in a few moments.'
          statusCode = 503
          break
        case 'StripeAuthenticationError':
          errorMessage = 'Payment configuration error. Please contact support.'
          statusCode = 500
          break
        default:
          errorMessage = error.message || errorMessage
      }
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: error.code || 'payment_error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: statusCode,
      }
    )
  }
})
