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
    const { rentalId, checkoutSessionId } = await req.json()

    if (!rentalId) {
      return new Response(
        JSON.stringify({ error: 'rentalId is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('[ACTIVATE] Activating installment plan for rental:', rentalId)

    // Find the pending installment plan
    const { data: installmentPlans, error: planError } = await supabase
      .from('installment_plans')
      .select('id, upfront_amount, customer_id')
      .eq('rental_id', rentalId)
      .eq('status', 'pending')

    if (planError) {
      console.error('[ACTIVATE] Error fetching installment plan:', planError)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch installment plan', details: planError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    if (!installmentPlans || installmentPlans.length === 0) {
      // Check if already activated
      const { data: activePlan } = await supabase
        .from('installment_plans')
        .select('id, status')
        .eq('rental_id', rentalId)
        .eq('status', 'active')

      if (activePlan && activePlan.length > 0) {
        console.log('[ACTIVATE] Plan already active:', activePlan[0].id)

        // Still try to apply payment to ledger (webhook may have skipped this)
        if (checkoutSessionId) {
          const { data: paymentRecord } = await supabase
            .from('payments')
            .select('id')
            .eq('stripe_checkout_session_id', checkoutSessionId)
            .maybeSingle()

          if (paymentRecord) {
            try {
              const applyResponse = await fetch(
                `${Deno.env.get('SUPABASE_URL')}/functions/v1/apply-payment`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                  },
                  body: JSON.stringify({ paymentId: paymentRecord.id }),
                }
              )
              if (applyResponse.ok) {
                console.log('[ACTIVATE] Payment allocation completed for already-active plan')
              } else {
                console.error('[ACTIVATE] Payment allocation failed:', await applyResponse.text())
              }
            } catch (applyError) {
              console.error('[ACTIVATE] Error applying payment to ledger:', applyError)
            }
          }
        }

        return new Response(
          JSON.stringify({ success: true, already_active: true, plan_id: activePlan[0].id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.error('[ACTIVATE] No pending installment plan found for rental:', rentalId)
      return new Response(
        JSON.stringify({ error: 'No pending installment plan found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    const installmentPlan = installmentPlans[0]
    console.log('[ACTIVATE] Found pending plan:', installmentPlan.id)

    // Fetch customer's stripe_customer_id for the plan
    let customerStripeId: string | null = null
    if (installmentPlan.customer_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('stripe_customer_id')
        .eq('id', installmentPlan.customer_id)
        .single()
      customerStripeId = cust?.stripe_customer_id || null
      console.log('[ACTIVATE] Customer Stripe ID:', customerStripeId)
    }

    // Find the upfront payment record
    let paymentRecordId: string | null = null
    let paymentIntentId: string | null = null

    if (checkoutSessionId) {
      const { data: paymentRecord } = await supabase
        .from('payments')
        .select('id, stripe_payment_intent_id')
        .eq('stripe_checkout_session_id', checkoutSessionId)
        .maybeSingle()

      if (paymentRecord) {
        paymentRecordId = paymentRecord.id
        paymentIntentId = paymentRecord.stripe_payment_intent_id
        console.log('[ACTIVATE] Found payment record:', paymentRecordId)

        // Update payment status to Applied if still Pending
        await supabase
          .from('payments')
          .update({
            status: 'Applied',
            capture_status: 'captured',
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentRecordId)
          .eq('status', 'Pending')
      } else {
        // Payment record missing — create it as fallback
        console.log('[ACTIVATE] No payment record found for session — creating one')
        try {
          const { data: rental } = await supabase
            .from('rentals')
            .select('customer_id, vehicle_id, tenant_id')
            .eq('id', rentalId)
            .single()

          if (rental) {
            const { data: newPayment } = await supabase
              .from('payments')
              .insert({
                customer_id: rental.customer_id,
                rental_id: rentalId,
                vehicle_id: rental.vehicle_id,
                amount: installmentPlan.upfront_amount,
                payment_date: new Date().toISOString().split('T')[0],
                method: 'Card',
                payment_type: 'InitialFee',
                status: 'Applied',
                verification_status: 'auto_approved',
                stripe_checkout_session_id: checkoutSessionId,
                capture_status: 'captured',
                booking_source: 'website',
                tenant_id: rental.tenant_id,
              })
              .select()
              .single()

            if (newPayment) {
              paymentRecordId = newPayment.id
              console.log('[ACTIVATE] Created fallback payment record:', newPayment.id)
            }
          }
        } catch (createErr) {
          console.error('[ACTIVATE] Error creating fallback payment:', createErr)
        }
      }
    }

    // Fallback: if payment record has no payment_intent_id yet (webhook hasn't fired),
    // retrieve the checkout session from Stripe directly
    if (!paymentIntentId && checkoutSessionId) {
      try {
        const { data: rental } = await supabase
          .from('rentals')
          .select('tenant_id')
          .eq('id', rentalId)
          .single()

        if (rental?.tenant_id) {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
            .eq('id', rental.tenant_id)
            .single()

          if (tenant) {
            const stripeMode = tenant.stripe_mode || 'test'
            const stripeKey = stripeMode === 'live'
              ? Deno.env.get('STRIPE_LIVE_SECRET_KEY')
              : Deno.env.get('STRIPE_TEST_SECRET_KEY')

            if (stripeKey) {
              const stripe = new Stripe(stripeKey, {
                apiVersion: '2023-10-16',
                httpClient: Stripe.createFetchHttpClient(),
              })

              let connectedAccountId: string | null = null
              if (stripeMode === 'test') {
                connectedAccountId = Deno.env.get('STRIPE_TEST_CONNECT_ACCOUNT_ID') || null
              } else if (stripeMode === 'live' && tenant.stripe_onboarding_complete) {
                connectedAccountId = tenant.stripe_account_id
              }

              const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
              const stripeSession = await stripe.checkout.sessions.retrieve(checkoutSessionId, stripeOptions)
              paymentIntentId = stripeSession.payment_intent as string
              console.log('[ACTIVATE] Retrieved payment_intent from Stripe session:', paymentIntentId)

              // Also update the payment record for future reference
              if (paymentIntentId && paymentRecordId) {
                await supabase
                  .from('payments')
                  .update({ stripe_payment_intent_id: paymentIntentId })
                  .eq('id', paymentRecordId)
              }
            }
          }
        }
      } catch (err) {
        console.error('[ACTIVATE] Error retrieving checkout session from Stripe (non-fatal):', err)
      }
    }

    // Try to get payment method from Stripe if we have a payment_intent_id
    let paymentMethodId: string | null = null
    if (paymentIntentId) {
      try {
        // Get tenant to determine stripe mode
        const { data: rental } = await supabase
          .from('rentals')
          .select('tenant_id')
          .eq('id', rentalId)
          .single()

        if (rental?.tenant_id) {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
            .eq('id', rental.tenant_id)
            .single()

          if (tenant) {
            const stripeMode = tenant.stripe_mode || 'test'
            const stripeKey = stripeMode === 'live'
              ? Deno.env.get('STRIPE_LIVE_SECRET_KEY')
              : Deno.env.get('STRIPE_TEST_SECRET_KEY')

            if (stripeKey) {
              const stripe = new Stripe(stripeKey, {
                apiVersion: '2023-10-16',
                httpClient: Stripe.createFetchHttpClient(),
              })

              // Get connected account
              let connectedAccountId: string | null = null
              if (stripeMode === 'test') {
                connectedAccountId = Deno.env.get('STRIPE_TEST_CONNECT_ACCOUNT_ID') || null
              } else if (stripeMode === 'live' && tenant.stripe_onboarding_complete) {
                connectedAccountId = tenant.stripe_account_id
              }

              const stripeOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined
              const pi = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions)
              paymentMethodId = pi.payment_method as string
              console.log('[ACTIVATE] Retrieved payment method:', paymentMethodId)
            }
          }
        }
      } catch (err) {
        console.error('[ACTIVATE] Error retrieving payment method (non-fatal):', err)
      }
    }

    // Mark the first installment as paid
    const { data: firstInstallment } = await supabase
      .from('scheduled_installments')
      .select('id, amount')
      .eq('installment_plan_id', installmentPlan.id)
      .eq('installment_number', 1)
      .single()

    let paidInstallments = 0
    let totalPaidAmount = 0

    if (firstInstallment) {
      const { error: installmentError } = await supabase
        .from('scheduled_installments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          payment_id: paymentRecordId,
          stripe_payment_intent_id: paymentIntentId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', firstInstallment.id)

      if (installmentError) {
        console.error('[ACTIVATE] Error marking first installment as paid:', installmentError)
      } else {
        console.log('[ACTIVATE] First installment marked as paid:', firstInstallment.id)
        paidInstallments = 1
        totalPaidAmount = firstInstallment.amount
      }
    }

    // Activate the plan
    const { error: activateError } = await supabase
      .from('installment_plans')
      .update({
        status: 'active',
        upfront_paid: true,
        upfront_payment_id: paymentRecordId,
        stripe_payment_method_id: paymentMethodId,
        ...(customerStripeId ? { stripe_customer_id: customerStripeId } : {}),
        paid_installments: paidInstallments,
        total_paid: totalPaidAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', installmentPlan.id)

    if (activateError) {
      console.error('[ACTIVATE] Error activating installment plan:', activateError)
      return new Response(
        JSON.stringify({ error: 'Failed to activate plan', details: activateError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    console.log('[ACTIVATE] Installment plan activated successfully:', installmentPlan.id)

    // Update rental payment status
    const { error: rentalError } = await supabase
      .from('rentals')
      .update({
        payment_status: 'fulfilled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', rentalId)

    if (rentalError) {
      console.error('[ACTIVATE] Error updating rental status:', rentalError)
    }

    // Trigger ledger allocation for the upfront payment
    if (paymentRecordId) {
      try {
        const applyResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/apply-payment`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ paymentId: paymentRecordId }),
          }
        )
        if (applyResponse.ok) {
          console.log('[ACTIVATE] Payment allocation completed for:', paymentRecordId)
        } else {
          console.error('[ACTIVATE] Payment allocation failed:', await applyResponse.text())
        }
      } catch (applyError) {
        console.error('[ACTIVATE] Error applying payment to ledger:', applyError)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        plan_id: installmentPlan.id,
        paid_installments: paidInstallments,
        total_paid: totalPaidAmount,
        payment_method_id: paymentMethodId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('[ACTIVATE] Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
