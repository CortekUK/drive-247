import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface PayEarlyRequest {
  customerId: string
  installmentId: string        // Specific installment to pay
  tenantId?: string
}

interface PayRemainingRequest {
  customerId: string
  installmentPlanId: string    // Pay all remaining installments
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
    const action = url.searchParams.get('action') || 'pay-single'
    const body = await req.json()

    console.log('Pay early request:', action, body)

    // Get customer info
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('stripe_customer_id, tenant_id, email, name')
      .eq('id', body.customerId)
      .single()

    if (customerError || !customer) {
      throw new Error('Customer not found')
    }

    if (!customer.stripe_customer_id) {
      throw new Error('No payment method on file. Please add a card first.')
    }

    const tenantId = body.tenantId || customer.tenant_id
    let stripeMode: StripeMode = 'test'
    let tenantData: any = null

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

    // Get currency from tenant settings (Stripe expects lowercase)
    const currencyCode = (tenantData?.currency_code || 'GBP').toLowerCase()

    const stripe = getStripeClient(stripeMode)
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

    if (action === 'pay-single') {
      // Pay a single installment early
      const { installmentId, customerId }: PayEarlyRequest = body

      // Get installment details
      const { data: installment, error: installmentError } = await supabase
        .from('scheduled_installments')
        .select(`
          id, amount, due_date, status, installment_number,
          installment_plan_id, rental_id, customer_id, tenant_id,
          installment_plans!inner(
            stripe_customer_id,
            stripe_payment_method_id,
            plan_type,
            number_of_installments
          )
        `)
        .eq('id', installmentId)
        .eq('customer_id', customerId)
        .single()

      if (installmentError || !installment) {
        throw new Error('Installment not found')
      }

      if (installment.status === 'paid') {
        throw new Error('This installment has already been paid')
      }

      if (installment.status === 'processing') {
        throw new Error('This installment is currently being processed')
      }

      const plan = installment.installment_plans as any
      const paymentMethodId = plan.stripe_payment_method_id

      if (!paymentMethodId) {
        throw new Error('No payment method on file for this plan')
      }

      // Use plan's stripe_customer_id, fall back to customer table
      const stripeCustomerId = plan.stripe_customer_id || customer.stripe_customer_id

      // Backfill plan if missing
      if (!plan.stripe_customer_id && customer.stripe_customer_id) {
        await supabase
          .from('installment_plans')
          .update({ stripe_customer_id: customer.stripe_customer_id })
          .eq('id', installment.installment_plan_id)
        console.log('Backfilled stripe_customer_id on plan:', installment.installment_plan_id)
      }

      // Mark as processing
      await supabase
        .from('scheduled_installments')
        .update({
          status: 'processing',
          last_attempted_at: new Date().toISOString(),
        })
        .eq('id', installmentId)

      try {
        // Create PaymentIntent and charge immediately
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(installment.amount * 100),
          currency: currencyCode,
          customer: stripeCustomerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Early Payment - Installment #${installment.installment_number}`,
          metadata: {
            type: 'installment',
            installment_id: installmentId,
            installment_plan_id: installment.installment_plan_id,
            rental_id: installment.rental_id,
            customer_id: customerId,
            tenant_id: tenantId || '',
            installment_number: String(installment.installment_number),
            early_payment: 'true',
          },
          receipt_email: customer.email,
        }, stripeOptions)

        console.log('PaymentIntent created:', paymentIntent.id, 'Status:', paymentIntent.status)

        if (paymentIntent.status === 'succeeded') {
          // Create payment record
          const { data: payment } = await supabase
            .from('payments')
            .insert({
              customer_id: customerId,
              rental_id: installment.rental_id,
              amount: installment.amount,
              payment_date: new Date().toISOString().split('T')[0],
              method: 'Card',
              payment_type: 'Payment',
              status: 'Applied',
              verification_status: 'auto_approved',
              stripe_payment_intent_id: paymentIntent.id,
              capture_status: 'captured',
              tenant_id: tenantId,
            })
            .select()
            .single()

          // Mark installment as paid
          await supabase.rpc('mark_installment_paid', {
            p_installment_id: installmentId,
            p_payment_id: payment?.id,
            p_stripe_payment_intent_id: paymentIntent.id,
            p_stripe_charge_id: paymentIntent.latest_charge as string,
          })

          // Apply payment directly to rental charge ledger (inline — no HTTP call)
          if (payment?.id) {
            try {
              const entryDate = payment.payment_date || new Date().toISOString().split('T')[0]

              // 1. Create payment ledger entry
              const { error: ledgerErr } = await supabase
                .from('ledger_entries')
                .insert({
                  customer_id: customerId,
                  rental_id: installment.rental_id,
                  vehicle_id: null,
                  entry_date: entryDate,
                  type: 'Payment',
                  category: 'Rental',
                  amount: -Math.abs(installment.amount),
                  due_date: entryDate,
                  remaining_amount: 0,
                  payment_id: payment.id,
                  tenant_id: tenantId,
                })

              if (ledgerErr) {
                console.error('Ledger entry insert error:', ledgerErr)
              } else {
                console.log('Ledger entry created for payment:', payment.id)
              }

              // 2. Find and reduce the Rental charge remaining_amount
              const { data: rentalCharge } = await supabase
                .from('ledger_entries')
                .select('id, remaining_amount')
                .eq('rental_id', installment.rental_id)
                .eq('type', 'Charge')
                .eq('category', 'Rental')
                .gt('remaining_amount', 0)
                .order('due_date', { ascending: true })
                .limit(1)
                .maybeSingle()

              if (rentalCharge) {
                const newRemaining = Math.max(0, rentalCharge.remaining_amount - installment.amount)
                const { error: chargeErr } = await supabase
                  .from('ledger_entries')
                  .update({ remaining_amount: newRemaining })
                  .eq('id', rentalCharge.id)

                if (chargeErr) {
                  console.error('Charge update error:', chargeErr)
                } else {
                  console.log(`Charge ${rentalCharge.id} remaining: ${rentalCharge.remaining_amount} → ${newRemaining}`)
                }

                // 3. Create payment_application record
                await supabase
                  .from('payment_applications')
                  .insert({
                    payment_id: payment.id,
                    charge_entry_id: rentalCharge.id,
                    amount_applied: Math.min(installment.amount, rentalCharge.remaining_amount),
                    tenant_id: tenantId,
                  })
              } else {
                console.log('No outstanding rental charge found for allocation')
              }
            } catch (applyErr) {
              console.error('Error applying payment to ledger:', applyErr)
            }
          }

          // Send receipt
          try {
            await fetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-installment-receipt`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({
                  installmentId: installmentId,
                  paymentId: payment?.id,
                  customerEmail: customer.email,
                  customerName: customer.name,
                  amount: installment.amount,
                  installmentNumber: installment.installment_number,
                  tenantId: tenantId,
                }),
              }
            )
          } catch (e) {
            console.error('Failed to send receipt:', e)
          }

          return new Response(
            JSON.stringify({
              success: true,
              paymentIntentId: paymentIntent.id,
              paymentId: payment?.id,
              amount: installment.amount,
              message: 'Payment successful',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        } else {
          // Payment requires action or failed
          throw new Error(`Payment not completed. Status: ${paymentIntent.status}`)
        }
      } catch (stripeError: any) {
        // Revert status on failure
        await supabase
          .from('scheduled_installments')
          .update({
            status: 'scheduled',
            last_failure_reason: stripeError.message,
          })
          .eq('id', installmentId)

        throw new Error(stripeError.message || 'Payment failed')
      }

    } else if (action === 'pay-remaining') {
      // Pay all remaining installments at once
      const { installmentPlanId, customerId }: PayRemainingRequest = body

      // Get plan and remaining installments
      const { data: plan, error: planError } = await supabase
        .from('installment_plans')
        .select(`
          id, stripe_customer_id, stripe_payment_method_id,
          total_installable_amount, total_paid, rental_id, tenant_id
        `)
        .eq('id', installmentPlanId)
        .eq('customer_id', customerId)
        .in('status', ['active', 'overdue'])
        .single()

      if (planError || !plan) {
        throw new Error('Installment plan not found or already completed')
      }

      if (!plan.stripe_payment_method_id) {
        throw new Error('No payment method on file')
      }

      // Use plan's stripe_customer_id, fall back to customer table
      const remainingStripeCustomerId = plan.stripe_customer_id || customer.stripe_customer_id

      // Backfill plan if missing
      if (!plan.stripe_customer_id && customer.stripe_customer_id) {
        await supabase
          .from('installment_plans')
          .update({ stripe_customer_id: customer.stripe_customer_id })
          .eq('id', installmentPlanId)
        console.log('Backfilled stripe_customer_id on plan:', installmentPlanId)
      }

      // Get remaining installments
      const { data: remainingInstallments } = await supabase
        .from('scheduled_installments')
        .select('id, amount, installment_number')
        .eq('installment_plan_id', installmentPlanId)
        .in('status', ['scheduled', 'failed'])
        .order('installment_number')

      if (!remainingInstallments || remainingInstallments.length === 0) {
        throw new Error('No remaining installments to pay')
      }

      const totalAmount = remainingInstallments.reduce((sum, i) => sum + i.amount, 0)

      // Mark all as processing
      const installmentIds = remainingInstallments.map(i => i.id)
      await supabase
        .from('scheduled_installments')
        .update({
          status: 'processing',
          last_attempted_at: new Date().toISOString(),
        })
        .in('id', installmentIds)

      try {
        // Create single PaymentIntent for total
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(totalAmount * 100),
          currency: currencyCode,
          customer: remainingStripeCustomerId,
          payment_method: plan.stripe_payment_method_id,
          off_session: true,
          confirm: true,
          description: `Pay Off Remaining - ${remainingInstallments.length} installments`,
          metadata: {
            type: 'installment_payoff',
            installment_plan_id: installmentPlanId,
            rental_id: plan.rental_id,
            customer_id: customerId,
            tenant_id: tenantId || '',
            installment_count: String(remainingInstallments.length),
          },
          receipt_email: customer.email,
        }, stripeOptions)

        if (paymentIntent.status === 'succeeded') {
          // Create payment record
          const { data: payment } = await supabase
            .from('payments')
            .insert({
              customer_id: customerId,
              rental_id: plan.rental_id,
              amount: totalAmount,
              payment_date: new Date().toISOString().split('T')[0],
              method: 'Card',
              payment_type: 'Payment',
              status: 'Applied',
              verification_status: 'auto_approved',
              stripe_payment_intent_id: paymentIntent.id,
              capture_status: 'captured',
              tenant_id: tenantId,
            })
            .select()
            .single()

          // Mark all installments as paid
          for (const inst of remainingInstallments) {
            await supabase.rpc('mark_installment_paid', {
              p_installment_id: inst.id,
              p_payment_id: payment?.id,
              p_stripe_payment_intent_id: paymentIntent.id,
              p_stripe_charge_id: paymentIntent.latest_charge as string,
            })
          }

          // Apply payment directly to rental charge ledger (inline — no HTTP call)
          if (payment?.id) {
            try {
              const entryDate = payment.payment_date || new Date().toISOString().split('T')[0]

              // 1. Create payment ledger entry
              const { error: ledgerErr } = await supabase
                .from('ledger_entries')
                .insert({
                  customer_id: customerId,
                  rental_id: plan.rental_id,
                  vehicle_id: null,
                  entry_date: entryDate,
                  type: 'Payment',
                  category: 'Rental',
                  amount: -Math.abs(totalAmount),
                  due_date: entryDate,
                  remaining_amount: 0,
                  payment_id: payment.id,
                  tenant_id: tenantId,
                })

              if (ledgerErr) {
                console.error('Ledger entry insert error:', ledgerErr)
              } else {
                console.log('Ledger entry created for payoff payment:', payment.id)
              }

              // 2. Find and reduce the Rental charge remaining_amount
              const { data: rentalCharge } = await supabase
                .from('ledger_entries')
                .select('id, remaining_amount')
                .eq('rental_id', plan.rental_id)
                .eq('type', 'Charge')
                .eq('category', 'Rental')
                .gt('remaining_amount', 0)
                .order('due_date', { ascending: true })
                .limit(1)
                .maybeSingle()

              if (rentalCharge) {
                const newRemaining = Math.max(0, rentalCharge.remaining_amount - totalAmount)
                const { error: chargeErr } = await supabase
                  .from('ledger_entries')
                  .update({ remaining_amount: newRemaining })
                  .eq('id', rentalCharge.id)

                if (chargeErr) {
                  console.error('Charge update error:', chargeErr)
                } else {
                  console.log(`Charge ${rentalCharge.id} remaining: ${rentalCharge.remaining_amount} → ${newRemaining}`)
                }

                // 3. Create payment_application record
                await supabase
                  .from('payment_applications')
                  .insert({
                    payment_id: payment.id,
                    charge_entry_id: rentalCharge.id,
                    amount_applied: Math.min(totalAmount, rentalCharge.remaining_amount),
                    tenant_id: tenantId,
                  })
              } else {
                console.log('No outstanding rental charge found for allocation')
              }
            } catch (applyErr) {
              console.error('Error applying payment to ledger:', applyErr)
            }
          }

          // Mark plan as completed
          await supabase
            .from('installment_plans')
            .update({
              status: 'completed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', installmentPlanId)

          return new Response(
            JSON.stringify({
              success: true,
              paymentIntentId: paymentIntent.id,
              paymentId: payment?.id,
              amount: totalAmount,
              installmentsPaid: remainingInstallments.length,
              message: 'All remaining installments paid successfully',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        } else {
          throw new Error(`Payment not completed. Status: ${paymentIntent.status}`)
        }
      } catch (stripeError: any) {
        // Revert status on failure
        await supabase
          .from('scheduled_installments')
          .update({
            status: 'scheduled',
            last_failure_reason: stripeError.message,
          })
          .in('id', installmentIds)

        throw new Error(stripeError.message || 'Payment failed')
      }
    }

    throw new Error('Invalid action')

  } catch (error) {
    console.error('Error in pay-installment-early:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
