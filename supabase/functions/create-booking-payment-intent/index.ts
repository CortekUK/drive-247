// create-booking-payment-intent
//
// The embedded-card (Stripe Elements) twin of create-checkout-session. The
// booking site's "Confirm and pay" panel calls it to get a PaymentIntent
// client_secret, renders Stripe's card fields inside the page, and confirms the
// card there. The customer portal's "pay a balance" screen calls it too
// (source: 'customer_portal', with targetCategories / extensionId).
//
// Two actions, one endpoint:
//
//   { rentalId, expectedAmount, ... }          mint (or reuse) a PaymentIntent
//   { action: 'settle', rentalId, paymentIntentId }
//                                               commit a PaymentIntent the card
//                                               form just confirmed
//
// Ported from origin/haseeb/staging/booking-side (2026-11-13, R3 QA). The
// post-payment documents link (booking_document_links + booking-documents-link)
// was added on 2026-11-14 (QA I2): a new booking's response now carries
// documentsToken / documentsUrl.
//
// ── WHICH STRIPE ACCOUNT ───────────────────────────────────────────────────
// Exactly the resolution create-checkout-session uses, so the embedded card and
// the hosted "Email Stripe Link" page always land on the same account:
//   * getChargePlatformAccount(tenant) picks the platform (UK managed / UAE own)
//   * the tenant's stripe_mode picks the key set (test = sandbox, live = real)
//   * getConnectAccountId(tenant) picks the connected account. An Own-Stripe
//     tenant in test mode charges its own sandbox account; in live mode its real
//     connected account (and refuses loudly if none is connected).
// Nothing here is Northwind-specific: flipping a tenant to live mode with a
// connected account is all it takes for real cards to be charged.
//
// ── WHY A SETTLE ACTION ────────────────────────────────────────────────────
// Money only reaches the rental's charges when its payments row moves INTO
// status 'Completed' (trigger auto_fifo_on_payment_completed ->
// payment_apply_fifo_v2). On main, stripe-webhook-{test,live} handle
// payment_intent.succeeded by setting 'Applied' without allocating, and
// recover-pending-stripe-payments only re-reads Checkout Sessions. So the card
// form calls `settle` the moment Stripe says succeeded, and the recovery job has
// a matching PaymentIntent pass for a customer who closes the tab first. Settle
// re-reads the PaymentIntent from Stripe; the browser's word is never taken.
//
// ── LOAD-BEARING DETAILS (from the original) ───────────────────────────────
// 1. setup_future_usage: 'off_session' — deposit holds, installments, PAYG and
//    auto-extension charge this vaulted card later.
// 2. Connect DIRECT charges: the client must build Stripe.js with
//    { stripeAccount: connectAccountId }, so connectAccountId is always returned
//    (null for a platform charge).
// 3. The amount is NEVER taken from the request. See resolveAmountDue.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getConnectAccountId,
  getChargePlatformAccount,
  getStripeClientForAccount,
  getPublishableKeyForAccount,
  type StripeMode,
  type PlatformAccount,
} from '../_shared/stripe-client.ts'
import { getCustomerIdForAccount, setCustomerIdForAccount, CUSTOMER_ACCOUNT_COLUMNS } from '../_shared/customer-account.ts'
import { formatCurrency } from '../_shared/format-utils.ts'
import { buildDocumentsUrl, deriveBookingOrigin } from '../_shared/booking-origin.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, x-tenant-slug',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

/** Same column list create-checkout-session selects, plus payment_provider. */
const TENANT_COLUMNS =
  'id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, ' +
  'payment_model, own_stripe_account_id, own_stripe_test_account_id, security_deposit_enabled, ' +
  'global_deposit_amount, deposit_charge_enabled, payment_provider'

interface TenantRow {
  id: string
  company_name: string
  currency_code: string | null
  stripe_mode: string
  stripe_account_id: string | null
  stripe_onboarding_complete: boolean | null
  payment_model: string | null
  own_stripe_account_id: string | null
  own_stripe_test_account_id: string | null
  security_deposit_enabled: boolean | null
  global_deposit_amount: number | null
  deposit_charge_enabled: boolean | null
  payment_provider: string | null
}

/** PaymentIntent statuses whose client_secret is still usable by the browser. */
const REUSABLE_PI_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
])

/**
 * THE AMOUNT IS COMPUTED HERE, SERVER-SIDE, AND NOWHERE ELSE: the rental's
 * outstanding ledger balance (remaining_amount over its open Charge rows, which
 * rental_charges_trigger writes when the rental is inserted). `expectedAmount`
 * from the client is only an integrity check — off by more than a cent and the
 * request is refused, so the customer is never shown one number and charged
 * another.
 */
async function resolveAmountDue(
  supabase: SupabaseClient,
  rentalId: string,
  targetCategories?: string[] | null,
): Promise<{ amount: number; chargeCount: number }> {
  let query = supabase
    .from('ledger_entries')
    .select('remaining_amount, category')
    .eq('rental_id', rentalId)
    .eq('type', 'Charge')
  if (targetCategories && targetCategories.length > 0) query = query.in('category', targetCategories)
  const { data: charges, error } = await query

  if (error) throw new Error(`Could not read rental charges: ${error.message}`)

  const rows = (charges ?? []).filter((row) => Number(row.remaining_amount ?? 0) > 0)
  const total = rows.reduce((sum, row) => sum + Number(row.remaining_amount ?? 0), 0)
  return { amount: Math.round(total * 100) / 100, chargeCount: rows.length }
}

async function loadTenant(
  supabase: SupabaseClient,
  by: { slug?: string | null; id?: string | null },
): Promise<TenantRow | null> {
  if (by.slug) {
    const { data } = await supabase.from('tenants').select(TENANT_COLUMNS).eq('slug', by.slug).eq('status', 'active').maybeSingle()
    if (data) return data as unknown as TenantRow
  }
  if (by.id) {
    const { data } = await supabase.from('tenants').select(TENANT_COLUMNS).eq('id', by.id).maybeSingle()
    if (data) return data as unknown as TenantRow
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  let body: Record<string, any>
  try {
    body = await req.json()
  } catch {
    return jsonError('The request body must be JSON.', 400)
  }

  try {
    if (body.action === 'settle') return await settle(supabase, body)
    return await mint(supabase, body, req)
  } catch (error) {
    console.error('create-booking-payment-intent failed:', error)
    const message = error instanceof Error ? error.message : String(error)
    return jsonError(message, 400)
  }
})

/* ───────────────────────────────── mint ────────────────────────────────── */

async function mint(supabase: SupabaseClient, body: Record<string, any>, req: Request): Promise<Response> {
  const {
    bookingId,
    rentalId,
    customerEmail,
    customerName,
    customerId,
    expectedAmount,
    tenantSlug,
    tenantId: bodyTenantId,
    bonzahPolicyId,
    targetCategories,
    extensionId,
    source,
    paygAccrualId,
    installmentId,
    placeDepositHoldAfter,
  } = body

  if (!rentalId || typeof rentalId !== 'string') {
    return jsonError('rentalId is required — the amount is computed from the rental, not supplied by the caller.', 400)
  }

  const { data: rentalRow } = await supabase
    .from('rentals')
    .select('id, rental_number, customer_id, vehicle_id, tenant_id, deposit_amount_override, auto_extend_enabled')
    .eq('id', rentalId)
    .maybeSingle()
  if (!rentalRow) return jsonError('Rental not found.', 404)

  // The rental decides the tenant. A caller-supplied slug/id is only accepted
  // when it agrees, so a request can never charge tenant A's rental on tenant
  // B's Stripe account.
  const slug = tenantSlug || req.headers.get('x-tenant-slug')
  const tenant = await loadTenant(supabase, { id: rentalRow.tenant_id })
  if (!tenant) return jsonError('Could not resolve the tenant for this booking.', 400)
  if (bodyTenantId && bodyTenantId !== tenant.id) {
    return jsonError('This rental does not belong to that company.', 403, { code: 'tenant_mismatch' })
  }

  if (tenant.payment_provider === 'square') {
    return jsonError(
      'This company takes payments through Square, not Stripe. Please contact them to pay.',
      409,
      { code: 'provider_not_stripe' },
    )
  }

  const companyName = tenant.company_name || 'Drive 247'
  const currencyCode = (tenant.currency_code || 'USD').toLowerCase()
  const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || 'test'

  // ---- Amount: server-computed, client-checked ----------------------------
  const targets: string[] | null = Array.isArray(targetCategories) && targetCategories.length > 0 ? targetCategories : null
  const { amount: amountDue, chargeCount } = await resolveAmountDue(supabase, rentalId, targets)

  if (chargeCount === 0 || !Number.isFinite(amountDue) || amountDue <= 0) {
    return jsonError(
      'There is nothing left to pay on this booking.',
      409,
      { code: 'nothing_due' },
    )
  }
  if (expectedAmount !== undefined && expectedAmount !== null) {
    const expected = Number(expectedAmount)
    if (!Number.isFinite(expected) || Math.abs(expected - amountDue) > 0.01) {
      return jsonError(
        'The amount shown does not match the amount due for this booking. Refresh the page and try again.',
        409,
        { code: 'amount_mismatch', expectedAmount: expected, amountDue },
      )
    }
  }
  const amountMinorUnits = Math.round(amountDue * 100)

  // ---- Deposit disclosure — same rules as the hosted page -----------------
  let depositHoldAmount = Number(tenant.global_deposit_amount) || 0
  const override = rentalRow.deposit_amount_override
  if (override !== null && override !== undefined) depositHoldAmount = Number(override)
  const { count: extensionsCount } = await supabase
    .from('rental_extensions')
    .select('id', { count: 'exact', head: true })
    .eq('rental_id', rentalId)
  if (rentalRow.auto_extend_enabled || (extensionsCount ?? 0) > 0) depositHoldAmount = 0
  // A new booking holds the deposit on the card it was paid with whenever the
  // tenant takes deposits as a HOLD (QA R9.1). The server decides: the booking
  // page shows "held on your card" from the same settings but never sent
  // `placeDepositHoldAfter`, so no hold was ever placed.
  const isNewBooking = !extensionId && !paygAccrualId && !installmentId && source !== 'portal' && source !== 'customer_portal'
  const holdDeposit = (!!placeDepositHoldAfter || isNewBooking) && !!tenant.security_deposit_enabled
    && tenant.deposit_charge_enabled !== true && depositHoldAmount > 0
  const shouldShowDepositNotice = holdDeposit
  const depositNoticeText = shouldShowDepositNotice
    ? `After payment, a ${formatCurrency(depositHoldAmount, currencyCode.toUpperCase())} security deposit hold (not a charge) will be authorised on the same card. Released when your rental ends.`
    : null

  // ---- Stripe account / mode ---------------------------------------------
  const platformAccount: PlatformAccount = getChargePlatformAccount(tenant)
  const stripe = getStripeClientForAccount(platformAccount, stripeMode)
  const stripeAccountId = getConnectAccountId(tenant)
  const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
  const publishableKey = getPublishableKeyForAccount(platformAccount, stripeMode)
  console.log('Booking PaymentIntent - tenant:', tenant.id, 'mode:', stripeMode, 'platform:', platformAccount, 'account:', stripeAccountId)

  // ---- Stripe Customer (needed to vault the card) -------------------------
  const resolvedCustomerId: string | null = rentalRow.customer_id ?? customerId ?? null
  let stripeCustomerId: string | null = null
  if (resolvedCustomerId) {
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select(CUSTOMER_ACCOUNT_COLUMNS)
      .eq('id', resolvedCustomerId)
      .maybeSingle()
    if (existingCustomer) {
      stripeCustomerId = await getCustomerIdForAccount({
        supabase,
        stripe,
        account: platformAccount,
        stripeAccount: stripeAccountId,
        customerRowId: resolvedCustomerId,
        customer: existingCustomer,
      })
    }
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: customerEmail || undefined,
        name: customerName || undefined,
        metadata: { drive247_customer_id: resolvedCustomerId, tenant_id: tenant.id },
      }, stripeOptions)
      stripeCustomerId = customer.id
      await setCustomerIdForAccount(supabase, resolvedCustomerId, platformAccount, stripeCustomerId)
    }
  }

  // ---- Metadata ------------------------------------------------------------
  const metadata: Record<string, string> = {
    tenant_id: tenant.id,
    rental_id: rentalId,
    stripe_mode: stripeMode,
    // Marks an embedded-card payment: settled by `settle` / the recovery job,
    // not by checkout.session.completed.
    settlement_source: 'payment_intent',
  }
  if (bookingId) metadata.booking_id = String(bookingId)
  if (customerName) metadata.customer_name = String(customerName)
  if (slug) metadata.tenant_slug = String(slug)
  if (resolvedCustomerId) metadata.customer_id = resolvedCustomerId
  if (bonzahPolicyId) metadata.bonzah_policy_id = String(bonzahPolicyId)
  if (source) metadata.source = String(source)
  if (targets) metadata.target_categories = JSON.stringify(targets)
  if (extensionId) metadata.extension_id = String(extensionId)
  if (paygAccrualId) metadata.payg_accrual_id = String(paygAccrualId)
  if (installmentId) metadata.installment_id = String(installmentId)
  if (holdDeposit) metadata.place_deposit_hold = 'true'

  // ---- Durable documents link (QA I2, 2026-11-14) --------------------------
  // The payment screen told customers "we are sending the link to your email"
  // and no link existed. A new booking now gets one booking_document_links row
  // (UNIQUE rental_id, 7 days, slides on use), and the panel routes the customer
  // straight to /booking/documents/<token> after paying. Same shape as the
  // staging build (haseeb/staging/booking-side). The tenant is the RENTAL's
  // (loaded from it above), so a token can never point into another company.
  // Never fails the payment.
  let documentsToken: string | null = null
  let documentsUrl: string | null = null
  if (isNewBooking) {
    try {
      const token = `${crypto.randomUUID()}-${Date.now().toString(36)}`
      const nowIso = new Date().toISOString()
      const ttl = 7 * 24 * 60 * 60 * 1000
      await supabase.from('booking_document_links').upsert(
        { tenant_id: rentalRow.tenant_id, rental_id: rentalId, token, expires_at: new Date(Date.now() + ttl).toISOString(), updated_at: nowIso },
        { onConflict: 'rental_id', ignoreDuplicates: true },
      )
      const { data: link } = await supabase
        .from('booking_document_links')
        .select('token, expires_at')
        .eq('rental_id', rentalId)
        .maybeSingle()
      if (link?.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
        await supabase.from('booking_document_links')
          .update({ expires_at: new Date(Date.now() + ttl).toISOString(), updated_at: nowIso })
          .eq('rental_id', rentalId)
      }
      documentsToken = link?.token ?? null
      documentsUrl = documentsToken ? buildDocumentsUrl(deriveBookingOrigin(slug || tenant.slug || null, req), documentsToken) : null
    } catch (linkErr) {
      console.error('Documents link minting failed, continuing without it:', linkErr)
    }
  }

  const respond = (clientSecret: string | null, paymentIntentId: string, reused: boolean) =>
    jsonOk({
      clientSecret,
      paymentIntentId,
      publishableKey,
      connectAccountId: stripeAccountId,
      rentalId,
      rentalNumber: rentalRow.rental_number ?? null,
      // Major units: the panel formats this as-is on the Pay button.
      amount: amountDue,
      currency: currencyCode,
      companyName,
      depositNotice: depositNoticeText,
      reused,
      documentsToken,
      documentsUrl,
    })

  // ---- Reuse an in-flight PaymentIntent (Back, refresh, declined card) ----
  // A fresh intent per attempt would leave orphaned intents on Stripe and a
  // Pending payments row per attempt.
  const { data: reusableRow } = await supabase
    .from('payments')
    .select('id, stripe_payment_intent_id')
    .eq('rental_id', rentalId)
    .eq('status', 'Pending')
    .not('stripe_payment_intent_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Set when an unpaid attempt is still open but for an outdated amount (staff
  // changed the dates, place or extras after the card form was opened). Its
  // intent is cancelled and THIS row is re-pointed at the new intent, so the
  // customer can never pay the old figure and no second Pending row appears.
  let staleRowId: string | null = null

  if (reusableRow?.stripe_payment_intent_id) {
    try {
      const existing = await stripe.paymentIntents.retrieve(reusableRow.stripe_payment_intent_id, stripeOptions)
      if (REUSABLE_PI_STATUSES.has(existing.status) && existing.amount === amountMinorUnits && existing.client_secret) {
        const refreshed = await stripe.paymentIntents.update(existing.id, { metadata }, stripeOptions)
        console.log('Reusing in-flight PaymentIntent:', refreshed.id, 'for rental', rentalId)
        return respond(refreshed.client_secret, refreshed.id, true)
      }
      if (REUSABLE_PI_STATUSES.has(existing.status) && existing.amount !== amountMinorUnits) {
        await stripe.paymentIntents.cancel(existing.id, undefined, stripeOptions)
        staleRowId = reusableRow.id
        console.log('Cancelled outdated PaymentIntent:', existing.id, `amount ${existing.amount} -> ${amountMinorUnits}`)
      }
      if (existing.status === 'succeeded') {
        // Paid already (e.g. the settle call was lost). Commit it rather than
        // offering the form again.
        await settlePayment(supabase, { rentalId, paymentIntentId: existing.id })
        return jsonError('This booking has already been paid.', 409, { code: 'already_paid' })
      }
      console.log('Existing PaymentIntent not reusable:', existing.id, `status=${existing.status}`, `amount=${existing.amount}`)
    } catch (retrieveError) {
      console.warn('Could not retrieve existing PaymentIntent, creating a new one:', retrieveError)
    }
  }

  // ---- Create the PaymentIntent -------------------------------------------
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountMinorUnits,
    currency: currencyCode,
    automatic_payment_methods: { enabled: true },
    setup_future_usage: 'off_session',
    ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
    ...(customerEmail ? { receipt_email: String(customerEmail) } : {}),
    description: depositNoticeText
      ? `Rental fees — ${companyName}. ${depositNoticeText}`
      : `Rental fees — ${companyName}`,
    metadata,
  }, stripeOptions)
  console.log('PaymentIntent created:', paymentIntent.id, 'amount:', amountMinorUnits, currencyCode)

  // ---- Pre-insert the payments row, correlated on the PI id ---------------
  // It must exist before the customer can confirm: settle and the recovery job
  // both find the payment by stripe_payment_intent_id.
  const isTargetedFlow = !!targets || !!extensionId
  let updated: { id: string }[] | null = null
  if (staleRowId) {
    const { data, error: staleError } = await supabase
      .from('payments')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        platform_account: platformAccount,
        amount: amountDue,
        remaining_amount: amountDue,
        updated_at: new Date().toISOString(),
      })
      .eq('id', staleRowId)
      .eq('status', 'Pending')
      .select('id')
    if (staleError) console.error('Failed to re-point the outdated payment row:', staleError)
    updated = data
  } else if (!isTargetedFlow) {
    const { data, error: updateError } = await supabase
      .from('payments')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        platform_account: platformAccount,
        amount: amountDue,
        remaining_amount: amountDue,
        updated_at: new Date().toISOString(),
      })
      .eq('rental_id', rentalId)
      .is('stripe_payment_intent_id', null)
      .is('stripe_checkout_session_id', null)
      .eq('status', 'Pending')
      .is('target_categories', null)
      .is('extension_id', null)
      .select('id')
    if (updateError) console.error('Failed to update payment with PaymentIntent id:', updateError)
    updated = data
  }

  if (!updated || updated.length === 0) {
    const insertData: Record<string, unknown> = {
      rental_id: rentalId,
      customer_id: rentalRow.customer_id,
      vehicle_id: rentalRow.vehicle_id,
      tenant_id: rentalRow.tenant_id,
      amount: amountDue,
      remaining_amount: amountDue,
      payment_date: new Date().toISOString().split('T')[0],
      method: 'Card',
      payment_type: 'Payment',
      status: 'Pending',
      verification_status: 'pending',
      stripe_payment_intent_id: paymentIntent.id,
      capture_status: 'requires_capture',
      platform_account: platformAccount,
      // payments_booking_source_check allows ONLY ('admin','website').
      booking_source: source === 'portal' ? 'admin' : 'website',
    }
    if (targets) insertData.target_categories = targets
    if (extensionId) insertData.extension_id = extensionId
    const { error: createError } = await supabase.from('payments').insert(insertData)
    if (createError) {
      // Without the row, settle could not find the payment. Cancel the intent
      // so the customer cannot pay money nothing would record.
      console.error('Failed to create payment record, cancelling intent:', createError)
      await stripe.paymentIntents.cancel(paymentIntent.id, undefined, stripeOptions).catch(() => {})
      return jsonError('We could not start this payment. Nothing has been charged — please try again.', 500)
    }
  }

  return respond(paymentIntent.client_secret, paymentIntent.id, false)
}

/* ──────────────────────────────── settle ───────────────────────────────── */

async function settle(supabase: SupabaseClient, body: Record<string, any>): Promise<Response> {
  const { rentalId, paymentIntentId } = body
  if (typeof rentalId !== 'string' || typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_')) {
    return jsonError('rentalId and paymentIntentId are required.', 400)
  }
  const result = await settlePayment(supabase, { rentalId, paymentIntentId })
  return jsonOk(result as unknown as Record<string, unknown>)
}

type SettleResult =
  | { settled: true; transitioned: boolean; paymentId: string }
  | { settled: false; reason: string; stripeStatus?: string }

/**
 * Commit a confirmed PaymentIntent: re-read it from Stripe, and only if it
 * really succeeded for THIS rental, move the payments row Pending -> Completed
 * (the FIFO trigger allocates it to the charges), mark the rental paid when
 * nothing is left, and send the customer the "booking received" email once.
 * Idempotent: a second call finds the row already settled and does nothing.
 * Exported in spirit to recover-pending-stripe-payments, which calls this
 * endpoint with the same body.
 */
async function settlePayment(
  supabase: SupabaseClient,
  { rentalId, paymentIntentId }: { rentalId: string; paymentIntentId: string },
): Promise<SettleResult> {
  const { data: row } = await supabase
    .from('payments')
    .select('id, rental_id, tenant_id, customer_id, status, capture_status, amount, platform_account, booking_source')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()
  if (!row || row.rental_id !== rentalId) return { settled: false, reason: 'payment_not_found' }

  const tenant = await loadTenant(supabase, { id: row.tenant_id })
  if (!tenant) return { settled: false, reason: 'tenant_not_found' }
  const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || 'test'
  // Resolve the client from the PLATFORM THE ROW WAS CREATED ON, like the
  // recovery job, so a tenant switching payment model mid-flight still settles.
  const platformAccount: PlatformAccount = (row.platform_account as PlatformAccount) || getChargePlatformAccount(tenant)
  const stripe = getStripeClientForAccount(platformAccount, stripeMode)
  const connectAccountId = getConnectAccountId({ ...tenant, payment_model: platformAccount === 'uae' ? 'own' : 'managed' })
  const opts = connectAccountId ? { stripeAccount: connectAccountId } : undefined

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId, opts)
  if (pi.metadata?.rental_id !== rentalId) return { settled: false, reason: 'rental_mismatch' }
  // Only intents minted by this function. Deposit holds, saved-card charges and
  // hosted-checkout intents have their own settlement and must not be touched.
  if (pi.metadata?.settlement_source !== 'payment_intent') return { settled: false, reason: 'not_an_embedded_payment' }
  if (pi.status !== 'succeeded') return { settled: false, reason: 'not_succeeded', stripeStatus: pi.status }
  if (Math.round(Number(row.amount) * 100) !== pi.amount_received) {
    console.warn(`[settle] amount differs for ${row.id}: row ${row.amount} vs Stripe ${pi.amount_received / 100}`)
  }

  const nowIso = new Date().toISOString()
  let transitioned = false
  if (row.status === 'Pending') {
    const { data: moved } = await supabase
      .from('payments')
      .update({ status: 'Completed', capture_status: 'captured', paid_at: nowIso, updated_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'Pending')
      .select('id')
    transitioned = !!moved && moved.length > 0
  } else if (row.capture_status === 'requires_capture') {
    // The webhook may have flipped the status first; make sure the money counts
    // as captured so the allocation below does not skip it.
    await supabase.from('payments').update({ capture_status: 'captured', updated_at: nowIso }).eq('id', row.id)
  }

  // Idempotent: allocates whatever is still unallocated (covers a row the
  // webhook marked 'Applied' without allocating).
  const { error: fifoError } = await supabase.rpc('payment_apply_fifo_v2', { p_id: row.id })
  if (fifoError) console.error('[settle] payment_apply_fifo_v2 failed:', fifoError)

  if (transitioned) {
    const { data: open } = await supabase
      .from('ledger_entries')
      .select('remaining_amount')
      .eq('rental_id', rentalId)
      .eq('type', 'Charge')
    const stillOwed = (open ?? []).reduce((n, r) => n + Number(r.remaining_amount ?? 0), 0)
    if (stillOwed <= 0.005) {
      await supabase.from('rentals').update({ payment_status: 'fulfilled', updated_at: nowIso }).eq('id', rentalId)
    }

    // A new booking made on the booking site gets the same "booking received"
    // email the hosted-checkout path sends. Balance payments from the customer
    // portal and operator-initiated ones do not.
    const source = pi.metadata?.source
    if (row.booking_source === 'website' && source !== 'customer_portal' && source !== 'portal' && !pi.metadata?.extension_id) {
      await sendBookingReceived(supabase, rentalId, row.id, pi.amount_received / 100)
    }
  }

  // The deposit hold, on the card just saved by this payment (QA R9.1).
  // place-deposit-hold is idempotent and refuses when deposits are charged,
  // switched off or $0, so a repeat call or a changed setting is harmless.
  if (transitioned && pi.metadata?.place_deposit_hold === 'true') {
    try {
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/place-deposit-hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ rentalId }),
      })
      if (!res.ok) console.error('[settle] place-deposit-hold failed:', res.status, await res.text())
    } catch (err) {
      console.error('[settle] could not place the deposit hold:', err)
    }
  }

  return { settled: true, transitioned, paymentId: row.id }
}

async function sendBookingReceived(supabase: SupabaseClient, rentalId: string, paymentId: string, amount: number) {
  try {
    const { data: r } = await supabase
      .from('rentals')
      .select('id, start_date, end_date, monthly_amount, tenant_id, customer:customers(id, name, email, phone), vehicle:vehicles(id, make, model, reg)')
      .eq('id', rentalId)
      .single()
    const customer = (r as any)?.customer
    const vehicle = (r as any)?.vehicle
    if (!r || !customer || !vehicle) return
    const vehicleName = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.reg
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-booking-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({
        paymentId,
        rentalId,
        tenantId: r.tenant_id,
        customerId: customer.id,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        vehicleName,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        vehicleReg: vehicle.reg,
        pickupDate: fmt(r.start_date),
        returnDate: fmt(r.end_date),
        amount,
        bookingRef: rentalId.substring(0, 8).toUpperCase(),
        paymentMode: 'auto',
      }),
    })
    if (!res.ok) console.error('[settle] notify-booking-pending failed:', res.status, await res.text())
  } catch (err) {
    console.error('[settle] could not send the booking-received email:', err)
  }
}

function jsonOk(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...(extra ?? {}) }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}
