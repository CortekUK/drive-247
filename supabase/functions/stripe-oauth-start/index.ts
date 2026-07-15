// stripe-oauth-start — begin the Own Stripe OAuth flow (UAE platform).
//
// JWT-verified. The portal/admin calls this with the tenant + mode, and we
// return the Stripe OAuth authorize URL to redirect the operator to. The
// `state` parameter is a tamper-proof HMAC-signed token that the public
// stripe-oauth-callback function verifies before touching the database.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const STATE_TTL_SECONDS = 60 * 30; // 30 minutes to complete the OAuth flow

/**
 * Authorize the caller for this tenant. Only a super admin, or a head_admin/
 * admin belonging to THIS tenant, may start an OAuth flow — otherwise anyone
 * with a project JWT (incl. a self-registered booking customer) could bind
 * their own Stripe account to a victim tenant. Returns null when authorized,
 * or an error Response when not.
 */
async function authorizeCaller(req: Request, tenantId: string): Promise<Response | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return errorResponse('Missing authorization header', 401);

  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
  if (userError || !user) return errorResponse('Unauthorized', 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  const { data: appUser } = await supabase
    .from('app_users')
    .select('is_super_admin, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (appUser?.is_super_admin === true) return null;
  const canManageOwnTenant =
    appUser?.tenant_id === tenantId &&
    (appUser?.role === 'head_admin' || appUser?.role === 'admin');
  if (canManageOwnTenant) return null;

  return errorResponse('Not authorized to connect Stripe for this tenant', 403);
}

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
    // Reject delimiter injection — origin/tenantId are joined into the state
    // payload with '|', so neither may contain it (would let a caller forge
    // the expiry field on the other side of the split).
    if (origin.includes('|') || tenantId.includes('|')) {
      return errorResponse('Invalid characters in request');
    }

    // Only a super admin or this tenant's own admin may start the flow.
    const authError = await authorizeCaller(req, tenantId);
    if (authError) return authError;

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
