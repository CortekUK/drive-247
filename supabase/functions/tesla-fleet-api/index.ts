// Tesla Fleet API management edge function
// Actions: get_auth_url, check_vehicle, disconnect, get_status, update_mode, list_vehicles
// Also handles GET for OAuth callback redirect from Tesla

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse, corsHeaders } from '../_shared/cors.ts';
import {
  getTeslaAuthUrl,
  exchangeTeslaAuthCode,
  getValidTeslaToken,
  getTenantTeslaCredentials,
  getTenantTeslaFleetMode,
  checkVehicleByVin,
  listTeslaVehicles,
} from '../_shared/tesla-fleet-client.ts';

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

      // Decode state to get tenantId and returnUrl
      let state: { tenantId: string; returnUrl?: string };
      try {
        state = JSON.parse(atob(stateParam));
      } catch {
        return new Response('Invalid state parameter', { status: 400 });
      }

      const tenantId = state.tenantId;
      if (!tenantId) {
        return new Response('Missing tenant ID in state', { status: 400 });
      }

      // Exchange code for tokens using the edge function URL as redirect_uri (must match what was sent to Tesla)
      const redirectUri = `${supabaseUrl}/functions/v1/tesla-fleet-api`;
      const tokens = await exchangeTeslaAuthCode(code, redirectUri);
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

      // Store tokens on tenant
      await supabase
        .from('tenants')
        .update({
          integration_tesla_fleet: true,
          tesla_fleet_api_token: tokens.accessToken,
          tesla_fleet_refresh_token: tokens.refreshToken,
          tesla_fleet_token_expires_at: expiresAt,
        })
        .eq('id', tenantId);

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
        const tenantId = params.tenantId || appUser.tenant_id;
        if (!tenantId) return errorResponse('No tenant ID', 400);

        // Always redirect to this edge function (generic, works for all tenants)
        const redirectUri = `${supabaseUrl}/functions/v1/tesla-fleet-api`;

        // Encode tenantId + returnUrl in state so the callback knows where to redirect
        const returnUrl = params.returnUrl || params.redirectUri || `${params.origin || 'https://portal.drive-247.com'}/settings`;
        const state = JSON.stringify({ tenantId, returnUrl });
        const authUrl = getTeslaAuthUrl(redirectUri, btoa(state));

        return jsonResponse({ authUrl });
      }

      // ─── CHECK VEHICLE COMPATIBILITY ───────────────────────────
      case 'check_vehicle': {
        const tenantId = params.tenantId || appUser.tenant_id;
        if (!tenantId) return errorResponse('No tenant ID', 400);

        const { vehicleId, vin } = params;
        if (!vehicleId || !vin) return errorResponse('Missing vehicleId or vin', 400);

        const mode = await getTenantTeslaFleetMode(supabase, tenantId);
        const apiToken = await getValidTeslaToken(supabase, tenantId);
        const result = await checkVehicleByVin(apiToken, mode, vin);

        if (result.compatible) {
          await supabase
            .from('vehicles')
            .update({
              tesla_fleet_enabled: true,
              tesla_fleet_vehicle_id: result.vehicleId,
            })
            .eq('id', vehicleId);

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
        const tenantId = params.tenantId || appUser.tenant_id;
        if (!tenantId) return errorResponse('No tenant ID', 400);

        const mode = await getTenantTeslaFleetMode(supabase, tenantId);
        const apiToken = await getValidTeslaToken(supabase, tenantId);
        const vehicles = await listTeslaVehicles(apiToken, mode);

        return jsonResponse({ vehicles });
      }

      // ─── GET STATUS ────────────────────────────────────────────
      case 'get_status': {
        const tenantId = params.tenantId || appUser.tenant_id;
        if (!tenantId) return errorResponse('No tenant ID', 400);

        const { data: tenant } = await supabase
          .from('tenants')
          .select('integration_tesla_fleet, tesla_fleet_mode, tesla_fleet_token_expires_at')
          .eq('id', tenantId)
          .single();

        const { count } = await supabase
          .from('vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('tesla_fleet_enabled', true);

        return jsonResponse({
          connected: tenant?.integration_tesla_fleet || false,
          mode: tenant?.tesla_fleet_mode || 'test',
          tokenExpiresAt: tenant?.tesla_fleet_token_expires_at,
          enabledVehicleCount: count || 0,
        });
      }

      // ─── DISCONNECT ────────────────────────────────────────────
      case 'disconnect': {
        const tenantId = params.tenantId || appUser.tenant_id;
        if (!tenantId) return errorResponse('No tenant ID', 400);

        await supabase
          .from('tenants')
          .update({
            integration_tesla_fleet: false,
            tesla_fleet_api_token: null,
            tesla_fleet_refresh_token: null,
            tesla_fleet_token_expires_at: null,
          })
          .eq('id', tenantId);

        await supabase
          .from('vehicles')
          .update({
            tesla_fleet_enabled: false,
            tesla_fleet_vehicle_id: null,
          })
          .eq('tenant_id', tenantId);

        return jsonResponse({ success: true, message: 'Tesla Fleet API disconnected' });
      }

      // ─── UPDATE MODE ───────────────────────────────────────────
      case 'update_mode': {
        const tenantId = params.tenantId || appUser.tenant_id;
        if (!tenantId) return errorResponse('No tenant ID', 400);

        const { mode } = params;
        if (!mode || !['test', 'live'].includes(mode)) {
          return errorResponse('Invalid mode. Must be "test" or "live"', 400);
        }

        await supabase
          .from('tenants')
          .update({ tesla_fleet_mode: mode })
          .eq('id', tenantId);

        return jsonResponse({ success: true, mode });
      }

      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (err: any) {
    console.error('[tesla-fleet-api] Error:', err);
    return errorResponse(err.message || 'Internal server error', 500);
  }
});
