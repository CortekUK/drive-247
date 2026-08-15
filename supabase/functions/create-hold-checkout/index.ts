// Creates a Stripe Checkout Session that authorises the tenant's security
// deposit amount WITHOUT capturing it (manual capture mode). Used by admins to
// (a) place a hold via a new Checkout tab or (b) email the payment link to the
// customer — both cases end up with the same auth-only PaymentIntent on the
// same saved card.
//
// Input:  { rentalId, successUrl?, cancelUrl? }
// Output: { url, sessionId, amount } or { skipped: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getConnectAccountId,
  getChargePlatformAccount,
  getStripeClientForAccount,
  getStripeClientForRecord,
  getStripeOptions,
  DEPOSIT_HOLD_CARD_VARIANTS,
  isCardFeatureIneligibleError,
  type StripeMode,
} from '../_shared/stripe-client.ts'
import { getCustomerIdForAccount, CUSTOMER_ACCOUNT_COLUMNS } from '../_shared/customer-account.ts'
import {
  resolveDepositAmount,
  DEPOSIT_AMOUNT_TENANT_COLUMNS,
} from '../_shared/deposit-amount.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { authorizeDepositHoldRequest } from '../_shared/deposit-hold-auth.ts'

// Stripe PaymentIntent status -> the deposit_hold_status that is conclusively
// true when we see it. Only these three mean the authorisation is DEAD and the
// row may be re-collected; requires_capture means it is alive, and everything
// else (requires_action, requires_confirmation, processing) is still in motion
// and must be treated as alive so we never authorise the same card twice.
//
// Duplicated in place-deposit-hold — _shared/stripe-client.ts is owned by the
// deposit-hold refactor and this pair of guards must ship without touching it.
const DEAD_PI_STATUS_TO_HOLD_STATUS: Record<string, string> = {
  canceled: 'expired',
  succeeded: 'captured',
  requires_payment_method: 'failed',
}

/**
 * Is the hold recorded on this rental STILL alive at Stripe?
 *
 * rentals.deposit_hold_status is written when a hold is placed and then never
 * revisited: card authorisations expire on their own (~5-7 days by default) and
 * Stripe cancels the PaymentIntent, but every webhook looks PaymentIntents up
 * by payments.stripe_payment_intent_id, never by
 * rentals.deposit_hold_payment_intent_id. So the row keeps saying 'held' on a
 * dead auth forever, and the operator is told "A deposit hold is already active
 * on this rental." with no way forward (GMT, Aug 2026).
 *
 * FAIL SAFE, NOT OPEN: any doubt — Stripe unreachable, an id Stripe has never
 * heard of, a PI still mid-authorisation — returns `alive: true` so we keep
 * today's conservative skip rather than risk double-authorising a customer.
 */
async function probeRecordedHold(
  stripe: ReturnType<typeof getStripeClientForRecord>,
  paymentIntentId: string,
  stripeOptions: { stripeAccount?: string } | undefined
): Promise<{ alive: boolean; deadStatus: string | null }> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions)
    const deadStatus = DEAD_PI_STATUS_TO_HOLD_STATUS[String(intent.status)] ?? null
    if (deadStatus) return { alive: false, deadStatus }
    return { alive: true, deadStatus: null }
  } catch (err) {
    console.warn('create-hold-checkout: could not verify existing hold at Stripe, treating as active:', err)
    return { alive: true, deadStatus: null }
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { rentalId, successUrl, cancelUrl } = await req.json()
    if (!rentalId) return errorResponse('rentalId is required', 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // ── Auth ──────────────────────────────────────────────────────────────
    // This mints a Stripe Checkout session on the TENANT'S connected account
    // that authorises their configured deposit, and returns a live payment URL
    // plus the tenant's company name and deposit figure. It read no
    // Authorization header, so the only check was the gateway's
    // `verify_jwt = true` default — satisfied by the PUBLIC ANON KEY that ships
    // in the booking app's JavaScript bundle. Any session on the project could
    // mint sessions against any tenant's Stripe account and read back their
    // deposit configuration.
    //
    // Runs before the rental read and before any Stripe call. `successUrl` /
    // `cancelUrl` are caller-supplied and land in a Stripe redirect, which is a
    // further reason this must not be anonymous. Every caller in the repo is
    // portal staff (components/shared/dialogs/add-hold-dialog.tsx — "Add Hold",
    // both the new-tab and email-the-link buttons). No machine caller exists.
    const auth = await authorizeDepositHoldRequest(req, supabase, {
      rentalId,
      logPrefix: 'create-hold-checkout',
    })
    if (!auth.ok) return errorResponse(auth.message, auth.status)

    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      .select('id, tenant_id, customer_id, vehicle_id, deposit_hold_status, deposit_hold_payment_intent_id, deposit_amount_override, auto_extend_enabled, platform_account')
      .eq('id', rentalId)
      .single()
    if (rentalError || !rental) return errorResponse('Rental not found', 404)

    // AUTO-EXTEND rentals never carry a deposit (renewal pricing replaces it).
    // Manually-extended rentals are allowed: this function is only reached from
    // the portal's Add Hold dialog — a deliberate staff action — so the RevTek/
    // Fabri auto-retry concern does not apply here (GMT incident, Jul 2026).
    if ((rental as any).auto_extend_enabled) {
      return jsonResponse({ skipped: 'auto_extend_rental' })
    }

    // Fetched before the 'held' guard below because that guard now has to ask
    // Stripe whether the recorded hold is real, and that needs the tenant's
    // Stripe config.
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select(`stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code, company_name, ${DEPOSIT_AMOUNT_TENANT_COLUMNS}`)
      .eq('id', rental.tenant_id)
      .single()
    if (tenantError || !tenant) return errorResponse('Tenant not found', 404)

    if (rental.deposit_hold_status === 'held') {
      // 'held' in the DB is NOT proof of a live authorisation — see
      // probeRecordedHold above. Ask Stripe before slamming the door: an
      // expired auth used to leave operators permanently unable to place a new
      // hold ("I cannot refresh the hold", GMT, Aug 2026).
      //
      // The PI we probe is the one every write below is anchored to. Anchoring
      // on status alone is unsafe: refresh-deposit-holds CANCELS the old PI and
      // then re-writes the row as 'held' carrying a BRAND NEW live PI, so a
      // status-only guard would happily mark that live hold dead and we would
      // open a second authorisation on the customer's card.
      const probedPiId = (rental.deposit_hold_payment_intent_id as string | null) || null
      let alive = true
      let deadStatus: string | null = null
      try {
        if (!probedPiId) {
          // No PaymentIntent recorded at all, so nothing can be alive — the
          // status is a leftover, not an authorisation. Let the operator place
          // a hold.
          alive = false
        } else {
          const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || 'test'
          // Record-anchored: the existing hold lives on the platform account it
          // was CREATED on, which may differ from where a NEW hold would go if
          // the tenant has since flipped payment model.
          const holdStripe = getStripeClientForRecord(rental as any, stripeMode)
          const holdOptions = getStripeOptions(
            getConnectAccountId({
              ...(tenant as any),
              payment_model: (rental as any).platform_account === 'uae' ? 'own' : 'managed',
            })
          )
          const probe = await probeRecordedHold(holdStripe, probedPiId, holdOptions)
          alive = probe.alive
          deadStatus = probe.deadStatus
        }
      } catch (probeErr) {
        // getConnectAccountId throws for a live 'own' tenant with no connected
        // account. Keep the old behaviour rather than inventing a new 500 on a
        // path that used to return a clean skip.
        console.warn('create-hold-checkout: hold liveness probe unavailable, treating as active:', probeErr)
        alive = true
      }

      if (alive) {
        return jsonResponse({ skipped: 'hold_already_active' })
      }

      // Correct the record so the portal badge stops claiming money is held.
      // deadStatus === null here means the row said 'held' with NO PaymentIntent
      // behind it — a leftover, so the honest value is NULL (never placed).
      // Without this write the badge would keep claiming a hold after the
      // operator abandons Stripe Checkout.
      let healQuery = supabase
        .from('rentals')
        .update({ deposit_hold_status: deadStatus })
        .eq('id', rentalId)
        // Anchored to the exact row we probed: same status AND same PI (or the
        // same absence of one). If either moved, this is no longer our row.
        .eq('deposit_hold_status', 'held')
      healQuery = probedPiId
        ? healQuery.eq('deposit_hold_payment_intent_id', probedPiId)
        : healQuery.is('deposit_hold_payment_intent_id', null)
      const { data: healed, error: healError } = await healQuery.select('id')

      if (healError) {
        // Match place-deposit-hold: you cannot safely open a SECOND hold when
        // you could not record that the first one died.
        console.error('create-hold-checkout: failed to correct stale hold status:', healError)
        return errorResponse(`Failed to correct stale deposit hold status: ${healError.message}`, 500)
      }
      if (!healed || healed.length === 0) {
        // Somebody else moved the row (most likely the refresh cron replacing
        // the PI). Our conclusion is about a PI that is no longer the rental's
        // hold, so fall back to today's conservative answer.
        console.warn(`create-hold-checkout: rental ${rentalId} changed under the hold probe; leaving it alone`)
        return jsonResponse({ skipped: 'hold_already_active' })
      }
      console.warn(
        `create-hold-checkout: stale hold on rental ${rentalId} corrected held -> ${deadStatus ?? 'null'}; placing a fresh hold`
      )
      // ...and fall through to create the checkout session for a new hold.
    }

    if (!tenant.security_deposit_enabled) {
      return jsonResponse({ skipped: 'deposit_disabled_for_tenant' })
    }
    // Shared with place-deposit-hold (_shared/deposit-amount.ts): per-rental
    // override → per-vehicle deposit for a scoped per_vehicle tenant → tenant
    // global. This function used to stop at "override else global", ignoring
    // deposit_mode entirely, so the portal's Add Hold button under-held every
    // GMT vehicle priced above the tenant global while the automatic path held
    // the correct amount for the same rental.
    const deposit = await resolveDepositAmount(supabase, {
      tenantId: rental.tenant_id,
      tenant: tenant as any,
      rental: rental as any,
    })
    const depositAmount = deposit.amount
    if (depositAmount <= 0) {
      return jsonResponse({ skipped: 'deposit_amount_is_zero' })
    }
    console.log(
      `create-hold-checkout: rental ${rentalId} deposit ${depositAmount} (source: ${deposit.source})`
    )

    const { data: customer } = await supabase
      .from('customers')
      .select(`email, name, ${CUSTOMER_ACCOUNT_COLUMNS}`)
      .eq('id', rental.customer_id)
      .single()

    const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || 'test'
    const holdPlatformAccount = getChargePlatformAccount(tenant as any)
    const stripe = getStripeClientForAccount(holdPlatformAccount, stripeMode)
    const holdConnectAccountId = getConnectAccountId(tenant as any)
    const stripeOptions = getStripeOptions(holdConnectAccountId)

    const currency = (tenant.currency_code || 'usd').toLowerCase()
    const origin = req.headers.get('origin') || ''

    const sessionParams: any = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `Security Deposit Hold — ${tenant.company_name || 'Rental'}`,
              description: `Authorisation only. This amount is held on your card and will be released when the rental ends.`,
            },
            unit_amount: Math.round(depositAmount * 100),
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        // KEY: authorise only, do NOT capture. Admin captures or releases later.
        capture_method: 'manual',
        // Save the card so subsequent holds / rollovers can reuse the PM.
        setup_future_usage: 'off_session',
        metadata: {
          type: 'security_deposit_hold',
          rental_id: rentalId,
          tenant_id: rental.tenant_id,
          customer_id: rental.customer_id,
          // "Why was THIS amount authorised?" answered months later, when the
          // tenant/vehicle figures have moved on.
          deposit_source: deposit.source,
        },
      },
      metadata: {
        type: 'security_deposit_hold',
        rental_id: rentalId,
        tenant_id: rental.tenant_id,
      },
      success_url: successUrl || `${origin}/rentals/${rentalId}?hold=placed&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${origin}/rentals/${rentalId}?hold=cancelled`,
    }

    // Per-account customer id (validated live), self-healing from the legacy
    // shared id. On a miss, fall back to customer_email — the hold flow has no
    // mint step; sync-deposit-hold backfills the fresh id after checkout.
    const validHoldCustomerId = customer
      ? await getCustomerIdForAccount({
          supabase,
          stripe,
          account: holdPlatformAccount,
          stripeAccount: holdConnectAccountId,
          customerRowId: rental.customer_id,
          customer,
        })
      : null
    if (validHoldCustomerId) {
      sessionParams.customer = validHoldCustomerId
    } else if (customer?.email) {
      sessionParams.customer_email = customer.email
    }

    // Ask the card network to extend the hold lifetime (up to ~30 days) and
    // allow multicapture. Without extended authorization the hold dies at the
    // ~7-day default — exactly what silently killed GMT's holds before.
    //
    // "if_available" is *supposed* to be ignored where unsupported, but Connect
    // accounts not approved for these features actually 500 with "This account
    // is not eligible for the requested card features." (GMT's live account,
    // acct_1SrIFEPcUIaEGCY0, does this). place-deposit-hold already handles this;
    // create-hold-checkout (used by the portal "Add Hold" button) did not, so the
    // manual hold button broke for those accounts.
    //
    // Graduated fallback: try both features → keep extended_authorization only
    // (preserves the 30-day hold GMT relies on for long rentals) → drop both.
    let session: any = null
    let lastErr: unknown = null
    for (let i = 0; i < DEPOSIT_HOLD_CARD_VARIANTS.length; i++) {
      const card = DEPOSIT_HOLD_CARD_VARIANTS[i]
      const params = card
        ? { ...sessionParams, payment_method_options: { card } }
        : sessionParams
      try {
        session = await stripe.checkout.sessions.create(params, stripeOptions)
        if (i > 0) {
          console.warn(
            `create-hold-checkout: card features downgraded to variant ${i} for tenant ${rental.tenant_id} (account not eligible for full set)`
          )
        }
        break
      } catch (err) {
        if (isCardFeatureIneligibleError(err) && i < DEPOSIT_HOLD_CARD_VARIANTS.length - 1) {
          lastErr = err
          continue
        }
        throw err
      }
    }
    if (!session) throw lastErr ?? new Error('Failed to create hold checkout session')

    return jsonResponse({
      url: session.url,
      sessionId: session.id,
      amount: depositAmount,
    })
  } catch (err) {
    console.error('create-hold-checkout error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(message, 500)
  }
})
