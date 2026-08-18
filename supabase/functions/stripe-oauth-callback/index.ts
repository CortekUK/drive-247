// stripe-oauth-callback — public redirect target for the Own Stripe OAuth flow.
//
// Stripe 302-redirects the operator's browser here with ?code&state (or
// ?error when the operator cancels/denies). verify_jwt = false because a
// browser redirect cannot carry a JWT — security comes from the HMAC-signed
// `state` minted by stripe-oauth-start (tamper-proof, expiring), and from the
// authorization code exchange itself which only succeeds against our UAE
// platform's client secret.
//
// We store the connected Standard account id on the tenant, and flip
// tenants.payment_model to 'own' ONLY once Stripe confirms the account can
// actually accept charges. An operator who abandons Stripe's onboarding form
// still produces a valid account id, and routing live money onto that account
// took Global Motion offline for two days on 17 Aug 2026. Until Stripe says
// charges_enabled, the tenant keeps collecting on their existing account and
// stripe-connect-webhook completes the switch on `account.updated`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getStripeClientForAccount, type StripeMode } from "../_shared/stripe-client.ts";
import { onMigrationTaskComplete } from "../_shared/migration-progress.ts";

function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface OAuthState {
  tenantId: string;
  mode: StripeMode;
  returnTo: 'portal' | 'admin';
  origin: string;
}

/** Verify the HMAC-signed state from stripe-oauth-start. Returns null if invalid/expired. */
async function verifyState(state: string): Promise<OAuthState | null> {
  try {
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!secret) return null;

    const [encodedPayload, signature] = state.split('.');
    if (!encodedPayload || !signature) return null;

    const payload = base64urlDecode(encodedPayload);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    if (!timingSafeEqual(toHex(mac), signature)) return null;

    const [tenantId, mode, returnTo, origin, expiresAt] = payload.split('|');
    if (!tenantId || (mode !== 'test' && mode !== 'live')) return null;
    if (returnTo !== 'portal' && returnTo !== 'admin') return null;
    if (!origin) return null;
    if (!expiresAt || Math.floor(Date.now() / 1000) > parseInt(expiresAt, 10)) return null;

    return { tenantId, mode, returnTo, origin };
  } catch {
    return null;
  }
}

/**
 * `incomplete` is a THIRD outcome, distinct from both success and failure.
 *
 * The OAuth handshake genuinely succeeded — we hold the operator's account id —
 * but Stripe has not enabled charges on it yet. Reporting that as 'ok' is what
 * caused the 17 Aug Global Motion outage: the operator was told he was finished,
 * we routed his live payments onto an account Stripe had paused, and he could
 * not take a penny for two days. Reporting it as 'error' would be just as wrong
 * — nothing failed, and it would push him to redo a step he has already done.
 */
function redirectBack(state: OAuthState, outcome: 'ok' | 'error' | 'incomplete'): Response {
  const target = state.returnTo === 'admin'
    ? `${state.origin}/admin/rentals/${state.tenantId}?tab=payments&oauth=${outcome}`
    : `${state.origin}/settings?tab=payments&oauth=${outcome}`;
  return new Response(null, { status: 302, headers: { Location: target } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  // State is required to know where to send the browser back. If it's missing
  // or tampered with, we can't trust anything in the request — hard stop.
  const state = stateParam ? await verifyState(stateParam) : null;
  if (!state) {
    console.error('[stripe-oauth-callback] Invalid, expired or missing state');
    return new Response('Invalid or expired OAuth state. Please restart the connection from your dashboard.', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Operator denied access / Stripe returned an error — bounce back.
  if (oauthError || !code) {
    console.error('[stripe-oauth-callback] OAuth error from Stripe:', oauthError || 'missing code');
    return redirectBack(state, 'error');
  }

  try {
    // Exchange the authorization code on the UAE platform for the state's mode.
    const stripe = getStripeClientForAccount('uae', state.mode);
    const tokenResponse = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    });

    const connectedAccountId = tokenResponse.stripe_user_id;
    if (!connectedAccountId) {
      throw new Error('OAuth token exchange returned no stripe_user_id');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ── DOES THIS ACCOUNT ACTUALLY WORK? ────────────────────────────────────
    //
    // OAuth returning an account id means the operator AUTHORISED us. It does
    // NOT mean Stripe will accept payments on that account: an operator who
    // closes Stripe's onboarding form early still yields a perfectly valid
    // stripe_user_id for an account with `charges_enabled: false`.
    //
    // This block did not exist on 17 Aug 2026. Global Motion connected, we
    // flipped `payment_model` to 'own' and `stripe_mode` to 'live' on the spot,
    // marked the migration complete, and redirected 'ok'. Stripe had the account
    // paused pending details and an unaccepted service agreement. Every Checkout
    // session, payment link, deposit hold and invoice for that tenant failed for
    // ~2 days across 10 live rentals, and the portal reported the connection
    // healthy throughout because it was describing the OLD account.
    //
    // So: ask Stripe first, and never move a tenant's live money onto an account
    // that cannot receive it.
    let chargesEnabled = false;
    let detailsSubmitted = false;
    let disabledReason: string | null = null;
    try {
      const account = await stripe.accounts.retrieve(connectedAccountId);
      chargesEnabled = account.charges_enabled === true;
      detailsSubmitted = account.details_submitted === true;
      disabledReason = account.requirements?.disabled_reason ?? null;
    } catch (probeErr) {
      // Could not ask. Treat exactly as "not proven usable" — the whole point of
      // this guard is that we never flip on an assumption.
      console.error('[stripe-oauth-callback] Could not retrieve account', connectedAccountId, probeErr);
    }

    const usable = chargesEnabled;
    console.log(
      `[stripe-oauth-callback] account=${connectedAccountId} charges_enabled=${chargesEnabled} ` +
      `details_submitted=${detailsSubmitted} disabled_reason=${disabledReason ?? 'none'}`
    );

    const now = new Date().toISOString();
    // Connecting the operator's REAL Stripe account is itself the go-live
    // moment for payments: from here every booking settles directly into their
    // account, so leaving them in test mode would only mean their customers
    // can't actually pay. Flip stripe_mode to 'live' alongside storing the
    // account. (Bonzah/e-sign keep their own modes and their own go-live.)
    //
    // We ALSO flip payment_model to 'own' immediately: the operator just
    // authorized their own account, so from this moment every booking must
    // settle there — there is no manual super-admin verification step. Until
    // this flip, getConnectAccountId still routes charges to the legacy managed
    // (Express) account, so an un-flipped connected tenant would silently keep
    // paying into the old account. Test connections are admin rehearsals and do
    // NOT change routing.
    // Live + usable: the full flip, exactly as before.
    // Live + NOT usable: REMEMBER the account, but leave routing alone. The
    // tenant keeps taking money on their existing account — which is working —
    // until Stripe confirms the new one can. stripe-connect-webhook completes
    // the flip on `account.updated` the moment charges_enabled turns true.
    // One more thing the guard has to protect, separate from the flip.
    //
    // For a tenant already on payment_model='own' + live, `own_stripe_account_id`
    // is not a record of the connection — it IS the routing decision.
    // getConnectAccountId returns it directly, with no chargeability check:
    //
    //     if (!tenant.own_stripe_account_id) throw ...
    //     return tenant.own_stripe_account_id
    //
    // So storing an unproven account id there takes a WORKING tenant off-line,
    // flip or no flip. Gating only the flip would have left that door open.
    const { data: current } = await supabase
      .from('tenants')
      .select('own_stripe_account_id, payment_model, stripe_mode')
      .eq('id', state.tenantId)
      .maybeSingle();

    const liveOnADifferentOwnAccount =
      current?.payment_model === 'own' &&
      current?.stripe_mode === 'live' &&
      !!current?.own_stripe_account_id &&
      current.own_stripe_account_id !== connectedAccountId;

    // null = deliberately store nothing. Re-authorising the SAME id is a no-op
    // rewrite and stays allowed; swapping in a different, unproven account while
    // live is the case we refuse.
    const update: Record<string, unknown> | null = state.mode === 'live'
      ? (usable
          ? {
              own_stripe_account_id: connectedAccountId,
              own_stripe_connected_at: now,
              stripe_mode: 'live',
              payment_model: 'own',
            }
          : (liveOnADifferentOwnAccount
              ? null
              : {
                  own_stripe_account_id: connectedAccountId,
                  own_stripe_connected_at: now,
                }))
      : { own_stripe_test_account_id: connectedAccountId, own_stripe_test_connected_at: now };

    if (update === null) {
      console.warn(
        `[stripe-oauth-callback] REFUSED to store ${connectedAccountId} for tenant ${state.tenantId}: ` +
        `Stripe reports charges_enabled=false and the tenant is live on ${current?.own_stripe_account_id}. ` +
        `Overwriting a working routing account with an unusable one would cause an outage.`
      );
      return redirectBack(state, 'incomplete');
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from('tenants')
      .update(update)
      .eq('id', state.tenantId)
      .select('id');

    if (updateError) {
      throw new Error(`Failed to store connected account: ${updateError.message}`);
    }
    // 0 rows updated = the tenant id in the (validly-signed) state no longer
    // exists. Don't report success when nothing was stored.
    if (!updatedRows || updatedRows.length === 0) {
      throw new Error(`No tenant matched id ${state.tenantId} — connected account not stored`);
    }

    // The migration task is only DONE when the account can actually take money.
    // Marking it complete on a paused account is what let the 17 Aug outage go
    // unnoticed: every dashboard said finished while nothing could be collected.
    // A test-mode connection is an admin rehearsal and completes as before.
    if (state.mode !== 'live' || usable) {
      // Best-effort — never let this break the redirect back.
      await onMigrationTaskComplete(supabase, state.tenantId, "stripe");
    }

    if (state.mode === 'live' && !usable) {
      console.warn(
        `[stripe-oauth-callback] Stored ${connectedAccountId} for tenant ${state.tenantId} but did NOT ` +
        `switch payment routing: Stripe reports charges_enabled=false` +
        `${disabledReason ? ` (${disabledReason})` : ''}. Payments continue on the existing account.`
      );
      return redirectBack(state, 'incomplete');
    }

    console.log(`[stripe-oauth-callback] Connected ${state.mode} account ${connectedAccountId} for tenant ${state.tenantId}`);
    return redirectBack(state, 'ok');
  } catch (error) {
    console.error('[stripe-oauth-callback] Error:', error);
    return redirectBack(state, 'error');
  }
});
