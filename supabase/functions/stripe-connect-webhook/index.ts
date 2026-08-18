import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { getConnectWebhookSecretCandidates } from '../_shared/stripe-client.ts'

// Use live key since Connect accounts are created in live mode
const stripe = new Stripe(Deno.env.get('STRIPE_LIVE_SECRET_KEY') || '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  try {
    const body = await req.text()
    const signature = req.headers.get('stripe-signature')

    let event: Stripe.Event

    // Verify webhook signature if a secret is configured. During the UAE
    // migration this endpoint may be registered on BOTH platform accounts
    // (legacy + UAE), so try each candidate secret until one verifies.
    const secretCandidates = getConnectWebhookSecretCandidates()
    if (secretCandidates.length > 0 && signature) {
      let verified = false
      let lastErr: any = null
      for (const secret of secretCandidates) {
        try {
          // MUST be constructEventAsync. The synchronous constructEvent() throws
          // "SubtleCryptoProvider cannot be used in a synchronous context" on Deno,
          // because WebCrypto there is async-only. It threw for EVERY candidate
          // secret, so verification always fell through to HTTP 400 and Stripe read
          // it as a hard failure — 84 consecutive failures and a pending
          // auto-disable notice. Nothing to do with which secret is configured.
          event = await stripe.webhooks.constructEventAsync(body, signature, secret)
          verified = true
          break
        } catch (err) {
          lastErr = err
        }
      }
      if (!verified) {
        console.error('Webhook signature verification failed with all secrets:', lastErr?.message)
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }
    } else {
      // FAIL CLOSED — see the matching comment in stripe-webhook-live. Omitting
      // the stripe-signature header short-circuited the AND above and landed
      // here, where the raw body was trusted as a genuine Stripe event.
      // Confirmed exploitable against production before this change: a forged
      // account.application.deauthorized nulls own_stripe_account_id and reverts
      // payment_model to 'managed' — a denial-of-payments primitive.
      const missingSignature = !signature
      console.error(
        `Rejected unverified webhook: ${missingSignature ? 'missing stripe-signature header' : 'no Connect webhook secret configured'}`
      )
      return new Response(
        JSON.stringify({ error: missingSignature ? 'Missing stripe-signature header' : 'Webhook not configured' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: missingSignature ? 400 : 500,
        }
      )
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('Received Stripe Connect webhook:', event.type)

    // Handle different event types
    switch (event.type) {
      case 'account.updated': {
        const account = event.data.object as Stripe.Account

        // Determine account status
        let status = 'pending'
        let onboardingComplete = false

        if (account.charges_enabled && account.payouts_enabled) {
          status = 'active'
          onboardingComplete = true
        } else if (account.requirements?.disabled_reason) {
          status = 'restricted'
        } else if (account.requirements?.currently_due?.length === 0) {
          status = 'active'
          onboardingComplete = true
        }

        // Update tenant in database — LEGACY Express/managed accounts.
        const { error: updateError } = await supabaseClient
          .from('tenants')
          .update({
            stripe_account_status: status,
            stripe_onboarding_complete: onboardingComplete,
          })
          .eq('stripe_account_id', account.id)

        if (updateError) {
          console.error('Error updating tenant Stripe status:', updateError)
        } else {
          console.log(`Updated tenant with Stripe account ${account.id}: status=${status}, onboarding=${onboardingComplete}`)
        }

        // ── OWN Stripe accounts (OAuth-connected Standard) ──────────────────
        //
        // This handler only ever matched `stripe_account_id`. An OAuth-connected
        // account lives in `own_stripe_account_id`, so for every tenant on the
        // Own model NO account.updated event has ever been applied — their
        // status columns describe the OLD managed account and never change.
        //
        // That is why, on 17 Aug 2026, Global Motion's portal reported Stripe
        // "connected, onboarding complete" while Stripe had the new account
        // paused and the tenant collected nothing for two days.
        const { data: ownTenants } = await supabaseClient
          .from('tenants')
          .select('id, payment_model, stripe_mode, own_stripe_account_id')
          .eq('own_stripe_account_id', account.id)

        for (const t of ownTenants ?? []) {
          const patch: Record<string, unknown> = {}

          // NEVER write `stripe_account_status` / `stripe_onboarding_complete`
          // from here for a tenant that is not yet routing through this account.
          //
          // Those two columns describe the LEGACY Express account, and
          // `stripe_onboarding_complete` is not a display flag — it is a routing
          // decision. getConnectAccountId (_shared/stripe-client.ts) reads it on
          // the managed path:
          //
          //     if (stripe_mode === 'live' && stripe_onboarding_complete)
          //         return tenant.stripe_account_id
          //     return null   // ← "no routing - payment goes to platform"
          //
          // A tenant mid-migration still charges on their working legacy account
          // while the new one finishes onboarding. Stamping this account's
          // (false) onboarding state onto them would send that `null` into
          // getStripeOptions, dropping `stripeAccount` from the call — so the
          // Checkout Session is created on the Drive247 PLATFORM balance. The
          // customer pays successfully, the operator receives nothing, and
          // nothing throws. That is silent, and strictly worse than the 17 Aug
          // outage, which at least failed loudly.
          //
          // It would also blind the detector: sync-connect-status selects its
          // sweep with .eq('stripe_onboarding_complete', true), so writing false
          // drops the tenant out of the daily health check that exists to catch
          // exactly this.
          // COMPLETE A DEFERRED SWITCH.
          //
          // stripe-oauth-callback stores the account but deliberately does NOT
          // move a tenant's live money onto it until Stripe says charges are
          // enabled. This is where that promise is kept: the moment the operator
          // finishes onboarding, routing follows automatically and they do not
          // have to come back and reconnect.
          //
          // Gate on "not yet fully switched", NOT on `payment_model !== 'own'`.
          // Tenants are born on payment_model='own' + stripe_mode='test' and only
          // connect a real account at go-live; for them the old gate was
          // permanently false, so once they DID connect, their switch could never
          // complete and they would have kept trading on the SHARED TEST Connect
          // account. (13 such tenants have no account connected yet and so are
          // not matched here at all; the gate matters from the moment they are.)
          //
          // AMBIGUOUS OWNERSHIP.
          //
          // `own_stripe_account_id` carries no unique index, and this loop runs
          // over every tenant matching the id. `test` and `delta-force` both hold
          // acct_1SqMDfB2eFJBbbzi today, so one account.updated would flip BOTH
          // to live on an account at most one of them owns — and `test` is not
          // idle (242 vehicles, live rentals, a public booking site).
          //
          // The old gate hid this by never firing for payment_model='own' at all.
          // Widening it exposed it, so it has to be closed here: if we cannot say
          // whose account this is, we must not route anyone's live money onto it.
          // The hold has to be TOTAL — see the health block below for why.
          const ambiguousOwner = (ownTenants?.length ?? 0) > 1
          const fullySwitched = t.payment_model === 'own' && t.stripe_mode === 'live'
          if (account.charges_enabled && !fullySwitched && ambiguousOwner) {
            console.warn(
              `[connect-webhook] ${account.id} is claimed by ${ownTenants!.length} tenants ` +
              `(${ownTenants!.map((x: { id: string }) => x.id).join(', ')}) — NOT completing any switch. ` +
              `Resolve the duplicate before this account can route live money.`
            )
          }
          if (account.charges_enabled && !fullySwitched && !ambiguousOwner) {
            patch.payment_model = 'own'
            patch.stripe_mode = 'live'
            console.log(`[connect-webhook] ${account.id}: charges enabled — completing deferred switch for tenant ${t.id}`)
          }

          // ── ACCOUNT HEALTH — deliberately AFTER the flip decision ───────────
          //
          // `stripe_charges_enabled` is not a diagnostic column. subscription-
          // webhook's resolveGoLive reads it as the FIRST disjunct of its
          // readiness test:
          //
          //     const connectReady =
          //       tenant.stripe_charges_enabled === true ||
          //       (!!own_stripe_account_id && stripe_onboarding_complete === true)
          //     if (connectReady) patch.stripe_mode = "live"
          //
          // So writing it true is itself a routing decision, taken by a
          // different function on a later event.
          //
          // The first version of this block sat ABOVE the flip and was gated on
          // payment_model === 'own' alone. That let the ambiguous pair through a
          // side door: the flip was correctly held, but the health write still
          // landed on BOTH duplicates, and the next subscription event then set
          // stripe_mode='live' on both — reaching the exact outcome the guard
          // exists to prevent, one webhook later. Neither has setup_completed_at
          // or bonzah_username, so resolveGoLive never short-circuits and that
          // door stays open indefinitely.
          //
          // Gate on the tenant ACTUALLY routing through this account: already
          // live on it, or being switched onto it by this same event. An
          // own+test tenant that is not switching gets nothing written, so under
          // ambiguousOwner the patch stays empty and neither row is touched.
          const routingHere =
            t.payment_model === 'own' && (t.stripe_mode === 'live' || patch.stripe_mode === 'live')
          if (routingHere) {
            patch.stripe_charges_enabled = account.charges_enabled ?? null
            patch.stripe_payouts_enabled = account.payouts_enabled ?? null
            patch.stripe_account_disabled_reason = account.requirements?.disabled_reason ?? null
            patch.stripe_requirements_due = Array.isArray(account.requirements?.currently_due)
              ? account.requirements.currently_due
              : []
            patch.stripe_status_synced_at = new Date().toISOString()
          }

          // Nothing to say about this tenant (deferred, still not chargeable).
          // Skip the write entirely rather than issuing an empty UPDATE.
          if (Object.keys(patch).length === 0) {
            console.log(
              `[connect-webhook] own account ${account.id} tenant ${t.id}: no change ` +
              `(charges_enabled=${account.charges_enabled}, still deferred)`
            )
            continue
          }

          const { error: ownErr } = await supabaseClient
            .from('tenants')
            .update(patch)
            .eq('id', t.id)

          if (ownErr) {
            console.error(`[connect-webhook] Failed updating own-Stripe tenant ${t.id}:`, ownErr)
          } else {
            // Log the keys actually written — `status`/`onboardingComplete` are
            // deliberately NOT among them for own accounts, and printing them
            // here would send the next person debugging this down a false trail.
            console.log(
              `[connect-webhook] own account ${account.id} tenant ${t.id}: ` +
              `wrote [${Object.keys(patch).join(', ')}] ` +
              `charges_enabled=${account.charges_enabled} ` +
              `disabled_reason=${account.requirements?.disabled_reason ?? 'none'}`
            )
          }
        }
        break
      }

      case 'account.application.deauthorized': {
        // Tenant disconnected their account
        const account = event.data.object as Stripe.Account

        // Own Stripe (OAuth-connected Standard account on the UAE platform):
        // if the deauthorized id matches a tenant's own account, clear ONLY the
        // matching own_stripe_* column + its connected_at. Legacy Express
        // fields are handled by the separate path below and never touched here.
        const { data: ownLiveTenants } = await supabaseClient
          .from('tenants')
          .select('id')
          .eq('own_stripe_account_id', account.id)
        if (ownLiveTenants && ownLiveTenants.length > 0) {
          // Clear the id AND revert payment_model to 'managed'. Leaving a
          // tenant on 'own' with no connected account would make every new
          // live charge throw (the getConnectAccountId backstop) — a hard
          // outage. Reverting restores a working charge path (legacy Express)
          // until the operator reconnects; this needs human follow-up.
          const { error: ownLiveError } = await supabaseClient
            .from('tenants')
            .update({
              own_stripe_account_id: null,
              own_stripe_connected_at: null,
              payment_model: 'managed',
            })
            .eq('own_stripe_account_id', account.id)
          if (ownLiveError) {
            console.error('Error clearing own_stripe_account_id on deauthorize:', ownLiveError)
          } else {
            console.warn(`Own Stripe LIVE account ${account.id} deauthorized — cleared + reverted tenant(s) to managed. MANUAL FOLLOW-UP NEEDED.`)
          }
          break
        }

        const { data: ownTestTenants } = await supabaseClient
          .from('tenants')
          .select('id')
          .eq('own_stripe_test_account_id', account.id)
        if (ownTestTenants && ownTestTenants.length > 0) {
          const { error: ownTestError } = await supabaseClient
            .from('tenants')
            .update({ own_stripe_test_account_id: null, own_stripe_test_connected_at: null })
            .eq('own_stripe_test_account_id', account.id)
          if (ownTestError) {
            console.error('Error clearing own_stripe_test_account_id on deauthorize:', ownTestError)
          } else {
            console.log(`Own Stripe TEST account ${account.id} deauthorized — cleared from tenant(s)`)
          }
          break
        }

        // Legacy managed (Express) account path — unchanged.
        const { error: updateError } = await supabaseClient
          .from('tenants')
          .update({
            stripe_account_status: 'disabled',
            stripe_onboarding_complete: false,
          })
          .eq('stripe_account_id', account.id)

        if (updateError) {
          console.error('Error updating disconnected tenant:', updateError)
        } else {
          console.log(`Tenant with Stripe account ${account.id} has been deauthorized`)
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error processing webhook:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
