// stripe-oauth-callback — public redirect target for the Own Stripe OAuth flow.
//
// Stripe 302-redirects the operator's browser here with ?code&state (or
// ?error when the operator cancels/denies). verify_jwt = false because a
// browser redirect cannot carry a JWT — security comes from the HMAC-signed
// `state` minted by stripe-oauth-start (tamper-proof, expiring), and from the
// authorization code exchange itself which only succeeds against our UAE
// platform's client secret.
//
// On success we store the connected Standard account id on the tenant. We do
// NOT flip tenants.payment_model — the super admin flips that manually once
// everything is verified.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getStripeClientForAccount, type StripeMode } from "../_shared/stripe-client.ts";

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

function redirectBack(state: OAuthState, outcome: 'ok' | 'error'): Response {
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

    const now = new Date().toISOString();
    const update = state.mode === 'live'
      ? { own_stripe_account_id: connectedAccountId, own_stripe_connected_at: now }
      : { own_stripe_test_account_id: connectedAccountId, own_stripe_test_connected_at: now };

    const { error: updateError } = await supabase
      .from('tenants')
      .update(update)
      .eq('id', state.tenantId);

    if (updateError) {
      throw new Error(`Failed to store connected account: ${updateError.message}`);
    }

    console.log(`[stripe-oauth-callback] Connected ${state.mode} account ${connectedAccountId} for tenant ${state.tenantId}`);
    return redirectBack(state, 'ok');
  } catch (error) {
    console.error('[stripe-oauth-callback] Error:', error);
    return redirectBack(state, 'error');
  }
});
