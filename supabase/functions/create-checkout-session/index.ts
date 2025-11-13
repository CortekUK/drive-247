import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const { bookingId, rentalId, customerEmail, customerName, totalAmount } = await req.json()

    const origin = req.headers.get('origin') || 'http://localhost:5173'

    // Support both bookingId (legacy) and rentalId (portal integration)
    const referenceId = rentalId || bookingId

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            product_data: {
              name: 'Luxury Vehicle Rental',
              description: 'Premium chauffeur-driven vehicle rental - Drive 917',
            },
            unit_amount: Math.round(totalAmount * 100), // Convert to pence
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: customerEmail,
      client_reference_id: referenceId,
      success_url: rentalId
        ? `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rentalId}`
        : `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: rentalId
        ? `${origin}/booking-cancelled?rental_id=${rentalId}`
        : `${origin}/booking-cancelled`,
      metadata: {
        booking_id: bookingId,
        rental_id: rentalId,
        customer_name: customerName,
      },
    })

    return new Response(
      JSON.stringify({ sessionId: session.id, url: session.url }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error creating checkout session:', error)

    // Provide user-friendly error messages
    let errorMessage = 'Unable to create payment session. Please try again.'
    let statusCode = 400

    if (error instanceof Stripe.errors.StripeError) {
      // Handle specific Stripe errors
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
    } else if (error.message) {
      // For other errors, check if it's a validation error
      if (error.message.includes('required') || error.message.includes('missing')) {
        errorMessage = 'Missing required booking information. Please complete all fields.'
      } else if (error.message.includes('invalid')) {
        errorMessage = 'Invalid booking information provided. Please check your details.'
      }
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: error.code || 'payment_error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: statusCode,
      }
    )
  }
})
