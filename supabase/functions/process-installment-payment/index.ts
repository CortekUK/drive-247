// process-installment-payment
//
// Hourly cron. For each installment plan with collection_mode='auto' and
// any 'open' invoice past due:
//   - Skip if last_reminder_sent_at within last 24h (PAYG-style cadence)
//   - Sum cumulative outstanding across ALL 'open' installments on the plan
//   - Try one off-session PaymentIntent for the cumulative amount
//   - On success: create payment row + call installment_settle_invoice
//                 with the latest open installment id (cascades supersession)
//   - On failure: log reason, send reminder email, stamp last_reminder_sent_at
//   - After 3 consecutive SCA-required failures: flip plan to manual mode

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DAY_MS = 24 * 60 * 60 * 1000
const SCA_THRESHOLD = 3 // consecutive SCA failures before flipping to manual

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  // Optional sandbox scoping — restrict to one rental's plans so a manual
  // dispatch can never charge another tenant. Null = global cron (unchanged).
  let onlyRentalId: string | null = null
  try {
    const reqBody = await req.json()
    onlyRentalId = typeof reqBody?.only_rental_id === 'string' ? reqBody.only_rental_id : null
  } catch { /* no body — global cron run */ }

  let attempted = 0
  let charged = 0
  let failed = 0
  let skipped = 0

  try {
    // Find plans with at least one open + past-due installment that we
    // haven't reminded/charged in the last 24h
    let planQuery = supabase
      .from('installment_plans')
      .select(`
        id, tenant_id, customer_id, rental_id,
        collection_mode, status,
        stripe_customer_id, stripe_payment_method_id,
        last_reminder_sent_at, consecutive_sca_failures
      `)
      .eq('status', 'active')
      .eq('collection_mode', 'auto')
    // Sandbox scoping — hard-restrict to one rental's plans when requested.
    if (onlyRentalId) planQuery = planQuery.eq('rental_id', onlyRentalId)
    const { data: candidatePlans, error: planErr } = await planQuery

    if (planErr) throw planErr

    for (const plan of (candidatePlans ?? [])) {
      try {
        // 24h cooldown
        if (plan.last_reminder_sent_at) {
          const lastTs = new Date(plan.last_reminder_sent_at).getTime()
          if (now.getTime() < lastTs + DAY_MS) { skipped++; continue }
        }

        // Find all open + due installments on this plan
        const { data: openOverdue } = await supabase
          .from('scheduled_installments')
          .select('id, installment_number, amount, due_date')
          .eq('installment_plan_id', plan.id)
          .eq('invoice_status', 'open')
          .lte('due_date', todayStr)
          .order('installment_number', { ascending: true })

        if (!openOverdue || openOverdue.length === 0) { skipped++; continue }

        const cumulativeAmount = openOverdue.reduce((s, i) => s + Number(i.amount || 0), 0)
        const latest = openOverdue[openOverdue.length - 1]

        if (!plan.stripe_customer_id || !plan.stripe_payment_method_id) {
          // No saved card — should be in manual mode but isn't. Send reminder + flip.
          await supabase.from('installment_plans')
            .update({ collection_mode: 'manual', last_reminder_sent_at: now.toISOString() })
            .eq('id', plan.id)
          await logEvent(supabase, plan.id, latest.id, plan.tenant_id, {
            type: 'auto_skipped_no_card',
            status: 'warning',
            message: 'Auto charge skipped: no saved card. Plan flipped to manual mode.',
          })
          skipped++
          continue
        }

        // Get tenant for Stripe context
        const { data: tenant } = await supabase
          .from('tenants')
          .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code')
          .eq('id', plan.tenant_id)
          .single()
        const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || 'test'
        const currency = (tenant?.currency_code || 'USD').toLowerCase()
        const platformAccount = tenant ? getChargePlatformAccount(tenant) : 'uk'
        const stripe = getStripeClientForAccount(platformAccount, stripeMode)
        const stripeAccountId = tenant ? getConnectAccountId(tenant) : null
        const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

        attempted++
        try {
          const pi = await stripe.paymentIntents.create({
            amount: Math.round(cumulativeAmount * 100),
            currency,
            customer: plan.stripe_customer_id,
            payment_method: plan.stripe_payment_method_id,
            off_session: true,
            confirm: true,
            description: `Installment cumulative settlement (#${latest.installment_number})`,
            metadata: {
              type: 'installment_cumulative',
              installment_plan_id: plan.id,
              installment_id: latest.id,
              installment_number: String(latest.installment_number),
              rental_id: plan.rental_id,
              customer_id: plan.customer_id,
              tenant_id: plan.tenant_id,
              cumulative_count: String(openOverdue.length),
            },
          }, stripeOptions)

          if (pi.status === 'succeeded') {
            // Record payment + call settle RPC
            const { data: payment } = await supabase.from('payments').insert({
              customer_id: plan.customer_id,
              rental_id: plan.rental_id,
              amount: cumulativeAmount,
              payment_date: todayStr,
              method: 'Card',
              payment_type: 'Payment',
              status: 'Applied',
              verification_status: 'auto_approved',
              stripe_payment_intent_id: pi.id,
              capture_status: 'captured',
              tenant_id: plan.tenant_id,
              platform_account: platformAccount,
            }).select().single()

            await supabase.rpc('installment_settle_invoice', {
              p_payment_id: payment?.id,
              p_installment_id: latest.id,
            })

            await logEvent(supabase, plan.id, latest.id, plan.tenant_id, {
              type: 'auto_charge_succeeded',
              status: 'success',
              amount: cumulativeAmount,
              payment_id: payment?.id,
              message: `Charged ${cumulativeAmount.toFixed(2)} cumulative across ${openOverdue.length} installment(s)`,
            })
            charged++
          } else {
            // requires_action / requires_confirmation / etc. — treat as failure
            await handleFailure(supabase, plan, latest.id, `payment_intent_status:${pi.status}`, true, now)
            failed++
          }
        } catch (chargeErr: any) {
          const code = chargeErr?.code || chargeErr?.decline_code || chargeErr?.type || 'unknown'
          const isSca = code === 'authentication_required' || chargeErr?.code === 'authentication_required'
          await handleFailure(supabase, plan, latest.id, code, isSca, now)
          failed++
        }
      } catch (planLoopErr: any) {
        console.error('plan loop error:', plan.id, planLoopErr?.message)
        failed++
      }
    }

    return new Response(JSON.stringify({
      message: 'Installment processing complete',
      attempted, charged, failed, skipped,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    console.error('process-installment-payment fatal:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})

async function handleFailure(
  supabase: any, plan: any, installmentId: string,
  reason: string, isSca: boolean, now: Date,
) {
  const newCount = (plan.consecutive_sca_failures || 0) + (isSca ? 1 : 0)
  const flipToManual = newCount >= SCA_THRESHOLD

  // Increment installment failure_count + record reason
  await supabase.from('scheduled_installments').update({
    failure_count: (plan as any).failure_count ? (plan as any).failure_count + 1 : 1,
    last_failure_reason: reason,
    last_attempted_at: now.toISOString(),
  }).eq('id', installmentId)

  // Update plan-level state + reminder anchor
  await supabase.from('installment_plans').update({
    consecutive_sca_failures: isSca ? newCount : 0, // reset on non-SCA failures
    collection_mode: flipToManual ? 'manual' : plan.collection_mode,
    last_reminder_sent_at: now.toISOString(),
  }).eq('id', plan.id)

  await logEvent(supabase, plan.id, installmentId, plan.tenant_id, {
    type: 'auto_charge_failed',
    status: 'failed',
    message: `Off-session charge failed: ${reason}${flipToManual ? ' — plan moved to manual mode' : ''}`,
  })

  // Trigger reminder email (manual or automatic, both notify the customer)
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-installment-reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ planId: plan.id, reason }),
    })
  } catch (e) {
    console.error('failed to invoke send-installment-reminders:', e)
  }
}

async function logEvent(
  supabase: any, planId: string, installmentId: string, tenantId: string,
  ev: { type: string; status: string; message: string; amount?: number; payment_id?: string },
) {
  await supabase.from('installment_notifications').insert({
    installment_id: installmentId,
    installment_plan_id: planId,
    tenant_id: tenantId,
    notification_type: ev.type,
    status: ev.status,
    amount: ev.amount,
    payment_id: ev.payment_id,
    message: ev.message,
    sent_at: new Date().toISOString(),
  })
}
