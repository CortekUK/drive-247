// Given a Stripe Checkout Session ID created by create-hold-checkout, retrieve
// its PaymentIntent and persist the hold metadata on the rental. Idempotent —
// safe to call multiple times; bails if a hold is already recorded.
//
// Input:  { sessionId, rentalId? }
// Output: { success, status, amount } or { skipped: reason }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getConnectAccountId,
  getChargePlatformAccount,
  getStripeClientForAccount,
  getStripeOptions,
  resolveHoldExpiryDetailed,
  type StripeMode,
} from '../_shared/stripe-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { sessionId, rentalId: rentalIdInput } = await req.json()
    if (!sessionId) return errorResponse('sessionId is required', 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // We don't know the tenant yet — first try to resolve rental via input
    // rentalId, otherwise fall back to the Stripe session metadata. That
    // requires us to try each tenant's Stripe mode; to keep it simple, derive
    // the tenant from the rental row.
    let rentalId = rentalIdInput as string | undefined
    if (!rentalId) {
      // Fall back: search payments table for a matching session id (unlikely
      // for hold-only sessions; we write payments only for captured money).
      return errorResponse('rentalId is required for hold sync', 400)
    }

    const { data: rental, error: rentalError } = await supabase
      .from('rentals')
      // deposit_hold_attempt_seq is read for the deposit_hold_links ledger row
      // written below — it is the chain link every ledger row is keyed on.
      .select('id, tenant_id, customer_id, deposit_hold_status, deposit_hold_payment_intent_id, deposit_hold_attempt_seq, platform_account')
      .eq('id', rentalId)
      .single()
    if (rentalError || !rental) return errorResponse('Rental not found', 404)

    if (rental.deposit_hold_status === 'held' && rental.deposit_hold_payment_intent_id) {
      return jsonResponse({ skipped: 'hold_already_held' })
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code')
      .eq('id', rental.tenant_id)
      .single()

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || 'test'
    // The hold-checkout session was created by create-hold-checkout on the
    // tenant's CURRENT charge platform, so resolve the same way here.
    const platformAccount = getChargePlatformAccount(tenant ?? {})
    const stripe = getStripeClientForAccount(platformAccount, stripeMode)
    const connectAccountId = getConnectAccountId(tenant as any)
    const stripeOptions = getStripeOptions(connectAccountId)

    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ['payment_intent', 'payment_intent.latest_charge'] },
      stripeOptions
    )

    const pi = session.payment_intent as any
    if (!pi || typeof pi === 'string') {
      return errorResponse('Session has no expanded PaymentIntent', 422)
    }
    if (pi.status !== 'requires_capture') {
      return errorResponse(`Hold not active (PI status: ${pi.status})`, 422)
    }

    // ── Session binding ──────────────────────────────────────────────────────
    // This function takes a Checkout session id and a rentalId from the caller
    // and writes hold state onto that rental. It cannot require a staff session:
    // the booking app's success page reaches it for GUEST renters, so the
    // Supabase gateway's verify_jwt is satisfied by the public anon key and
    // proves nothing. What DOES bind the two is Stripe's own record —
    // create-hold-checkout stamps metadata.rental_id on both the session and
    // the PaymentIntent — so the caller must not be able to point a session it
    // owns at a rental it does not.
    //
    // Calibrated deliberately: a MISMATCH is positive evidence of the wrong
    // rental and is refused. An ABSENT rental_id is no evidence either way
    // (a pre-metadata legacy session), and refusing there would strand a real
    // authorisation with no way to record it — so that case is logged loudly
    // and allowed through, which is the same posture the anchoring guard below
    // takes when it cannot prove a move is safe.
    const sessionRentalId =
      (session.metadata?.rental_id as string | undefined) ??
      (pi.metadata?.rental_id as string | undefined) ??
      null
    if (sessionRentalId && sessionRentalId !== rentalId) {
      console.error(
        `sync-deposit-hold: SESSION/RENTAL MISMATCH — session ${sessionId} is stamped for rental ` +
          `${sessionRentalId} but was submitted against rental ${rentalId}. Refusing.`
      )
      return errorResponse('This checkout session does not belong to the requested rental', 403)
    }
    if (!sessionRentalId) {
      console.warn(
        `sync-deposit-hold: session ${sessionId} carries no rental_id metadata; ` +
          `cannot bind it to rental ${rentalId}. Proceeding (legacy session) — verify manually.`
      )
    }

    const amount = (pi.amount || 0) / 100
    const pmId =
      typeof pi.payment_method === 'string'
        ? pi.payment_method
        : pi.payment_method?.id || null
    const stripeCustomerId =
      typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null

    // Read the REAL expiry from Stripe (capture_before) rather than assuming 31 days.
    const expiry = await resolveHoldExpiryDetailed(stripe, pi, stripeOptions)

    // ANCHORING. This hold lives on `platformAccount` / `connectAccountId` /
    // `stripeMode` / `pi.currency`, and every later capture, release and refresh
    // must use exactly those — never the tenant's row as it reads that day.
    const holdCurrency = String(pi.currency || tenant?.currency_code || 'usd').toLowerCase()
    const nowIso = new Date().toISOString()

    const update: Record<string, unknown> = {
      deposit_hold_payment_intent_id: pi.id,
      deposit_hold_status: 'held',
      deposit_hold_status_changed_at: nowIso,
      deposit_hold_amount: amount,
      deposit_hold_placed_at: nowIso,
      deposit_hold_expires_at: expiry.expiresAt,
      deposit_hold_expiry_source: expiry.source,
      deposit_hold_extended_auth: expiry.extendedAuth,
      deposit_hold_window_seconds: expiry.windowSeconds,
      deposit_hold_payment_method_id: pmId,
      deposit_hold_stripe_customer_id: stripeCustomerId,
      // Hold-scoped anchor columns. These, not rentals.platform_account, are
      // what refresh/reconcile prefer — so recording them here means a hold
      // synced from Checkout is resolvable even when the rental-level anchor is
      // ambiguous (see below).
      deposit_hold_connect_account_id: connectAccountId,
      deposit_hold_stripe_mode: stripeMode,
      deposit_hold_currency: holdCurrency,
    }

    // rentals.platform_account is the rental's MONEY ANCHOR: capture, release,
    // refresh and refund all resolve their Stripe keys from it. This function
    // used to overwrite it unconditionally from the tenant's CURRENT payment
    // model, on a path reached by a browser redirect after Checkout success.
    // So a rental whose payments were taken on 'uk' could be re-stamped 'uae'
    // by a customer landing on a success URL mid-migration, after which every
    // later operation on those payments targeted the wrong Stripe account.
    //
    // The column is NOT NULL DEFAULT 'uk', so "don't overwrite non-null" cannot
    // be taken literally — a fresh rental for a UAE tenant also reads 'uk'.
    // What makes the value load-bearing is money already anchored to it. So:
    // stamp it only when no payment row is anchored to the current value.
    if (rental.platform_account !== platformAccount) {
      const { count: anchoredPayments, error: anchorCountError } = await supabase
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('rental_id', rental.id)
        .eq('platform_account', rental.platform_account)

      if (anchorCountError) {
        // Could not prove the anchor is safe to move — so don't move it.
        console.error(
          `sync-deposit-hold: could not check anchored payments for rental ${rental.id}; ` +
            `leaving platform_account='${rental.platform_account}' alone:`,
          anchorCountError
        )
      } else if ((anchoredPayments ?? 0) > 0) {
        console.error(
          `sync-deposit-hold: PLATFORM DIVERGENCE on rental ${rental.id} — ` +
            `${anchoredPayments} payment(s) anchored to '${rental.platform_account}' but this ` +
            `hold was placed on '${platformAccount}'. Keeping the existing anchor; the hold is ` +
            `resolvable via deposit_hold_connect_account_id/deposit_hold_stripe_mode.`
        )
      } else {
        // Nothing is anchored to the old value — it is the column default, not
        // a record of where money lives. Safe to record where this hold sits.
        update.platform_account = platformAccount
      }
    }

    // -----------------------------------------------------------------------
    // deposit_hold_links — the authorization ledger.
    //
    // Checkout created a REAL authorisation on the renter's card before this
    // function ever ran, and nothing here used to write it down. To
    // reconcile-deposit-holds' orphan sweep — and to any dispute-evidence
    // packet — that is a live PaymentIntent with nothing in the product
    // pointing at it, i.e. indistinguishable from an orphan (spec invariant I1).
    //
    // Written AFTER the rental write, never before, and never with
    // outcome:'pending'. The reconciler CANCELS stale pending links, and a
    // pending row on this path would point at the hold the renter has just
    // given us — an audit row must not be able to kill live cover.
    //
    // GENUINELY best-effort: supabase-js RESOLVES with `{ error }` on a
    // Postgres error but REJECTS on a transport failure, so both are swallowed.
    // An audit write must never turn a recorded hold into a 500, which the
    // browser would answer by re-running the sync.
    //
    // UPSERT on (rental_id, attempt_seq, action) because the success URL is a
    // browser redirect: the renter can reload it, and a second sync of the same
    // Checkout session must refresh this row rather than error. Every mutable
    // column is defaulted so one upsert fully replaces the previous
    // observation. created_at is never written, so it keeps the first sync's
    // timestamp while completed_at tracks the most recent.
    const attemptSeq = Number((rental as any).deposit_hold_attempt_seq ?? 0)
    const recordSyncLink = async (fields: Record<string, unknown>) => {
      try {
        const { error } = await supabase.from('deposit_hold_links').upsert(
          {
            rental_id: rental.id,
            tenant_id: rental.tenant_id,
            attempt_seq: attemptSeq,
            action: 'sync',
            payment_intent_id: pi.id,
            // Where the hold ACTUALLY lives — the platform create-hold-checkout
            // charged on, NOT rentals.platform_account, which the anchoring
            // guard above deliberately leaves pointing elsewhere whenever
            // payments are already anchored to the old value. This is the only
            // record of the hold's true platform, and reconcile's
            // resolveLinkContext prefers link.platform_account over the
            // rental's — so writing it here is what makes a diverged hold
            // resolvable at all.
            platform_account: platformAccount,
            connect_account_id: connectAccountId,
            stripe_mode: stripeMode,
            amount_cents: typeof pi.amount === 'number' ? pi.amount : null,
            currency: holdCurrency,
            // Only Stripe's own deadline is persisted. resolveHoldExpiryDetailed
            // layers a moving `now + fallback` floor on top when the network
            // published nothing; recording that would be inventing a deadline.
            capture_before: expiry.source === 'stripe_capture_before' ? expiry.expiresAt : null,
            extended_auth_status: expiry.extendedAuthStatus ?? null,
            actor: 'checkout_sync',
            completed_at: new Date().toISOString(),
            // Mutable set — replaced wholesale by each call site.
            superseded_pi_id: null,
            estimate_inputs: null,
            outcome: null,
            error_code: null,
            error_message: null,
            ...fields,
          },
          { onConflict: 'rental_id,attempt_seq,action' }
        )
        if (error) {
          console.error('sync-deposit-hold: failed to write deposit_hold_links row (continuing):', error)
        }
      } catch (linkErr) {
        console.error('sync-deposit-hold: deposit_hold_links upsert threw (continuing):', linkErr)
      }
    }

    // Persist hold details on the rental. Also backfill customer.stripe_customer_id
    // if the customer didn't have one yet (Checkout creates/links one).
    const { error: updateError } = await supabase
      .from('rentals')
      .update(update)
      .eq('id', rental.id)
    if (updateError) {
      // The authorisation is LIVE at Stripe but the rental does not know about
      // it — the one case where this hold is genuinely unreachable from the
      // product. Record it as 'orphaned' so it is discoverable by the operator
      // and by a dispute packet. 'orphaned' is inert to both reconciler sweeps
      // (they act on outcome='pending'), so this is a breadcrumb, not an
      // instruction to cancel anything.
      await recordSyncLink({
        outcome: 'orphaned',
        error_code: 'rental_write_failed',
        error_message:
          `Hold authorised at Stripe (${pi.id}) but the rental write failed: ${updateError.message}`.slice(0, 500),
        estimate_inputs: { checkout_session_id: sessionId },
      })
      return errorResponse(`Failed to persist hold: ${updateError.message}`, 500)
    }

    await recordSyncLink({
      outcome: 'succeeded',
      estimate_inputs: {
        checkout_session_id: sessionId,
        source: 'checkout_success_redirect',
        prior_hold_status: rental.deposit_hold_status ?? null,
        // Records whether this sync moved the rental's money anchor. The guard
        // above decides; without this the decision is only ever visible in logs.
        anchored_platform_account: update.platform_account ?? rental.platform_account ?? null,
        platform_account_restamped: update.platform_account !== undefined,
      },
    })

    if (stripeCustomerId) {
      // Overwrite unconditionally (not just when NULL): a stored id that
      // differs from the one Stripe just used is stale — e.g. minted in a
      // different mode/account era — and keeping it would strand the row on a
      // dead id (Kedic incident) while orphaning a fresh Checkout-created
      // customer on every subsequent hold. NOTE: no .neq() filter here — in
      // Postgres NULL != x is NULL, so .neq would skip the backfill-when-NULL
      // case; an unconditional idempotent write covers both.
      await supabase
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', rental.customer_id)
    }

    return jsonResponse({
      success: true,
      status: 'held',
      amount,
      paymentIntentId: pi.id,
    })
  } catch (err) {
    console.error('sync-deposit-hold error:', err)
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(message, 500)
  }
})
