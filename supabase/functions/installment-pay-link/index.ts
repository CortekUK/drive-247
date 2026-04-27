// installment-pay-link
//
// Magic-link redirect endpoint for unauthenticated installment payment.
// verify_jwt = false (this is the URL we put in reminder emails).
//
// GET /functions/v1/installment-pay-link?token=<token>
//   1. Look up token → resolves to an installment_plan_id
//   2. Compute current cumulative outstanding (all 'open' installments)
//   3. Create a fresh Stripe Checkout session
//   4. Return 302 redirect to session.url
//
// On expiry / no balance / not-found, render a friendly HTML page
// (booking app does NOT need to handle these — the redirect lives here).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getStripeClient, getConnectAccountId, type StripeMode } from '../_shared/stripe-client.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function htmlPage(title: string, body: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
     <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#374151;margin:0;padding:32px;}
     .card{max-width:480px;margin:80px auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:32px;}
     h1{margin:0 0 8px;font-size:20px;color:#111827;}
     p{margin:0 0 12px;font-size:14px;line-height:1.5;}
     </style></head>
     <body><div class="card">${body}</div></body></html>`,
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'text/html' },
    },
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const url = new URL(req.url)
    let token = url.searchParams.get('token')
    // Caller can also tell us where to bounce the customer after Stripe — used
    // by the booking app /pay/[token] page so we land back on the right tenant
    // subdomain, not the BOOKING_APP_URL env default.
    const callerOrigin = url.searchParams.get('origin') || ''
    if (!token && req.method === 'POST') {
      try { const body = await req.json(); token = body?.token || null } catch { /* empty body */ }
    }

    if (!token) {
      return htmlPage('Missing token', `<h1>Link missing token</h1>
        <p>This payment link is incomplete. Please use the most recent link from your reminder email.</p>`, 400)
    }

    // Resolve token → plan
    const { data: link, error: linkErr } = await supabase
      .from('installment_payment_links')
      .select('id, installment_plan_id, tenant_id, expires_at, used_at')
      .eq('token', token)
      .single()

    if (linkErr || !link) {
      return htmlPage('Invalid link', `<h1>Link not found</h1>
        <p>This payment link is invalid. Please request a new one from your operator or check your most recent reminder email.</p>`, 404)
    }

    if (new Date(link.expires_at).getTime() < Date.now()) {
      return htmlPage('Expired link', `<h1>Link expired</h1>
        <p>This payment link has expired. A new one will be sent in your next reminder email.</p>`, 410)
    }

    // Plan + cumulative outstanding
    const { data: plan } = await supabase
      .from('installment_plans')
      .select(`
        id, tenant_id, customer_id, rental_id,
        stripe_customer_id, status
      `)
      .eq('id', link.installment_plan_id)
      .single()

    if (!plan) {
      return htmlPage('Plan not found', `<h1>Plan not found</h1>
        <p>The associated installment plan could not be found.</p>`, 404)
    }

    if (plan.status === 'cancelled' || plan.status === 'paused') {
      return htmlPage('Plan inactive', `<h1>Plan is ${plan.status}</h1>
        <p>This installment plan is currently ${plan.status}. Please contact your operator for next steps.</p>`, 200)
    }

    const todayStr = new Date().toISOString().split('T')[0]
    const { data: openOverdue } = await supabase
      .from('scheduled_installments')
      .select('id, installment_number, amount, due_date')
      .eq('installment_plan_id', plan.id)
      .eq('invoice_status', 'open')
      .lte('due_date', todayStr)
      .order('installment_number', { ascending: true })

    if (!openOverdue || openOverdue.length === 0) {
      return htmlPage('Nothing due', `<h1>You're all caught up</h1>
        <p>There are no installments currently outstanding on this plan. Thank you!</p>`, 200)
    }

    const cumulative = openOverdue.reduce((s, i) => s + Number(i.amount || 0), 0)
    const latest = openOverdue[openOverdue.length - 1]

    // Tenant Stripe context
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, company_name, stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code')
      .eq('id', plan.tenant_id)
      .single()

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || 'test'
    const currency = (tenant?.currency_code || 'USD').toLowerCase()
    const stripe = getStripeClient(stripeMode)
    const stripeAccountId = tenant ? getConnectAccountId(tenant) : null
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

    // Customer email for receipt
    const { data: customer } = await supabase
      .from('customers')
      .select('email, name')
      .eq('id', plan.customer_id)
      .single()

    // Verify the saved Stripe customer still exists. Mock/seeded plans (and
    // edge cases where Stripe-side data was deleted) won't resolve, so fall
    // back to a customer-less session keyed by email instead of crashing.
    let validStripeCustomerId: string | undefined = undefined
    if (plan.stripe_customer_id) {
      try {
        await stripe.customers.retrieve(plan.stripe_customer_id, stripeOptions)
        validStripeCustomerId = plan.stripe_customer_id
      } catch (custErr: any) {
        console.warn('Stripe customer not retrievable, falling back to email:', plan.stripe_customer_id, custErr?.code)
      }
    }

    // Create fresh Checkout session — prefer the caller-provided origin so we
    // land back on the actual tenant subdomain the customer started from.
    const origin = callerOrigin || Deno.env.get('BOOKING_APP_URL') || 'https://drive-247.com'
    const session = await stripe.checkout.sessions.create({
      customer: validStripeCustomerId,
      customer_email: validStripeCustomerId ? undefined : customer?.email,
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency,
          product_data: {
            name: `Installment payment — ${openOverdue.length} unpaid`,
            description: `Cumulative settlement for ${tenant?.company_name || 'rental'}`,
          },
          unit_amount: Math.round(cumulative * 100),
        },
        quantity: 1,
      }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: {
          type: 'installment_paylink',
          installment_plan_id: plan.id,
          installment_id: latest.id,
          installment_number: String(latest.installment_number),
          rental_id: plan.rental_id,
          customer_id: plan.customer_id,
          tenant_id: plan.tenant_id,
          payment_link_token: token,
          cumulative_count: String(openOverdue.length),
        },
      },
      client_reference_id: plan.rental_id,
      success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${plan.rental_id}&installment=true`,
      cancel_url: `${origin}/pay/${token}?cancelled=1`,
      metadata: {
        installment_plan_id: plan.id,
        installment_id: latest.id,
        rental_id: plan.rental_id,
        tenant_id: plan.tenant_id,
        stripe_account_id: stripeAccountId || '',
        stripe_mode: stripeMode,
        checkout_type: 'installment_paylink',
      },
    }, stripeOptions)

    // Mark token used (record session id; allow re-use until paid)
    await supabase.from('installment_payment_links').update({
      last_used_session_id: session.id,
      used_at: link.used_at || new Date().toISOString(),
    }).eq('id', link.id)

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: session.url ?? `${origin}/pay/${token}` },
    })
  } catch (error: any) {
    console.error('installment-pay-link error:', error)
    return htmlPage('Error', `<h1>Something went wrong</h1>
      <p>${error?.message || 'Please try again or contact your operator.'}</p>`, 500)
  }
})
