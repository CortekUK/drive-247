import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UpdatePaymentMethodRequest {
  customerId: string
  installmentPlanId?: string  // Optional - if provided, update specific plan
  tenantId?: string
  returnUrl: string           // URL to redirect after setup
}

interface ConfirmPaymentMethodRequest {
  customerId: string
  installmentPlanId?: string
  paymentMethodId: string     // The new payment method ID from Stripe
  tenantId?: string
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

    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'create-setup'

    if (action === 'create-setup') {
      // Create a SetupIntent for adding a new payment method
      const body: UpdatePaymentMethodRequest = await req.json()

      console.log('Creating SetupIntent for customer:', body.customerId)

      // Get customer's Stripe customer ID
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('stripe_customer_id, tenant_id')
        .eq('id', body.customerId)
        .single()

      if (customerError || !customer) {
        throw new Error('Customer not found')
      }

      const tenantId = body.tenantId || customer.tenant_id
      let stripeMode: StripeMode = 'test'
      let tenantData: any = null

      // Get tenant's Stripe configuration
      if (tenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
          .eq('id', tenantId)
          .single()

        if (tenant) {
          stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
          tenantData = tenant
        }
      }

      const stripe = getStripeClient(stripeMode)
      const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
      const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

      // Create or verify Stripe customer
      let stripeCustomerId = customer.stripe_customer_id

      if (!stripeCustomerId) {
        // Get customer details for creating Stripe customer
        const { data: customerDetails } = await supabase
          .from('customers')
          .select('email, name, phone')
          .eq('id', body.customerId)
          .single()

        const stripeCustomer = await stripe.customers.create({
          email: customerDetails?.email,
          name: customerDetails?.name,
          phone: customerDetails?.phone,
          metadata: {
            drive247_customer_id: body.customerId,
            tenant_id: tenantId || '',
          },
        }, stripeOptions)

        stripeCustomerId = stripeCustomer.id

        // Save to database
        await supabase
          .from('customers')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('id', body.customerId)
      }

      // Create SetupIntent
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        usage: 'off_session', // For recurring charges
        metadata: {
          customer_id: body.customerId,
          installment_plan_id: body.installmentPlanId || '',
          tenant_id: tenantId || '',
          purpose: 'update_payment_method',
        },
      }, stripeOptions)

      console.log('SetupIntent created:', setupIntent.id)

      return new Response(
        JSON.stringify({
          clientSecret: setupIntent.client_secret,
          setupIntentId: setupIntent.id,
          stripeCustomerId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )

    } else if (action === 'confirm') {
      // Confirm and save the new payment method
      const body: ConfirmPaymentMethodRequest = await req.json()

      console.log('Confirming payment method update for customer:', body.customerId)
      console.log('New payment method:', body.paymentMethodId)

      // Get customer and tenant info
      const { data: customer } = await supabase
        .from('customers')
        .select('stripe_customer_id, tenant_id')
        .eq('id', body.customerId)
        .single()

      if (!customer?.stripe_customer_id) {
        throw new Error('Customer not found or no Stripe customer')
      }

      const tenantId = body.tenantId || customer.tenant_id
      let stripeMode: StripeMode = 'test'
      let tenantData: any = null

      if (tenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
          .eq('id', tenantId)
          .single()

        if (tenant) {
          stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
          tenantData = tenant
        }
      }

      const stripe = getStripeClient(stripeMode)
      const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
      const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

      // Verify the payment method belongs to this customer
      const paymentMethod = await stripe.paymentMethods.retrieve(
        body.paymentMethodId,
        stripeOptions
      )

      if (paymentMethod.customer !== customer.stripe_customer_id) {
        throw new Error('Payment method does not belong to this customer')
      }

      // Set as default payment method for the customer
      await stripe.customers.update(
        customer.stripe_customer_id,
        { invoice_settings: { default_payment_method: body.paymentMethodId } },
        stripeOptions
      )

      // Update specific installment plan if provided
      if (body.installmentPlanId) {
        await supabase
          .from('installment_plans')
          .update({
            stripe_payment_method_id: body.paymentMethodId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.installmentPlanId)
          .eq('customer_id', body.customerId) // Security check

        console.log('Updated installment plan:', body.installmentPlanId)
      } else {
        // Update all active installment plans for this customer
        const { data: activePlans } = await supabase
          .from('installment_plans')
          .select('id')
          .eq('customer_id', body.customerId)
          .in('status', ['active', 'overdue'])

        if (activePlans && activePlans.length > 0) {
          const planIds = activePlans.map(p => p.id)
          await supabase
            .from('installment_plans')
            .update({
              stripe_payment_method_id: body.paymentMethodId,
              updated_at: new Date().toISOString(),
            })
            .in('id', planIds)

          console.log('Updated', planIds.length, 'active installment plans')
        }
      }

      // Get card details for response
      const card = paymentMethod.card
      const cardInfo = card ? {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
      } : null

      return new Response(
        JSON.stringify({
          success: true,
          paymentMethodId: body.paymentMethodId,
          card: cardInfo,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )

    } else if (action === 'get-card') {
      // Get current card details
      const customerId = url.searchParams.get('customerId')
      const installmentPlanId = url.searchParams.get('installmentPlanId')

      if (!customerId) {
        throw new Error('Customer ID required')
      }

      // Get payment method ID from customer or plan
      let paymentMethodId: string | null = null
      let tenantId: string | null = null

      if (installmentPlanId) {
        const { data: plan } = await supabase
          .from('installment_plans')
          .select('stripe_payment_method_id, tenant_id')
          .eq('id', installmentPlanId)
          .eq('customer_id', customerId)
          .single()

        if (plan) {
          paymentMethodId = plan.stripe_payment_method_id
          tenantId = plan.tenant_id
        }
      }

      if (!paymentMethodId) {
        // Try to get from customer's default
        const { data: customer } = await supabase
          .from('customers')
          .select('stripe_customer_id, tenant_id')
          .eq('id', customerId)
          .single()

        if (customer?.stripe_customer_id) {
          tenantId = customer.tenant_id

          let stripeMode: StripeMode = 'test'
          let tenantData: any = null

          if (tenantId) {
            const { data: tenant } = await supabase
              .from('tenants')
              .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
              .eq('id', tenantId)
              .single()

            if (tenant) {
              stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
              tenantData = tenant
            }
          }

          const stripe = getStripeClient(stripeMode)
          const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
          const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

          // Get customer's default payment method
          const stripeCustomer = await stripe.customers.retrieve(
            customer.stripe_customer_id,
            stripeOptions
          ) as Stripe.Customer

          paymentMethodId = stripeCustomer.invoice_settings?.default_payment_method as string || null
        }
      }

      if (!paymentMethodId) {
        return new Response(
          JSON.stringify({ card: null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get card details from Stripe
      let stripeMode: StripeMode = 'test'
      let tenantData: any = null

      if (tenantId) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
          .eq('id', tenantId)
          .single()

        if (tenant) {
          stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
          tenantData = tenant
        }
      }

      const stripe = getStripeClient(stripeMode)
      const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
      const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

      const paymentMethod = await stripe.paymentMethods.retrieve(
        paymentMethodId,
        stripeOptions
      )

      const card = paymentMethod.card
      return new Response(
        JSON.stringify({
          card: card ? {
            brand: card.brand,
            last4: card.last4,
            expMonth: card.exp_month,
            expYear: card.exp_year,
          } : null,
          paymentMethodId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    throw new Error('Invalid action')

  } catch (error) {
    console.error('Error in update-payment-method:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
