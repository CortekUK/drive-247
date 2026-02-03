import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

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
        .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
        .eq('id', tenantId)
        .single()

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
        console.log('Tenant loaded:', tenantId, 'mode:', stripeMode)
      }
    }

    // Get Stripe client for the tenant's mode
    const stripe = getStripeClient(stripeMode)

    // Determine which Connect account to use based on tenant mode
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
    console.log('Pre-auth checkout - mode:', stripeMode, 'connectAccount:', stripeAccountId)

    // Calculate pre-auth expiry (7 days from now)
    const preauthExpiresAt = new Date()
    preauthExpiresAt.setDate(preauthExpiresAt.getDate() + 7)

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
          currency: 'usd',
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
          currency: 'usd',
          product_data: {
            name: 'Bonzah Insurance Premium',
            description: 'Rental car insurance coverage',
          },
          unit_amount: Math.round(body.insuranceAmount * 100),
        },
        quantity: 1,
      })
    }

    // Create Stripe Checkout Session (this creates the PaymentIntent internally)
    const session = await stripe.checkout.sessions.create({
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
        bonzah_policy_id: body.bonzahPolicyId || '', // Track Bonzah policy for webhook
      },
    }, stripeOptions)

    console.log('Pre-auth checkout session created:', session.id)

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
        preauth_expires_at: preauthExpiresAt.toISOString(),
        booking_source: 'website',
        tenant_id: tenantId,
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
