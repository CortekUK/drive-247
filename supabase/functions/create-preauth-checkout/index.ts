import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

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

    // Create Stripe PaymentIntent with manual capture (pre-authorization)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(body.totalAmount * 100), // Convert to cents
      currency: 'usd',
      capture_method: 'manual', // KEY: This creates a hold, not a charge
      payment_method_types: ['card'],
      metadata: {
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
      },
      description: `Vehicle Rental: ${body.vehicleName} (${body.pickupDate} - ${body.returnDate})`,
      receipt_email: body.customerEmail,
    })

    // Calculate pre-auth expiry (7 days from now)
    const preauthExpiresAt = new Date()
    preauthExpiresAt.setDate(preauthExpiresAt.getDate() + 7)

    // Create payment record in database with pre-auth status
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
        verification_status: 'pending',
        is_manual_mode: true,
        stripe_payment_intent_id: paymentIntent.id,
        capture_status: 'requires_capture',
        preauth_expires_at: preauthExpiresAt.toISOString(),
        booking_source: 'website',
      })
      .select()
      .single()

    if (paymentError) {
      console.error('Error creating payment record:', paymentError)
      // Don't fail the checkout - just log the error
    }

    // Create Stripe Checkout Session for collecting payment method
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      payment_intent_data: {
        capture_method: 'manual',
        metadata: paymentIntent.metadata,
      },
      line_items: [
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
      ],
      customer_email: body.customerEmail,
      client_reference_id: body.rentalId,
      success_url: `${origin}/booking-pending?session_id={CHECKOUT_SESSION_ID}&rental_id=${body.rentalId}`,
      cancel_url: `${origin}/booking-cancelled?rental_id=${body.rentalId}`,
      metadata: {
        rental_id: body.rentalId,
        customer_id: body.customerId,
        payment_id: payment?.id || '',
        booking_source: 'website',
        preauth_mode: 'true',
      },
    })

    // Update payment record with checkout session ID
    if (payment?.id) {
      await supabase
        .from('payments')
        .update({
          stripe_checkout_session_id: session.id,
        })
        .eq('id', payment.id)
    }

    console.log('Pre-auth checkout session created:', session.id)

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
        paymentIntentId: paymentIntent.id,
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
