// stripe-oauth-start — begin the Own Stripe OAuth flow (UAE platform).
//
// JWT-verified. The portal/admin calls this with the tenant + mode, and we
// return the Stripe OAuth authorize URL to redirect the operator to. The
// `state` parameter is a tamper-proof HMAC-signed token that the public
// stripe-oauth-callback function verifies before touching the database.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const STATE_TTL_SECONDS = 60 * 30; // 30 minutes to complete the OAuth flow

function base64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signState(payload: string): Promise<string> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toHex(mac);
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { tenantId, mode, returnTo, origin } = await req.json();

    if (!tenantId || typeof tenantId !== 'string') {
      return errorResponse('tenantId is required');
    }
    if (mode !== 'test' && mode !== 'live') {
      return errorResponse("mode must be 'test' or 'live'");
    }
    if (returnTo !== 'portal' && returnTo !== 'admin') {
      return errorResponse("returnTo must be 'portal' or 'admin'");
    }
    if (!origin || typeof origin !== 'string' || !/^https?:\/\//.test(origin)) {
      return errorResponse('origin must be a valid http(s) origin');
    }

    const clientId = Deno.env.get(
      mode === 'live' ? 'STRIPE_UAE_OAUTH_CLIENT_ID_LIVE' : 'STRIPE_UAE_OAUTH_CLIENT_ID_TEST'
    );
    if (!clientId) {
      return errorResponse(`Missing Stripe OAuth client id for ${mode} mode`, 500);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) {
      return errorResponse('Missing SUPABASE_URL', 500);
    }

    // Tamper-proof state: base64url(payload) + '.' + hex(HMAC-SHA256(payload))
    const expiresAt = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
    const payload = `${tenantId}|${mode}|${returnTo}|${origin}|${expiresAt}`;
    const signature = await signState(payload);
    const state = `${base64urlEncode(payload)}.${signature}`;

    const redirectUri = `${supabaseUrl}/functions/v1/stripe-oauth-callback`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'read_write',
      redirect_uri: redirectUri,
      state,
    });

    const url = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;

    return jsonResponse({ url });
  } catch (error) {
    console.error('[stripe-oauth-start] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal error', 500);
  }
});
