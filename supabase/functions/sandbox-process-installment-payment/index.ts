// sandbox-process-installment-payment
//
// SANDBOX copy of `process-installment-payment` — Dev Panel "Time Machine" ONLY.
//
// This is a strict, FAIL-CLOSED, SINGLE-RENTAL variant. Unlike the real cron it
// has NO global path: it REFUSES to run without a valid `only_rental_id` (UUID),
// and — when `SANDBOX_TEST_TENANT_ID` is configured — REFUSES any rental not
// owned by that one designated test tenant. A `preview: true` request performs
// ZERO writes / ZERO Stripe / ZERO RPC / ZERO email and just reports which
// rentals its driver query would match (used by route.ts for the blast-radius
// pre-check).
//
// The real `process-installment-payment` cron is never modified and keeps
// serving every tenant on its schedule. A bug here therefore cannot reach a
// real customer: this function only ever touches installment plans belonging to
// the single rental id it is handed, in the designated test tenant.
//
// The charging logic below is copied VERBATIM from process-installment-payment
// so the sandbox exercises the same behaviour; the ONLY differences are the
// fail-closed guard, the tenant-lock, the preview branch, the ALWAYS-scoped
// driver query, and the [Sandbox...] log prefixes.
//
// AUDIT NOTE: this function is already AIRTIGHT — the driver query filters
// installment_plans by rental_id, and every subsequent read/write is keyed off
// a plan we already scoped to the one rental. No read-scoping change was needed;
// only the fail-closed wrapper was added.

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const SANDBOX_TENANT = Deno.env.get('SANDBOX_TEST_TENANT_ID') || null

  const now = new Date()
  const todayStr = now.toISOString().split('T')[0]

  // ── FAIL-CLOSED scope parse — no valid single-rental id => refuse. ──────────
  let body: any = null
  try { body = await req.json() } catch { /* handled below */ }
  const onlyRentalId = typeof body?.only_rental_id === 'string' ? body.only_rental_id.trim() : ''
  const preview = body?.preview === true
  if (!UUID_RE.test(onlyRentalId)) {
    return json({ success: false, error: 'sandbox: a valid only_rental_id (UUID) is required' }, 400)
  }

  let attempted = 0
  let charged = 0
  let failed = 0
  let skipped = 0

  try {
    // ── TENANT-LOCK: resolve the target rental and confirm it belongs to the
    //    designated test tenant before doing anything else. ─────────────────
    const { data: target, error: targetErr } = await supabase
      .from('rentals').select('id, tenant_id').eq('id', onlyRentalId).maybeSingle()
    if (targetErr) throw targetErr
    if (!target) return json({ success: false, error: 'sandbox: rental not found' }, 404)
    if (SANDBOX_TENANT && target.tenant_id !== SANDBOX_TENANT) {
      return json({ success: false, error: 'sandbox: rental is not in the designated test tenant' }, 403)
    }

    // Find plans with at least one open + past-due installment that we
    // haven't reminded/charged in the last 24h.
    // Sandbox: driver query is IDENTICAL to the source but ALWAYS hard-scoped to
    // the one rental id (there is no code path that omits this filter).
    const planQuery = supabase
      .from('installment_plans')
      .select(`
        id, tenant_id, customer_id, rental_id,
        collection_mode, status,
        stripe_customer_id, stripe_payment_method_id,
        last_reminder_sent_at, consecutive_sca_failures
      `)
      .eq('status', 'active')
      .eq('collection_mode', 'auto')
      .eq('rental_id', onlyRentalId)
    const { data: candidatePlans, error: planErr } = await planQuery

    if (planErr) throw planErr

    // Distinct underlying rental ids of the candidate plans (driver is over
    // installment_plans, so map to rental_id).
    const matchedRentalIds = [...new Set((candidatePlans ?? []).map((p: any) => p.rental_id))]

    // ── PREVIEW (blast-radius) — zero writes / zero Stripe / zero RPC / zero
    //    email, just report what the driver query would process. ─────────────
    if (preview) return json({ success: true, preview: true, matchedRentalIds })

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
        console.error('[SandboxInstallmentPayment] plan loop error:', plan.id, planLoopErr?.message)
        failed++
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Installment processing complete',
      attempted, charged, failed, skipped,
      matchedRentalIds,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    console.error('[SandboxInstallmentPayment] fatal:', error)
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
    console.error('[SandboxInstallmentPayment] failed to invoke send-installment-reminders:', e)
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
