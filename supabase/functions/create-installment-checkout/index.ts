// create-installment-checkout
//
// Simplified installment model:
//   unit:             'week' | 'month'
//   paymentsPerUnit:  1 | 2 | 4
//   interval_days =   (unit === 'week' ? 7 : 30) / paymentsPerUnit
//
// Splittable amount = base rental + tax + service fee.
// Upfront fixed   = insurance + booking/delivery fees (NOT split).
// Deposit         = Stripe preauth hold (out of band, not handled here).
//
// On checkout success the Stripe webhook calls installment_settle_invoice
// for the first installment, which marks it paid and (no-op) supersedes any
// earlier opens. Subsequent installments are charged off-session by the
// process-installment-payment cron.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, type StripeMode, type PlatformAccount } from '../_shared/stripe-client.ts'
import { formatCurrency } from '../_shared/format-utils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

const WEEK_DAYS = 7
const MONTH_DAYS = 30

interface InstallmentCheckoutRequest {
  rentalId: string
  customerId: string
  customerEmail: string
  customerName: string
  customerPhone?: string
  vehicleId: string
  vehicleName: string

  unit: 'week' | 'month'
  paymentsPerUnit: number          // 1, 2, or 4
  numberOfInstallments: number     // total

  installableAmount: number        // base + tax + service (the splittable)
  upfrontFixedAmount: number       // insurance + booking + delivery (always upfront)
  installmentAmount: number        // per-installment amount

  startDate: string                // when installments begin (rental start)
  pickupDate: string
  returnDate: string

  tenantId?: string
  protectionPlan?: string
}

function intervalDays(unit: 'week' | 'month', paymentsPerUnit: number) {
  const span = unit === 'week' ? WEEK_DAYS : MONTH_DAYS
  return span / paymentsPerUnit
}

function frequencyLabel(unit: 'week' | 'month', paymentsPerUnit: number): string {
  if (unit === 'week') {
    return paymentsPerUnit === 1 ? 'Weekly' : paymentsPerUnit === 2 ? 'Twice weekly' : `${paymentsPerUnit}× per week`
  }
  return paymentsPerUnit === 1 ? 'Monthly'
       : paymentsPerUnit === 2 ? 'Twice monthly'
       : paymentsPerUnit === 4 ? 'Weekly via monthly'
       : `${paymentsPerUnit}× per month`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const raw = await req.json()
    const origin = req.headers.get('origin') || 'https://drive-247.com'

    // ── back-compat shim: old callers send planType + baseUpfrontAmount ──
    // Translate to the new (unit, paymentsPerUnit, upfrontFixedAmount) shape.
    const body: InstallmentCheckoutRequest = (() => {
      if (raw.unit && raw.paymentsPerUnit) return raw as InstallmentCheckoutRequest
      const planType = raw.planType as string | undefined
      const unit: 'week' | 'month' = planType === 'monthly' ? 'month' : 'week'
      const paymentsPerUnit = planType === 'semiweekly' ? 2 : 1
      const upfrontFixedAmount = raw.upfrontFixedAmount ?? raw.baseUpfrontAmount ?? 0
      return { ...raw, unit, paymentsPerUnit, upfrontFixedAmount } as InstallmentCheckoutRequest
    })()

    // ── validate ──────────────────────────────────────────────────
    if (!body.rentalId || !body.customerId || !body.customerEmail) {
      throw new Error('Missing required fields: rentalId, customerId, customerEmail')
    }
    if (body.unit !== 'week' && body.unit !== 'month') {
      throw new Error('Invalid unit (must be week or month)')
    }
    if (![1, 2, 4].includes(body.paymentsPerUnit)) {
      throw new Error('Invalid paymentsPerUnit (1, 2, or 4)')
    }
    if (body.numberOfInstallments < 2 || body.numberOfInstallments > 24) {
      throw new Error('Invalid numberOfInstallments (must be 2-24)')
    }
    if (body.installableAmount <= 0 || body.installmentAmount <= 0) {
      throw new Error('Invalid installment amounts')
    }

    const { data: existingPlan } = await supabase
      .from('installment_plans')
      .select('id, status')
      .eq('rental_id', body.rentalId)
      .in('status', ['active', 'pending'])
      .maybeSingle()
    if (existingPlan) {
      throw new Error(`An installment plan already exists for this rental (status: ${existingPlan.status})`)
    }

    // ── tenant + Stripe context ───────────────────────────────────
    let tenantId = body.tenantId
    if (!tenantId) {
      const { data: rental } = await supabase
        .from('rentals')
        .select('tenant_id')
        .eq('id', body.rentalId)
        .single()
      tenantId = rental?.tenant_id
    }

    let stripeMode: StripeMode = 'test'
    let tenantData: any = null
    if (tenantId) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code, company_name')
        .eq('id', tenantId)
        .single()
      if (tenant) {
        stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
        tenantData = tenant
      }
    }

    const currencyCode = (tenantData?.currency_code || 'USD').toLowerCase()
    const platformAccount: PlatformAccount = tenantData ? getChargePlatformAccount(tenantData) : 'uk'
    const stripe = getStripeClientForAccount(platformAccount, stripeMode)
    const stripeAccountId = tenantData ? getConnectAccountId(tenantData) : null
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

    // ── compute schedule ──────────────────────────────────────────
    const step = intervalDays(body.unit, body.paymentsPerUnit)
    const totalCheckoutAmount = body.upfrontFixedAmount + body.installmentAmount

    // schedule = N installments evenly spaced from startDate
    // Installment #1 is "today" (paid in checkout); #2 onwards are due in the future
    const schedule: { number: number; date: string; amount: number }[] = []
    const start = new Date(body.startDate)
    const last = body.numberOfInstallments

    let runningRemainder = body.installableAmount
    for (let i = 1; i <= last; i++) {
      const due = new Date(start)
      due.setDate(due.getDate() + Math.round((i - 1) * step))

      let amount: number
      if (i === last) {
        // remainder goes to last to soak up rounding
        amount = Math.round(runningRemainder * 100) / 100
      } else {
        amount = body.installmentAmount
        runningRemainder -= amount
      }

      schedule.push({ number: i, date: due.toISOString().split('T')[0], amount })
    }

    // ── Stripe customer ──────────────────────────────────────────
    let stripeCustomerId: string
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('stripe_customer_id')
      .eq('id', body.customerId)
      .single()

    if (existingCustomer?.stripe_customer_id) {
      stripeCustomerId = existingCustomer.stripe_customer_id
    } else {
      const customer = await stripe.customers.create({
        email: body.customerEmail,
        name: body.customerName,
        phone: body.customerPhone,
        metadata: {
          drive247_customer_id: body.customerId,
          tenant_id: tenantId || '',
        },
      }, stripeOptions)
      stripeCustomerId = customer.id
      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', body.customerId)
    }

    // ── installment_plan row (create FIRST so we have its id) ────
    const nextDueDate = schedule[1]?.date || null

    const { data: installmentPlan, error: planError } = await supabase
      .from('installment_plans')
      .insert({
        rental_id: body.rentalId,
        tenant_id: tenantId,
        customer_id: body.customerId,
        plan_type: body.unit === 'week' ? (body.paymentsPerUnit === 2 ? 'semiweekly' : 'weekly') : 'monthly',
        unit: body.unit,
        payments_per_unit: body.paymentsPerUnit,
        collection_mode: 'auto',
        total_installable_amount: body.installableAmount,
        number_of_installments: body.numberOfInstallments,
        installment_amount: body.installmentAmount,
        upfront_amount: body.upfrontFixedAmount,
        upfront_paid: false,
        paid_installments: 0,
        total_paid: 0,
        stripe_customer_id: stripeCustomerId,
        status: 'pending',
        next_due_date: nextDueDate,
        config: {
          frequency_label: frequencyLabel(body.unit, body.paymentsPerUnit),
        },
      })
      .select()
      .single()

    if (planError) {
      console.error('plan insert error:', planError)
      throw new Error('Failed to create installment plan')
    }

    // ── insert all scheduled_installments as 'open' ──────────────
    const installmentRows = schedule.map((s) => ({
      installment_plan_id: installmentPlan.id,
      tenant_id: tenantId,
      rental_id: body.rentalId,
      customer_id: body.customerId,
      installment_number: s.number,
      amount: s.amount,
      due_date: s.date,
      status: 'scheduled',
      invoice_status: 'open',
    }))

    const { data: insertedInstallments, error: instErr } = await supabase
      .from('scheduled_installments')
      .insert(installmentRows)
      .select('id, installment_number')
    if (instErr) {
      console.error('installments insert error:', instErr)
      throw new Error('Failed to create scheduled installments')
    }

    const firstInstallment = insertedInstallments?.find(i => i.installment_number === 1)

    // ── metadata for the Stripe webhook to settle on success ─────
    const metadata: Record<string, string> = {
      rental_id: body.rentalId,
      customer_id: body.customerId,
      customer_email: body.customerEmail,
      vehicle_id: body.vehicleId,
      tenant_id: tenantId || '',
      checkout_type: 'installment',
      installment_plan_id: installmentPlan.id,
      installment_id: firstInstallment?.id || '',
      installment_number: '1',
      unit: body.unit,
      payments_per_unit: String(body.paymentsPerUnit),
      number_of_installments: String(body.numberOfInstallments),
      upfront_fixed_amount: String(body.upfrontFixedAmount),
      installable_amount: String(body.installableAmount),
      installment_amount: String(body.installmentAmount),
    }

    // ── Stripe Checkout session ──────────────────────────────────
    const lineItemDescription =
      `${body.vehicleName} — fees (${formatCurrency(body.upfrontFixedAmount, currencyCode)})` +
      ` + first installment (${formatCurrency(body.installmentAmount, currencyCode)})`

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: currencyCode,
          product_data: {
            name: 'Fees + First Installment',
            description: lineItemDescription,
          },
          unit_amount: Math.round(totalCheckoutAmount * 100),
        },
        quantity: 1,
      }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata,
        description: `Installment plan for ${body.vehicleName} (${frequencyLabel(body.unit, body.paymentsPerUnit)})`,
      },
      client_reference_id: body.rentalId,
      success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${body.rentalId}&installment=true`,
      cancel_url: `${origin}/booking-cancelled?rental_id=${body.rentalId}`,
      metadata: {
        ...metadata,
        stripe_account_id: stripeAccountId || '',
        stripe_mode: stripeMode,
      },
    }, stripeOptions)

    // ── upfront payment row (Pending, settled by webhook) ────────
    const { data: upfrontPayment } = await supabase
      .from('payments')
      .insert({
        customer_id: body.customerId,
        rental_id: body.rentalId,
        vehicle_id: body.vehicleId,
        amount: totalCheckoutAmount,
        payment_date: new Date().toISOString().split('T')[0],
        method: 'Card',
        payment_type: 'InitialFee',
        status: 'Pending',
        verification_status: 'auto_approved',
        stripe_checkout_session_id: session.id,
        capture_status: 'captured',
        booking_source: 'website',
        tenant_id: tenantId,
        platform_account: platformAccount,
      })
      .select()
      .single()

    // ── tag the rental ───────────────────────────────────────────
    await supabase
      .from('rentals')
      .update({
        has_installment_plan: true,
        installment_plan_id: installmentPlan.id,
      })
      .eq('id', body.rentalId)

    return new Response(JSON.stringify({
      sessionId: session.id,
      url: session.url,
      paymentId: upfrontPayment?.id,
      installmentPlanId: installmentPlan.id,
      stripeCustomerId,
      summary: {
        upfrontFixedAmount: body.upfrontFixedAmount,
        installableAmount: body.installableAmount,
        installmentAmount: body.installmentAmount,
        numberOfInstallments: body.numberOfInstallments,
        unit: body.unit,
        paymentsPerUnit: body.paymentsPerUnit,
        frequencyLabel: frequencyLabel(body.unit, body.paymentsPerUnit),
        nextDueDate,
        schedule,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('create-installment-checkout error:', error)
    let message = 'Unable to create payment session.'
    let status = 400
    if (error instanceof Stripe.errors.StripeError) {
      message = error.message || message
    } else if (error instanceof Error) {
      message = error.message
    }
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    })
  }
})
