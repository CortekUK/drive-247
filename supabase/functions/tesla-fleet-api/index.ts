// Tesla Fleet API management edge function
// Actions: get_auth_url, check_vehicle, disconnect, get_status, list_vehicles
// Also handles GET for OAuth callback redirect from Tesla

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  getTeslaAuthUrl,
  exchangeTeslaAuthCode,
  getValidTeslaToken,
  checkVehicleByVin,
  listTeslaVehicles,
  signState,
  verifyState,
  storeTeslaTokens,
  clearTeslaTokens,
} from '../_shared/tesla-fleet-client.ts';

// Reject cross-tenant tenantId overrides unless the caller is a super admin.
// Returns the resolved tenantId, or a Response if forbidden.
function resolveTenantId(
  paramsTenantId: string | undefined,
  appUser: { tenant_id: string | null; is_super_admin: boolean | null },
): string | Response {
  const requested = paramsTenantId;
  if (requested && requested !== appUser.tenant_id && !appUser.is_super_admin) {
    return new Response(
      JSON.stringify({ error: 'Forbidden: cannot act on another tenant' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const resolved = requested || appUser.tenant_id;
  if (!resolved) {
    return new Response(
      JSON.stringify({ error: 'No tenant ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  return resolved;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ─── HANDLE GET: OAuth callback from Tesla ─────────────────────
  if (req.method === 'GET') {
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');

      if (!code || !stateParam) {
        return new Response('Missing code or state parameter', { status: 400 });
      }

      // Verify the HMAC-signed state. This is the gate that prevents an
      // attacker from forging a state that points at another tenant.
      let state: { tenantId: string; returnUrl?: string };
      try {
        state = await verifyState<{ tenantId: string; returnUrl?: string }>(stateParam);
      } catch (err: any) {
        console.error('[tesla-fleet-api] State verification failed:', err.message);
        return new Response('Invalid or expired state', { status: 400 });
      }

      const tenantId = state.tenantId;
      if (!tenantId) {
        return new Response('Missing tenant ID in state', { status: 400 });
      }

      // Exchange code for tokens using the edge function URL as redirect_uri (must match what was sent to Tesla)
      const redirectUri = `${supabaseUrl}/functions/v1/tesla-fleet-api`;
      const tokens = await exchangeTeslaAuthCode(code, redirectUri);
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

      // Tokens are stored in Supabase Vault; the RPC also flips integration_tesla_fleet to true.
      await storeTeslaTokens(supabase, tenantId, tokens.accessToken, tokens.refreshToken, expiresAt);

      // Redirect back to the tenant's settings page
      const returnUrl = state.returnUrl || 'https://portal.drive-247.com/settings';
      const separator = returnUrl.includes('?') ? '&' : '?';
      const finalUrl = `${returnUrl}${separator}tesla_connected=true`;

      return new Response(null, {
        status: 302,
        headers: { 'Location': finalUrl },
      });
    } catch (err: any) {
      console.error('[tesla-fleet-api] OAuth callback error:', err);
      return new Response(`OAuth error: ${err.message}`, { status: 500 });
    }
  }

  // ─── HANDLE POST: All other actions (authenticated) ────────────
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    // Get user's tenant
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (appUserError) return errorResponse(`Failed to fetch user: ${appUserError.message}`, 403);

    const { action, ...params } = await req.json();

    switch (action) {
      // ─── GET AUTH URL ──────────────────────────────────────────
      case 'get_auth_url': {
        const t = resolveTenantId(params.tenantId, appUser);
        if (t instanceof Response) return t;
        const tenantId = t;

        // Always redirect to this edge function (generic, works for all tenants)
        const redirectUri = `${supabaseUrl}/functions/v1/tesla-fleet-api`;

        // HMAC-signed state — the callback verifies signature + 10 min TTL.
        const returnUrl = params.returnUrl || params.redirectUri || `${params.origin || 'https://portal.drive-247.com'}/settings`;
        const state = await signState({ tenantId, returnUrl });
        const authUrl = getTeslaAuthUrl(redirectUri, state);

        return jsonResponse({ authUrl });
      }

      // ─── CHECK VEHICLE COMPATIBILITY ───────────────────────────
      case 'check_vehicle': {
        const t = resolveTenantId(params.tenantId, appUser);
        if (t instanceof Response) return t;
        const tenantId = t;

        const { vehicleId, vin } = params;
        if (!vehicleId || !vin) return errorResponse('Missing vehicleId or vin', 400);

        const apiToken = await getValidTeslaToken(supabase, tenantId);
        const result = await checkVehicleByVin(apiToken, vin);

        if (result.compatible) {
          await supabase
            .from('vehicles')
            .update({
              tesla_fleet_enabled: true,
              tesla_fleet_vehicle_id: result.vehicleId,
            })
            .eq('id', vehicleId)
            .eq('tenant_id', tenantId);

          return jsonResponse({
            compatible: true,
            vehicleId: result.vehicleId,
            vehicleName: result.vehicleName,
            message: 'Vehicle is Tesla Fleet API compatible and has been enabled',
          });
        }

        return jsonResponse({
          compatible: false,
          message: 'Vehicle VIN not found in your Tesla account. Make sure the vehicle is added to your Tesla account.',
        });
      }

      // ─── LIST TESLA VEHICLES ───────────────────────────────────
      case 'list_vehicles': {
        const t = resolveTenantId(params.tenantId, appUser);
        if (t instanceof Response) return t;
        const tenantId = t;

        const apiToken = await getValidTeslaToken(supabase, tenantId);
        const vehicles = await listTeslaVehicles(apiToken);

        return jsonResponse({ vehicles });
      }

      // ─── GET STATUS ────────────────────────────────────────────
      case 'get_status': {
        const t = resolveTenantId(params.tenantId, appUser);
        if (t instanceof Response) return t;
        const tenantId = t;

        const { data: tenant } = await supabase
          .from('tenants')
          .select('integration_tesla_fleet, tesla_fleet_token_expires_at')
          .eq('id', tenantId)
          .single();

        const { count } = await supabase
          .from('vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('tesla_fleet_enabled', true);

        return jsonResponse({
          connected: tenant?.integration_tesla_fleet || false,
          tokenExpiresAt: tenant?.tesla_fleet_token_expires_at,
          enabledVehicleCount: count || 0,
        });
      }

      // ─── DISCONNECT ────────────────────────────────────────────
      case 'disconnect': {
        const t = resolveTenantId(params.tenantId, appUser);
        if (t instanceof Response) return t;
        const tenantId = t;

        // Clears tenant token columns + deletes vault secrets.
        await clearTeslaTokens(supabase, tenantId);

        await supabase
          .from('vehicles')
          .update({
            tesla_fleet_enabled: false,
            tesla_fleet_vehicle_id: null,
          })
          .eq('tenant_id', tenantId);

        return jsonResponse({ success: true, message: 'Tesla Fleet API disconnected' });
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (err: any) {
    console.error('[tesla-fleet-api] Error:', err);
    return errorResponse(err.message || 'Internal server error', 500);
  }
});
