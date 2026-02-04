import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ProcessResult {
  installmentId: string
  success: boolean
  error?: string
  paymentIntentId?: string
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

    console.log('Starting installment payment processing...')
    const processDate = new Date().toISOString().split('T')[0]
    console.log('Process date:', processDate)

    // Get all due installments using the database function
    const { data: dueInstallments, error: fetchError } = await supabase
      .rpc('get_due_installments', { p_process_date: processDate })

    if (fetchError) {
      console.error('Error fetching due installments:', fetchError)
      throw new Error('Failed to fetch due installments')
    }

    // Also get failed installments that are eligible for retry
    const { data: retryInstallments, error: retryError } = await supabase
      .rpc('get_installments_for_retry', { p_process_date: processDate })

    if (retryError) {
      console.error('Error fetching retry installments:', retryError)
      // Don't throw - just log and continue with due installments
    }

    // Combine both lists, avoiding duplicates
    const dueIds = new Set((dueInstallments || []).map((i: any) => i.id))
    const allInstallments = [
      ...(dueInstallments || []),
      ...((retryInstallments || []).filter((i: any) => !dueIds.has(i.id))),
    ]

    if (allInstallments.length === 0) {
      console.log('No due or retry-eligible installments found')
      return new Response(
        JSON.stringify({
          message: 'No installments to process',
          processed: 0,
          dueCount: 0,
          retryCount: 0,
          results: [],
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    console.log('Found', (dueInstallments || []).length, 'due installments and',
      ((retryInstallments || []).filter((i: any) => !dueIds.has(i.id))).length, 'retry-eligible installments')

    const results: ProcessResult[] = []

    // Process each installment (due + retries)
    for (const installment of allInstallments) {
      const isRetry = installment.failure_count && installment.failure_count > 0
      console.log('Processing installment:', installment.id, 'Amount:', installment.amount,
        isRetry ? `(Retry #${installment.failure_count + 1})` : '(New)')

      try {
        // Mark as processing
        await supabase
          .from('scheduled_installments')
          .update({
            status: 'processing',
            last_attempted_at: new Date().toISOString(),
          })
          .eq('id', installment.id)

        // Get tenant details for Stripe configuration
        const { data: tenant } = await supabase
          .from('tenants')
          .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
          .eq('id', installment.tenant_id)
          .single()

        const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || 'test'
        const stripe = getStripeClient(stripeMode)
        const stripeAccountId = tenant ? getConnectAccountId(tenant) : null
        const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

        // Validate we have payment method
        if (!installment.stripe_customer_id || !installment.stripe_payment_method_id) {
          throw new Error('Missing Stripe customer or payment method')
        }

        // Get customer email for receipt
        const { data: customer } = await supabase
          .from('customers')
          .select('email, name')
          .eq('id', installment.customer_id)
          .single()

        // Create PaymentIntent with saved payment method (off-session)
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(installment.amount * 100), // Convert to cents
          currency: 'usd',
          customer: installment.stripe_customer_id,
          payment_method: installment.stripe_payment_method_id,
          off_session: true, // KEY: Charge without customer present
          confirm: true,     // Immediately confirm/charge
          description: `Installment Payment #${installment.installment_number} for Rental`,
          metadata: {
            type: 'installment',
            installment_id: installment.id,
            installment_plan_id: installment.installment_plan_id,
            rental_id: installment.rental_id,
            customer_id: installment.customer_id,
            tenant_id: installment.tenant_id,
            installment_number: String(installment.installment_number),
          },
          receipt_email: customer?.email,
        }, stripeOptions)

        console.log('PaymentIntent created:', paymentIntent.id, 'Status:', paymentIntent.status)

        // Update installment with payment intent ID
        await supabase
          .from('scheduled_installments')
          .update({
            stripe_payment_intent_id: paymentIntent.id,
            // Status will be updated by webhook when payment succeeds/fails
          })
          .eq('id', installment.id)

        // If payment succeeded immediately (common for off-session)
        if (paymentIntent.status === 'succeeded') {
          // Create payment record
          const { data: payment } = await supabase
            .from('payments')
            .insert({
              customer_id: installment.customer_id,
              rental_id: installment.rental_id,
              amount: installment.amount,
              payment_date: new Date().toISOString().split('T')[0],
              method: 'Card',
              payment_type: 'Payment',
              status: 'Applied',
              verification_status: 'auto_approved',
              stripe_payment_intent_id: paymentIntent.id,
              capture_status: 'captured',
              tenant_id: installment.tenant_id,
            })
            .select()
            .single()

          // Mark installment as paid using database function
          await supabase.rpc('mark_installment_paid', {
            p_installment_id: installment.id,
            p_payment_id: payment?.id,
            p_stripe_payment_intent_id: paymentIntent.id,
            p_stripe_charge_id: paymentIntent.latest_charge as string,
          })

          console.log('Installment', installment.id, 'paid successfully')

          // Send receipt notification
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
                  installmentId: installment.id,
                  paymentId: payment?.id,
                  customerEmail: customer?.email,
                  customerName: customer?.name,
                  amount: installment.amount,
                  installmentNumber: installment.installment_number,
                  tenantId: installment.tenant_id,
                }),
              }
            )
          } catch (notifyError) {
            console.error('Failed to send receipt notification:', notifyError)
            // Don't fail the process for notification errors
          }
        }

        results.push({
          installmentId: installment.id,
          success: true,
          paymentIntentId: paymentIntent.id,
        })

      } catch (error) {
        console.error('Error processing installment', installment.id, ':', error)

        const errorMessage = error instanceof Error ? error.message : 'Unknown error'

        // Mark as failed using database function
        await supabase.rpc('mark_installment_failed', {
          p_installment_id: installment.id,
          p_failure_reason: errorMessage,
        })

        // Send failure notification
        try {
          const { data: customer } = await supabase
            .from('customers')
            .select('email, name')
            .eq('id', installment.customer_id)
            .single()

          await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-installment-failed`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                installmentId: installment.id,
                customerEmail: customer?.email,
                customerName: customer?.name,
                amount: installment.amount,
                installmentNumber: installment.installment_number,
                failureReason: errorMessage,
                tenantId: installment.tenant_id,
              }),
            }
          )
        } catch (notifyError) {
          console.error('Failed to send failure notification:', notifyError)
        }

        results.push({
          installmentId: installment.id,
          success: false,
          error: errorMessage,
        })
      }
    }

    // Summary
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    const dueCount = (dueInstallments || []).length
    const retryCount = ((retryInstallments || []).filter((i: any) => !dueIds.has(i.id))).length

    console.log('Processing complete. Success:', successful, 'Failed:', failed,
      '| Due:', dueCount, 'Retries:', retryCount)

    return new Response(
      JSON.stringify({
        message: 'Installment processing complete',
        processed: results.length,
        successful,
        failed,
        dueCount,
        retryCount,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Fatal error in installment processing:', error)

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
