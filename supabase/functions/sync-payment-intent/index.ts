import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { paymentId, checkoutSessionId, connectedAccountId, mode } = await req.json()

    // Select Stripe key based on mode
    const stripeKey = mode === 'live'
      ? Deno.env.get('STRIPE_LIVE_SECRET_KEY')
      : Deno.env.get('STRIPE_TEST_SECRET_KEY')

    if (!stripeKey) {
      throw new Error(`Stripe ${mode} secret key not configured`)
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // Retrieve checkout session from connected account
    const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined

    console.log('Retrieving checkout session:', checkoutSessionId, 'from account:', connectedAccountId || 'platform')

    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, stripeOptions)

    if (!session.payment_intent) {
      return new Response(
        JSON.stringify({ error: 'No payment_intent found on this checkout session', session_status: session.status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const paymentIntentId = session.payment_intent as string
    console.log('Found payment_intent:', paymentIntentId)

    // Update payment record in database
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data, error } = await supabase
      .from('payments')
      .update({
        stripe_payment_intent_id: paymentIntentId,
        capture_status: 'captured',
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .select('id, stripe_payment_intent_id')
      .single()

    if (error) {
      throw error
    }

    console.log('✅ Payment updated with payment_intent_id:', data)

    return new Response(
      JSON.stringify({
        success: true,
        payment_intent_id: paymentIntentId,
        payment: data
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
