// Tesla Fleet API management edge function
// Actions: authenticate, callback, check_vehicle, disconnect, get_status
// Follows the manage-twilio-subaccount pattern

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
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

  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

        const redirectUri = params.redirectUri || `${Deno.env.get('SUPABASE_URL')}/functions/v1/tesla-fleet-api`;
        const state = JSON.stringify({ tenantId, action: 'callback' });
        const authUrl = getTeslaAuthUrl(redirectUri, btoa(state));

        return jsonResponse({ authUrl });
      }

      // ─── OAUTH CALLBACK ───────────────────────────────────────
      case 'callback': {
        const { code, redirectUri, tenantId } = params;
        if (!code) return errorResponse('Missing authorization code', 400);
        const targetTenantId = tenantId || appUser.tenant_id;
        if (!targetTenantId) return errorResponse('No tenant ID', 400);

        const callbackUri = redirectUri || `${Deno.env.get('SUPABASE_URL')}/functions/v1/tesla-fleet-api`;
        const tokens = await exchangeTeslaAuthCode(code, callbackUri);
        const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000).toISOString();

        // Store tokens on tenant
        const { error: updateError } = await supabase
          .from('tenants')
          .update({
            integration_tesla_fleet: true,
            tesla_fleet_api_token: tokens.accessToken,
            tesla_fleet_refresh_token: tokens.refreshToken,
            tesla_fleet_token_expires_at: expiresAt,
          })
          .eq('id', targetTenantId);

        if (updateError) return errorResponse(`Failed to save tokens: ${updateError.message}`, 500);

        return jsonResponse({ success: true, message: 'Tesla Fleet API connected' });
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
          // Enable Tesla Fleet on this vehicle
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

        // Count enabled vehicles
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

        // Clear tokens and disable
        await supabase
          .from('tenants')
          .update({
            integration_tesla_fleet: false,
            tesla_fleet_api_token: null,
            tesla_fleet_refresh_token: null,
            tesla_fleet_token_expires_at: null,
          })
          .eq('id', tenantId);

        // Disable all vehicles
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
