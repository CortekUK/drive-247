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
          const patch: Record<string, unknown> = {
            stripe_account_status: status,
            stripe_onboarding_complete: onboardingComplete,
          }

          // COMPLETE A DEFERRED SWITCH.
          //
          // stripe-oauth-callback stores the account but deliberately does NOT
          // move a tenant's live money onto it until Stripe says charges are
          // enabled. This is where that promise is kept: the moment the operator
          // finishes onboarding, routing follows automatically and they do not
          // have to come back and reconnect.
          if (account.charges_enabled && t.payment_model !== 'own') {
            patch.payment_model = 'own'
            patch.stripe_mode = 'live'
            console.log(`[connect-webhook] ${account.id}: charges enabled — completing deferred switch for tenant ${t.id}`)
          }

          const { error: ownErr } = await supabaseClient
            .from('tenants')
            .update(patch)
            .eq('id', t.id)

          if (ownErr) {
            console.error(`[connect-webhook] Failed updating own-Stripe tenant ${t.id}:`, ownErr)
          } else {
            console.log(
              `[connect-webhook] own account ${account.id} tenant ${t.id}: status=${status} ` +
              `onboarding=${onboardingComplete} charges_enabled=${account.charges_enabled}`
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
