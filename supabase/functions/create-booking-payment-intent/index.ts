// create-booking-payment-intent
//
// The Elements twin of create-checkout-session. Same auth, same CORS, same
// tenant resolution, same metadata — but it mints a PaymentIntent and hands back
// a client_secret instead of redirecting the customer to Stripe's hosted page,
// so the card fields can be rendered inside our own booking page.
//
// THREE THINGS HERE ARE LOAD-BEARING AND EASY TO BREAK
//
// 1. setup_future_usage: 'off_session'. The booking payment itself does not need
//    a vaulted card — everything that happens AFTER it does. Deposit holds,
//    scheduled installments, PAYG accruals and auto-extension renewals all charge
//    that saved card later. Drop this and those flows fail off-session, weeks
//    after anyone would connect the two.
//
// 2. These are Connect DIRECT charges. The client_secret is minted ON the
//    connected account, so it can only be confirmed by a Stripe.js instance
//    constructed as loadStripe(publishableKey, { stripeAccount }). That is why
//    connectAccountId is in the response and why it must not be dropped by the
//    caller. apps/booking/src/config/stripe.ts omits the option and is NOT a
//    template for this.
//
// 3. The amount is NEVER taken from the request. See resolveAmountDue below.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
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
import { deriveBookingOrigin, buildDocumentsUrl } from '../_shared/booking-origin.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, x-tenant-slug',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

/** Same column list create-checkout-session selects, plus payment_provider. */
const TENANT_COLUMNS =
  'id, company_name, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, ' +
  'payment_model, own_stripe_account_id, own_stripe_test_account_id, security_deposit_enabled, ' +
  'global_deposit_amount, deposit_charge_enabled, payment_provider'

interface TenantRow {
  id: string
  // company_name and stripe_mode are NOT NULL in the schema (stripe_mode
  // defaults to 'test'), which is what lets this row be handed straight to
  // getConnectAccountId without a widening cast.
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

/**
 * How long the emailed documents link stays usable.
 *
 * SEVEN days, not thirty — an explicit product decision. The link is a bearer
 * credential for a paid booking, so the window is the exposure; seven days
 * still comfortably covers a customer who books on a Friday and deals with it
 * the following weekend. booking-documents-link slides this window forward on
 * every visit and can re-send an expired one, so the ceiling is "seven days of
 * silence", not "seven days from payment".
 *
 * Kept in step with DOCUMENTS_LINK_TTL_MS in booking-documents-link/index.ts.
 */
const DOCUMENTS_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** PaymentIntent statuses whose client_secret is still usable by the browser. */
const REUSABLE_PI_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
])

/**
 * THE AMOUNT IS COMPUTED HERE, SERVER-SIDE, AND NOWHERE ELSE.
 *
 * create-checkout-session takes `totalAmount` straight off the request body.
 * That is survivable there only because the hosted page shows the customer what
 * they are about to pay; it is still a client-controlled figure, and this
 * endpoint deliberately does not repeat it. A browser posting
 * `{ rentalId, totalAmount: 1 }` would otherwise capture $1 and get the rental
 * flipped to payment_status='fulfilled' by the webhook.
 *
 * The server's own figure is the rental's OUTSTANDING ledger balance: the sum of
 * `remaining_amount` over its open `type='Charge'` entries. Those rows are
 * written by the `rental_charges_trigger` AFTER INSERT trigger on `rentals`
 * (-> generate_rental_charges), so they exist before any payment is attempted.
 * Using `remaining_amount` rather than `amount` means a partially paid rental is
 * asked for the remainder and a retry after an abandoned PaymentIntent does not
 * double-charge.
 *
 * `expectedAmount` from the client is treated as an INTEGRITY CHECK, never as
 * the amount: if it is sent and disagrees with the server figure by more than a
 * cent, the request is refused so the customer never sees one number and is
 * charged another. If it is omitted, the server figure is used silently.
 */
async function resolveAmountDue(
  supabase: SupabaseClient,
  rentalId: string,
): Promise<{ amount: number; chargeCount: number }> {
  const { data: charges, error } = await supabase
    .from('ledger_entries')
    .select('remaining_amount')
    .eq('rental_id', rentalId)
    .eq('type', 'Charge')

  if (error) throw new Error(`Could not read rental charges: ${error.message}`)

  const rows = charges ?? []
  const total = rows.reduce((sum, row) => sum + Number(row.remaining_amount ?? 0), 0)
  // Round to cents once, here, so the comparison below and the Stripe amount can
  // never disagree by a floating-point tail.
  return { amount: Math.round(total * 100) / 100, chargeCount: rows.length }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
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
    } = await req.json()

    const slug = tenantSlug || req.headers.get('x-tenant-slug')

    // Unlike create-checkout-session there is no bookingId fallback for the
    // reference: the amount must come from a rental's ledger, so a rental id is
    // mandatory. bookingId is still carried into metadata for parity.
    if (!rentalId || typeof rentalId !== 'string') {
      return jsonError('rentalId is required — the amount is computed from the rental, not supplied by the caller.', 400)
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ---- Tenant resolution — mirrors create-checkout-session --------------
    let tenantId: string | null = bodyTenantId || null
    let companyName = 'Drive 917'
    let currencyCode = 'gbp'
    let stripeMode: StripeMode = 'test' // Default to test mode for safety
    let tenantData: TenantRow | null = null
    let depositHoldAmount = 0
    let securityDepositEnabled = false
    let depositChargeEnabled = false

    const adoptTenant = (tenant: TenantRow) => {
      tenantId = tenant.id ?? tenantId
      companyName = tenant.company_name || companyName
      currencyCode = (tenant.currency_code || 'USD').toLowerCase()
      stripeMode = (tenant.stripe_mode as StripeMode) || 'test'
      tenantData = tenant
      securityDepositEnabled = !!tenant.security_deposit_enabled
      depositChargeEnabled = tenant.deposit_charge_enabled === true
      depositHoldAmount = Number(tenant.global_deposit_amount) || 0
    }

    if (slug) {
      const { data: tenant } = await supabaseClient
        .from('tenants')
        .select(TENANT_COLUMNS)
        .eq('slug', slug)
        .eq('status', 'active')
        .single()
      if (tenant) {
        adoptTenant(tenant as unknown as TenantRow)
        console.log('Tenant loaded from slug:', tenantId, 'mode:', stripeMode)
      }
    } else if (tenantId) {
      const { data: tenant } = await supabaseClient
        .from('tenants')
        .select(TENANT_COLUMNS)
        .eq('id', tenantId)
        .eq('status', 'active')
        .single()
      if (tenant) {
        adoptTenant(tenant as unknown as TenantRow)
        console.log('Tenant loaded from ID:', tenantId, 'mode:', stripeMode)
      }
    }

    if (!tenantData) {
      // Fallback: get tenant from the rental.
      const { data: rentalTenant } = await supabaseClient
        .from('rentals')
        .select('tenant_id')
        .eq('id', rentalId)
        .single()
      if (rentalTenant?.tenant_id) {
        const { data: tenant } = await supabaseClient
          .from('tenants')
          .select(TENANT_COLUMNS)
          .eq('id', rentalTenant.tenant_id)
          .single()
        if (tenant) {
          adoptTenant(tenant as unknown as TenantRow)
          console.log('Tenant loaded from rental:', tenantId, 'mode:', stripeMode)
        }
      }
    }

    if (!tenantData || !tenantId) {
      return jsonError('Could not resolve the tenant for this booking.', 400)
    }
    const tenant: TenantRow = tenantData

    // ---- Provider guard ---------------------------------------------------
    // create-checkout-session dispatches Square tenants to their own rail. This
    // endpoint is Stripe-only by construction: a Stripe client_secret cannot be
    // confirmed by Square's SDK, and Square cannot vault a card for the deposit/
    // installment/PAYG charges this flow's setup_future_usage exists to enable.
    // Refuse loudly rather than charge a Square tenant's customer on Stripe.
    if (tenant.payment_provider === 'square') {
      return jsonError(
        'This tenant takes payments through Square. Use the Square checkout flow (create-checkout-session) instead of embedded Stripe Elements.',
        409,
        { code: 'provider_not_stripe' },
      )
    }

    // ---- Amount: server-computed, client-checked --------------------------
    const { amount: amountDue, chargeCount } = await resolveAmountDue(supabaseClient, rentalId)

    if (chargeCount === 0) {
      // PAYG rentals deliberately generate no charges up front (the trigger
      // returns early and accrue-payg-charges bills daily), so this is also the
      // guard that stops a PAYG booking taking a bogus full payment here.
      return jsonError(
        'This rental has no outstanding charges to pay. Pay-as-you-go rentals are billed as they accrue, not up front.',
        409,
        { code: 'no_open_charges' },
      )
    }
    if (!Number.isFinite(amountDue) || amountDue <= 0) {
      return jsonError(
        `Cannot create a payment for an amount of ${amountDue}. This rental's charges are already settled.`,
        409,
        { code: 'nothing_due' },
      )
    }
    if (expectedAmount !== undefined && expectedAmount !== null) {
      const expected = Number(expectedAmount)
      if (!Number.isFinite(expected) || Math.abs(expected - amountDue) > 0.01) {
        // The customer is looking at a number. Refuse rather than charge a
        // different one, and hand back both so the caller can re-render.
        return jsonError(
          'The amount shown does not match the amount due for this rental. Refresh the booking and try again.',
          409,
          { code: 'amount_mismatch', expectedAmount: expected, amountDue },
        )
      }
    }
    const amountMinorUnits = Math.round(amountDue * 100)

    // ---- Deposit disclosure — same rules as the hosted page ---------------
    const { data: rentalRow } = await supabaseClient
      .from('rentals')
      .select('id, rental_number, customer_id, tenant_id, deposit_amount_override, auto_extend_enabled')
      .eq('id', rentalId)
      .single()

    if (!rentalRow) {
      return jsonError('Rental not found.', 404)
    }

    const override = rentalRow.deposit_amount_override
    if (override !== null && override !== undefined) {
      depositHoldAmount = Number(override)
      console.log('Deposit amount override applied:', depositHoldAmount, 'for rental', rentalId)
    }
    const { count: extensionsCount } = await supabaseClient
      .from('rental_extensions')
      .select('id', { count: 'exact', head: true })
      .eq('rental_id', rentalId)
    if (rentalRow.auto_extend_enabled || (extensionsCount ?? 0) > 0) {
      // Long-running rentals carry NO deposit — this wins over any override.
      depositHoldAmount = 0
    }

    const shouldShowDepositNotice = !!placeDepositHoldAfter && securityDepositEnabled
      && !depositChargeEnabled && depositHoldAmount > 0
    const depositNoticeText = shouldShowDepositNotice
      ? `After payment, a ${formatCurrency(depositHoldAmount, currencyCode.toUpperCase())} security deposit hold (not a charge) will be authorised on the same card. Released when your rental ends.`
      : null

    // ---- Customer resolution ----------------------------------------------
    let resolvedCustomerId: string | null = customerId ?? null
    if (!resolvedCustomerId) resolvedCustomerId = rentalRow.customer_id ?? null

    // ---- Durable documents link -------------------------------------------
    // Minted HERE, before the card is confirmed, for one reason: the browser and
    // the Stripe webhook must be able to name the SAME link without talking to
    // each other. The browser gets it in this response so it can route the
    // customer straight to the upload screen; booking-settlement reads the same
    // row out of the table when it enqueues the "upload your documents" email.
    // UNIQUE(rental_id) on booking_document_links plus `ignoreDuplicates` is
    // what makes those two agree — a second call (a refresh, a retry after a
    // declined card, the reusable-intent branch below) inserts nothing and the
    // read-back returns the ORIGINAL token, not the one we just generated.
    // Always use the read-back value; the generated one loses the race.
    //
    // Portal-initiated payments are deliberately excluded. `source: 'portal'`
    // is an operator taking a payment and `source: 'customer_portal'` is an
    // existing customer clearing an outstanding balance
    // (v2/apps/web/src/lib/stripe/create-balance-payment-intent.ts:237) — neither
    // is a new booking, and handing either a documentsToken would make the
    // payment panel tell someone paying a fuel charge to upload a licence.
    //
    // AND the rental must actually belong to the tenant we resolved. `tenantId`
    // can come from a caller-supplied `tenantSlug`/`tenantId` while `rentalId`
    // is a separate caller-supplied field, and nothing above cross-checks them.
    // The documents token is a BEARER credential for the rental, so issuing one
    // under a tenant the rental does not belong to would hand tenant A a live
    // link into tenant B's booking. Skipping the mint is safe: the token is
    // optional to the payment, and booking-settlement mints/reads its own row.
    const isPortalInitiated = source === 'portal' || source === 'customer_portal'
    const rentalTenantId = (rentalRow as { tenant_id?: string | null }).tenant_id ?? null
    const tenantMatchesRental = !!rentalTenantId && rentalTenantId === tenantId
    if (!isPortalInitiated && !tenantMatchesRental) {
      console.error(
        'Refusing to mint a documents link: rental tenant',
        rentalTenantId,
        'does not match resolved tenant',
        tenantId,
      )
    }
    let documentsToken: string | null = null
    let documentsUrl: string | null = null
    if (!isPortalInitiated && tenantMatchesRental) {
      try {
        // Same shape as generateQRToken in create-ai-verification-session/index.ts:35-39.
        const token = `${crypto.randomUUID()}-${Date.now().toString(36)}`
        const nowIso = new Date().toISOString()
        const { error: linkError } = await supabaseClient
          .from('booking_document_links')
          .upsert(
            {
              // The RENTAL's tenant, never the resolved-from-slug one. They are
              // guaranteed equal by the guard above; taking it from the rental
              // means the row cannot be mis-attributed even if that guard is
              // ever relaxed.
              tenant_id: rentalTenantId,
              rental_id: rentalId,
              token,
              expires_at: new Date(Date.now() + DOCUMENTS_LINK_TTL_MS).toISOString(),
              // No trigger maintains updated_at on this table, so writers set it.
              updated_at: nowIso,
            },
            { onConflict: 'rental_id', ignoreDuplicates: true },
          )
        if (linkError) console.error('Could not mint booking documents link:', linkError)

        const { data: link } = await supabaseClient
          .from('booking_document_links')
          .select('token, expires_at')
          .eq('rental_id', rentalId)
          .maybeSingle()

        // A row that already existed keeps its old expiry, because
        // ON CONFLICT DO NOTHING updates nothing. That is wrong for a booking
        // abandoned and then paid for days later: the token we are about to put
        // in the email would already be dead on arrival. Sliding it here costs
        // one write in a rare path and removes a guaranteed dead link.
        if (link?.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
          await supabaseClient
            .from('booking_document_links')
            .update({
              expires_at: new Date(Date.now() + DOCUMENTS_LINK_TTL_MS).toISOString(),
              updated_at: nowIso,
            })
            .eq('rental_id', rentalId)
        }

        documentsToken = link?.token ?? null
        documentsUrl = documentsToken
          ? buildDocumentsUrl(deriveBookingOrigin(slug, req), documentsToken)
          : null
      } catch (linkErr) {
        // Never fail a payment because the follow-up link could not be written.
        // The customer can still pay; booking-settlement logs the missing row
        // and the operator can see the booking sitting at documents_status
        // 'pending' via the (tenant_id, documents_status) index.
        console.error('Documents link minting threw, continuing without it:', linkErr)
      }
    }

    // ---- Stripe account / mode -------------------------------------------
    const platformAccount: PlatformAccount = getChargePlatformAccount(tenant)
    const stripe = getStripeClientForAccount(platformAccount, stripeMode)
    const stripeAccountId = getConnectAccountId(tenant)
    const stripeOptions = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined

    console.log('Booking PaymentIntent - tenantId:', tenantId, 'mode:', stripeMode, 'connectAccount:', stripeAccountId)

    // ---- Stripe Customer (needed to vault the card) ------------------------
    let stripeCustomerId: string | null = null
    if (resolvedCustomerId) {
      const { data: existingCustomer } = await supabaseClient
        .from('customers')
        .select(CUSTOMER_ACCOUNT_COLUMNS)
        .eq('id', resolvedCustomerId)
        .single()

      if (existingCustomer) {
        stripeCustomerId = await getCustomerIdForAccount({
          supabase: supabaseClient,
          stripe,
          account: platformAccount,
          stripeAccount: stripeAccountId,
          customerRowId: resolvedCustomerId,
          customer: existingCustomer,
        })
        if (stripeCustomerId) console.log('Using existing Stripe customer:', stripeCustomerId)
      }

      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: customerEmail,
          name: customerName,
          metadata: { drive247_customer_id: resolvedCustomerId, tenant_id: tenantId || '' },
        }, stripeOptions)
        stripeCustomerId = customer.id
        console.log('Created new Stripe customer:', stripeCustomerId)
        await setCustomerIdForAccount(supabaseClient, resolvedCustomerId, platformAccount, stripeCustomerId)
      }
    }

    // ---- Metadata — the FULL create-checkout-session block ----------------
    // The webhook reads settlement decisions out of this. Anything missing here
    // is a settlement step that silently will not happen.
    const metadata: Record<string, string> = {
      tenant_id: tenantId,
      rental_id: rentalId,
      stripe_mode: stripeMode,
      // Tells stripe-webhook-{test,live} that THIS PaymentIntent is an embedded
      // booking payment and must be settled by the payment_intent.succeeded
      // entry point. PaymentIntents created behind a hosted Checkout Session do
      // NOT carry it, so their payment_intent.succeeded keeps its old, narrow
      // behaviour and settlement stays owned by checkout.session.completed.
      // Without this discriminator every hosted booking would settle twice, and
      // on the delivery that arrived first would insert a duplicate payments row.
      settlement_source: 'payment_intent',
    }
    if (bookingId) metadata.booking_id = String(bookingId)
    if (customerName) metadata.customer_name = String(customerName)
    if (slug) metadata.tenant_slug = String(slug)
    if (resolvedCustomerId) metadata.customer_id = resolvedCustomerId
    if (bonzahPolicyId) metadata.bonzah_policy_id = String(bonzahPolicyId)
    if (source) metadata.source = String(source)
    if (targetCategories && targetCategories.length > 0) metadata.target_categories = JSON.stringify(targetCategories)
    if (extensionId) metadata.extension_id = String(extensionId)
    if (paygAccrualId) metadata.payg_accrual_id = String(paygAccrualId)
    if (installmentId) metadata.installment_id = String(installmentId)
    // Stripe metadata values are always strings.
    if (placeDepositHoldAfter) metadata.place_deposit_hold = 'true'

    // ---- Reuse an in-flight PaymentIntent where we can --------------------
    // Mounting Elements is not a one-shot action: the customer can navigate back
    // to the form, refresh, or retry a declined card. Minting a fresh
    // PaymentIntent each time would leave orphaned intents on Stripe and — worse
    // — a fresh Pending payments row each time, so the webhook would settle one
    // and strand the rest.
    const { data: reusableRow } = await supabaseClient
      .from('payments')
      .select('id, stripe_payment_intent_id')
      .eq('rental_id', rentalId)
      .eq('status', 'Pending')
      .not('stripe_payment_intent_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (reusableRow?.stripe_payment_intent_id) {
      try {
        const existing = await stripe.paymentIntents.retrieve(reusableRow.stripe_payment_intent_id, stripeOptions)
        if (REUSABLE_PI_STATUSES.has(existing.status) && existing.amount === amountMinorUnits && existing.client_secret) {
          // Refresh the metadata in case the caller changed a flag (e.g. added a
          // Bonzah policy) between attempts, then hand back the same secret.
          const refreshed = await stripe.paymentIntents.update(existing.id, { metadata }, stripeOptions)
          console.log('Reusing in-flight PaymentIntent:', refreshed.id, 'for rental', rentalId)
          return jsonOk({
            clientSecret: refreshed.client_secret,
            paymentIntentId: refreshed.id,
            publishableKey: getPublishableKeyForAccount(platformAccount, stripeMode),
            connectAccountId: stripeAccountId,
            rentalId,
            rentalNumber: rentalRow.rental_number ?? null,
            amount: amountDue,
            currency: currencyCode,
            companyName,
            depositNotice: depositNoticeText,
            reused: true,
            // Additive. The reusable branch returns the SAME token as the mint
            // branch because the read-back above is keyed on rental_id.
            documentsToken,
            documentsUrl,
          })
        }
        console.log('Existing PaymentIntent not reusable:', existing.id, `status=${existing.status}`, `amount=${existing.amount}`)
      } catch (retrieveError) {
        // A PI minted on the other platform account (mid-migration) 404s here.
        // Fall through and mint a fresh one rather than fail the booking.
        console.warn('Could not retrieve existing PaymentIntent, creating a new one:', retrieveError)
      }
    }

    // ---- Create the PaymentIntent -----------------------------------------
    if (stripeAccountId) {
      console.log(`Creating PaymentIntent on connected account (${stripeMode} mode):`, stripeAccountId)
    } else {
      console.log(`Creating PaymentIntent on platform account (${stripeMode} mode)`)
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountMinorUnits,
      currency: currencyCode,
      automatic_payment_methods: { enabled: true },
      // LOAD-BEARING — see the header. Deposit holds, installments, PAYG and
      // auto-extension all charge this vaulted card off-session later.
      setup_future_usage: 'off_session',
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      ...(customerEmail ? { receipt_email: String(customerEmail) } : {}),
      description: depositNoticeText
        ? `Rental fees — ${companyName}. ${depositNoticeText}`
        : `Rental fees — ${companyName}`,
      metadata,
    }, stripeOptions)

    console.log('PaymentIntent created:', paymentIntent.id, 'amount:', amountMinorUnits, currencyCode)

    // ---- Pre-insert the payments row, correlated on the PI id -------------
    // Same update-then-insert shape as create-checkout-session, with
    // stripe_payment_intent_id where it used stripe_checkout_session_id. The row
    // must exist before the customer can confirm: the webhook correlates on it,
    // and a customer who pays instantly would otherwise hit a webhook with no row
    // to match, producing a second row from the fallback insert path.
    const isTargetedFlow = !!(targetCategories && targetCategories.length > 0) || !!extensionId

    const updateData: Record<string, unknown> = {
      stripe_payment_intent_id: paymentIntent.id,
      platform_account: platformAccount,
      updated_at: new Date().toISOString(),
    }
    if (targetCategories && targetCategories.length > 0) updateData.target_categories = targetCategories
    if (extensionId) updateData.extension_id = extensionId

    let updatedPayment: { id: string }[] | null = null
    if (!isTargetedFlow) {
      const { data, error: updateError } = await supabaseClient
        .from('payments')
        .update(updateData)
        .eq('rental_id', rentalId)
        .is('stripe_payment_intent_id', null)
        .is('stripe_checkout_session_id', null)
        .eq('status', 'Pending')
        .is('target_categories', null)
        .is('extension_id', null)
        .select('id')
      if (updateError) console.error('Failed to update payment with PaymentIntent id:', updateError)
      updatedPayment = data
    } else {
      console.log('Targeted/extension flow — skipping payment UPDATE, will INSERT a dedicated row',
        targetCategories ? `(categories: ${targetCategories.join(', ')})` : '',
        extensionId ? `(extension: ${extensionId})` : '')
    }

    if (updatedPayment && updatedPayment.length > 0) {
      console.log('Updated existing payment with PaymentIntent id:', updatedPayment[0].id, 'pi:', paymentIntent.id)
    } else {
      const { data: rentalForPayment } = await supabaseClient
        .from('rentals')
        .select('customer_id, vehicle_id, tenant_id')
        .eq('id', rentalId)
        .single()

      if (rentalForPayment) {
        const insertData: Record<string, unknown> = {
          rental_id: rentalId,
          customer_id: rentalForPayment.customer_id,
          vehicle_id: rentalForPayment.vehicle_id,
          tenant_id: rentalForPayment.tenant_id || tenantId,
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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        if (targetCategories && targetCategories.length > 0) insertData.target_categories = targetCategories
        if (extensionId) insertData.extension_id = extensionId

        const { data: createdPayment, error: createError } = await supabaseClient
          .from('payments')
          .insert(insertData)
          .select('id')
          .single()

        if (createError) {
          // Without a correlatable row the webhook's fallback would still create
          // one, but the caller deserves to know the pre-insert failed.
          console.error('Failed to create payment record:', createError)
        } else {
          console.log('Created new payment with PaymentIntent id:', createdPayment.id, 'pi:', paymentIntent.id)
        }
      }
    }

    return jsonOk({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      // The publishable key for the SAME platform account the secret was minted
      // on. Pair it with connectAccountId:
      //   loadStripe(publishableKey, { stripeAccount: connectAccountId })
      publishableKey: getPublishableKeyForAccount(platformAccount, stripeMode),
      connectAccountId: stripeAccountId,
      rentalId,
      rentalNumber: rentalRow.rental_number ?? null,
      amount: amountDue,
      currency: currencyCode,
      companyName,
      depositNotice: depositNoticeText,
      reused: false,
      // Additive — existing callers that ignore these are unaffected. Null on a
      // portal-initiated payment, and null if the link could not be written.
      documentsToken,
      documentsUrl,
    })
  } catch (error) {
    console.error('Error creating booking PaymentIntent:', error)
    const message = error instanceof Error ? error.message : String(error)
    return jsonError(message, 400)
  }
})

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
