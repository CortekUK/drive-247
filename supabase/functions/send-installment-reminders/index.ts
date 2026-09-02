// send-installment-reminders
//
// Two roles:
//   1. Cron mode (no body): scan all plans with overdue 'open' installments,
//      send a reminder email per plan (PAYG-style 24h cadence).
//   2. Direct invocation: invoked by process-installment-payment after a
//      failed charge with `{ planId, reason }` — sends one reminder for that
//      plan immediately.
//
// Email always points to a magic-link URL `/pay/<token>` so guest customers
// can pay without portal access. Token is generated/refreshed per send.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { corsHeaders } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/resend-service.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const TOKEN_LIFETIME_DAYS = 14

function fmtCurrency(amount: number, code: string | null): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code || 'USD' }).format(amount)
  } catch {
    return `${(code || 'USD')} ${Number(amount).toFixed(2)}`
  }
}

function escapeHtml(input: unknown): string {
  if (input === null || input === undefined) return ''
  return String(input)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function genToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function buildEmailHtml(args: {
  customerName: string
  rentalRef: string
  outstanding: number
  count: number
  currency: string | null
  companyName: string
  payUrl: string
  reason?: string | null
}): string {
  const safeCustomer = escapeHtml(args.customerName)
  const safeRef = escapeHtml(args.rentalRef)
  const safeCompany = escapeHtml(args.companyName)
  const totalFmt = escapeHtml(fmtCurrency(args.outstanding, args.currency))
  const safeUrl = escapeHtml(args.payUrl)
  const reasonLine = args.reason
    ? `<p style="margin:0 0 16px; color:#b91c1c; font-size:13px;">Reason: ${escapeHtml(args.reason)}</p>`
    : ''

  return `<!DOCTYPE html>
    <html><head><meta charset="utf-8"/><title>Installment payment due</title></head>
    <body style="margin:0; padding:24px; background:#f8fafc; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:#374151;">
      <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:8px; padding:32px;">
        <h1 style="margin:0 0 8px; color:#111827; font-size:24px; font-weight:600;">Installment payment due</h1>
        <p style="margin:0 0 16px; color:#6b7280; font-size:14px;">Rental ${safeRef}</p>
        <p style="margin:0 0 16px;">Hi ${safeCustomer},</p>
        <p style="margin:0 0 16px;">
          Your rental with <strong>${safeCompany}</strong> has
          <strong>${args.count} unpaid installment${args.count === 1 ? '' : 's'}</strong> totalling
          <strong>${totalFmt}</strong>.
        </p>
        ${reasonLine}
        <p style="margin:0 0 16px; padding:16px; background:#f9fafb; border-radius:6px; border:1px solid #e5e7eb;">
          Outstanding balance: <strong style="font-size:18px; color:#111827;">${totalFmt}</strong>
        </p>
        <div style="text-align:center; margin:24px 0;">
          <a href="${safeUrl}" style="display:inline-block; background:#6366f1; color:#ffffff; padding:14px 28px; border-radius:6px; text-decoration:none; font-weight:600; font-size:16px;">
            Pay ${totalFmt} now
          </a>
        </div>
        <p style="margin:16px 0 0; color:#6b7280; font-size:13px;">
          The link above settles all outstanding installments at once. If you have already paid, please disregard this message.
        </p>
        <p style="margin:24px 0 0; color:#9ca3af; font-size:12px;">— ${safeCompany}</p>
      </div>
    </body></html>`
}

async function sendForPlan(
  supabase: any, plan: any, isCronMode: boolean, reason: string | null, now: Date,
): Promise<'sent' | 'skipped' | 'failed'> {
  const todayStr = now.toISOString().split('T')[0]
  const { data: openOverdue } = await supabase
    .from('scheduled_installments')
    .select('id, installment_number, amount, due_date')
    .eq('installment_plan_id', plan.id)
    .eq('invoice_status', 'open')
    .lte('due_date', todayStr)
    .order('installment_number', { ascending: true })

  if (!openOverdue || openOverdue.length === 0) return 'skipped'

  if (isCronMode && plan.last_reminder_sent_at) {
    const lastTs = new Date(plan.last_reminder_sent_at).getTime()
    if (now.getTime() < lastTs + DAY_MS) return 'skipped'
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, company_name, currency_code')
    .eq('id', plan.tenant_id)
    .single()

  const { data: customer } = await supabase
    .from('customers')
    .select('id, name, email')
    .eq('id', plan.customer_id)
    .single()

  const { data: rental } = await supabase
    .from('rentals')
    .select('id, rental_number')
    .eq('id', plan.rental_id)
    .single()

  if (!customer?.email) return 'skipped'

  const cumulative = openOverdue.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
  const latest = openOverdue[openOverdue.length - 1]

  // Mirror the AddPaymentDialog "Email Stripe Link" flow: create the Stripe
  // Checkout session at send time and embed the Stripe URL directly in the
  // email. This skips the /pay/<token> middleware page so the customer goes
  // straight to Stripe — same UX as the dialog-emailed link.
  //
  // Resolution for the success/cancel origin matches AddPaymentDialog:
  //   1. BOOKING_BASE_URL — explicit override (single-domain QA)
  //   2. https://{tenant.slug}.{BOOKING_BASE_DOMAIN || drive-247.com}
  // Customers receiving this email may be on any device — must NEVER
  // redirect them to localhost, even if an admin tested locally.
  let stripeCheckoutUrl: string | null = null
  try {
    // tenant.slug needed for the success URL fallback
    const { data: tenantSlug } = await supabase
      .from('tenants').select('slug').eq('id', plan.tenant_id).single()
    const fullOverride = Deno.env.get('BOOKING_BASE_URL')
    const baseDomain = Deno.env.get('BOOKING_BASE_DOMAIN') || 'drive-247.com'
    const bookingOrigin = fullOverride
      ? fullOverride.replace(/\/+$/, '')
      : `https://${tenantSlug?.slug || 'app'}.${baseDomain}`

    const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke('create-checkout-session', {
      body: {
        rentalId: plan.rental_id,
        customerEmail: customer.email,
        customerName: customer.name || 'Customer',
        totalAmount: cumulative,
        tenantId: plan.tenant_id,
        successUrl: `${bookingOrigin}/booking-success?type=invoice&status=paid&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${bookingOrigin}/portal/payments`,
        source: 'reminder-email',
        targetCategories: ['Rental', 'Tax', 'Service Fee'],
        // Stamp installment_id so the Stripe webhook can call
        // installment_settle_invoice on completion. Latest overdue slot is
        // the cumulative-settle target — matches PAYG paygAccrualId pattern.
        installmentId: latest.id,
      },
    })
    if (checkoutError || !checkoutData?.url) {
      throw new Error(checkoutError?.message || 'Failed to create Stripe checkout session')
    }
    stripeCheckoutUrl = checkoutData.url
  } catch (err: any) {
    console.error('[send-installment-reminders] checkout-session error:', err)
    await supabase.from('installment_notifications').insert({
      installment_id: latest.id,
      installment_plan_id: plan.id,
      tenant_id: plan.tenant_id,
      notification_type: 'reminder_sent',
      status: 'failed',
      amount: cumulative,
      message: `Reminder send failed: ${err.message || 'could not create Stripe checkout'}`,
      sent_at: now.toISOString(),
    })
    return 'failed'
  }

  const payUrl = stripeCheckoutUrl

  const html = buildEmailHtml({
    customerName: customer.name || 'there',
    rentalRef: rental?.rental_number || rental?.id || '',
    outstanding: cumulative,
    count: openOverdue.length,
    currency: tenant?.currency_code || null,
    companyName: tenant?.company_name || 'Drive247',
    payUrl,
    reason,
  })

  const subject = `Payment due — ${fmtCurrency(cumulative, tenant?.currency_code || null)} outstanding`

  // Resend (not AWS SES). The shared sendEmail helper handles tenant
  // branding/from-address resolution + falls back to a simulated send when
  // RESEND_API_KEY isn't configured (so tests don't hard-fail). Mirrors the
  // pattern the rest of the codebase uses for tenant-aware customer emails.
  const sendResult = await sendEmail(
    customer.email,
    subject,
    html,
    supabase,
    plan.tenant_id,
  )

  await supabase.from('installment_plans')
    .update({ last_reminder_sent_at: now.toISOString() })
    .eq('id', plan.id)

  await supabase.from('installment_notifications').insert({
    installment_id: latest.id,
    installment_plan_id: plan.id,
    tenant_id: plan.tenant_id,
    notification_type: 'reminder_sent',
    status: sendResult.success ? 'success' : 'failed',
    amount: cumulative,
    message: sendResult.success
      ? `Reminder sent to ${customer.email} — ${openOverdue.length} unpaid (${cumulative.toFixed(2)})`
      : `Reminder send failed: ${sendResult.error || 'unknown error'}`,
    sent_at: now.toISOString(),
  })

  return sendResult.success ? 'sent' : 'failed'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const now = new Date()

  let body: any = null
  try { body = await req.json() } catch { /* GET / cron */ }
  const directPlanId: string | null = body?.planId || null
  const reason: string | null = body?.reason || null

  let sent = 0, skipped = 0, failed = 0

  try {
    if (directPlanId) {
      const { data: plan } = await supabase
        .from('installment_plans')
        .select('id, tenant_id, customer_id, rental_id, last_reminder_sent_at, status')
        .eq('id', directPlanId)
        .single()
      if (plan) {
        const result = await sendForPlan(supabase, plan, false, reason, now)
        if (result === 'sent') sent++
        else if (result === 'skipped') skipped++
        else failed++
      }
    } else {
      const { data: plans } = await supabase
        .from('installment_plans')
        .select('id, tenant_id, customer_id, rental_id, last_reminder_sent_at, status')
        .eq('status', 'active')

      for (const plan of (plans ?? [])) {
        try {
          const result = await sendForPlan(supabase, plan, true, null, now)
          if (result === 'sent') sent++
          else if (result === 'skipped') skipped++
          else failed++
        } catch (loopErr) {
          console.error('reminder loop error:', plan.id, loopErr)
          failed++
        }
      }
    }

    return new Response(JSON.stringify({ success: true, sent, skipped, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('send-installment-reminders fatal:', error)
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
