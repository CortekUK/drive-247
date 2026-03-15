import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { installmentPlanId, customerId } = await req.json()
    const origin = req.headers.get('origin') || 'https://drive-247.com'

    if (!installmentPlanId || !customerId) {
      throw new Error('Missing required fields: installmentPlanId, customerId')
    }

    console.log('Creating upfront checkout for plan:', installmentPlanId, 'customer:', customerId)

    // Get the pending installment plan
    const { data: plan, error: planError } = await supabase
      .from('installment_plans')
      .select('id, rental_id, tenant_id, customer_id, upfront_amount, upfront_paid, status, plan_type, number_of_installments, total_installable_amount')
      .eq('id', installmentPlanId)
      .eq('customer_id', customerId)
      .eq('status', 'pending')
      .single()

    if (planError || !plan) {
      throw new Error('Installment plan not found or not in pending status')
    }

    if (plan.upfront_paid) {
      throw new Error('Upfront amount has already been paid')
    }

    if (plan.upfront_amount <= 0) {
      throw new Error('Invalid upfront amount')
    }

    // Get customer info
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, email, name, phone, stripe_customer_id')
      .eq('id', customerId)
      .single()

    if (customerError || !customer) {
      throw new Error('Customer not found')
    }

    // Get tenant Stripe config
    let stripeMode: StripeMode = 'test'
    let tenantData: any = null
    const tenantId = plan.tenant_id

    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code')
        .eq('id', tenantId)
        .single()

      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
      }
    }

    const currencyCode = (tenantData?.currency_code || 'GBP').toLowerCase()
    const stripe = getStripeClient(stripeMode)
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

    console.log('Stripe mode:', stripeMode, 'Connect account:', stripeAccountId, 'Currency:', currencyCode)

    // Create or reuse Stripe Customer
    let stripeCustomerId: string

    if (customer.stripe_customer_id) {
      stripeCustomerId = customer.stripe_customer_id
      console.log('Using existing Stripe customer:', stripeCustomerId)
    } else {
      const stripeCustomer = await stripe.customers.create({
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        metadata: {
          drive247_customer_id: customerId,
          tenant_id: tenantId || '',
        },
      }, stripeOptions)

      stripeCustomerId = stripeCustomer.id
      console.log('Created new Stripe customer:', stripeCustomerId)

      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', customerId)
    }

    // Build metadata
    const metadata = {
      checkout_type: 'installment_upfront',
      rental_id: plan.rental_id,
      customer_id: customerId,
      tenant_id: tenantId || '',
      installment_plan_id: installmentPlanId,
      upfront_amount: String(plan.upfront_amount),
    }

    // Create Checkout Session
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: currencyCode,
            product_data: {
              name: 'Deposit & Fees',
              description: `Upfront payment - Deposit & Fees for installment plan`,
            },
            unit_amount: Math.round(plan.upfront_amount * 100),
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata,
        description: `Installment Plan Upfront - Deposit & Fees`,
      },
      client_reference_id: plan.rental_id,
      success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${plan.rental_id}&installment=true`,
      cancel_url: `${origin}/portal/payments`,
      metadata: {
        ...metadata,
        stripe_account_id: stripeAccountId || '',
        stripe_mode: stripeMode,
      },
    }

    const session = await stripe.checkout.sessions.create(sessionParams, stripeOptions)
    console.log('Upfront checkout session created:', session.id)

    // Create payment record for tracking
    await supabase
      .from('payments')
      .insert({
        customer_id: customerId,
        rental_id: plan.rental_id,
        amount: plan.upfront_amount,
        payment_date: new Date().toISOString().split('T')[0],
        method: 'Card',
        payment_type: 'InitialFee',
        status: 'Pending',
        verification_status: 'auto_approved',
        stripe_checkout_session_id: session.id,
        capture_status: 'captured',
        booking_source: 'website',
        tenant_id: tenantId,
      })

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error creating upfront checkout:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
