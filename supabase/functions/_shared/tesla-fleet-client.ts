// Shared Tesla Fleet API client helper
// Mirrors stripe-client.ts pattern: per-tenant mode support, token management, sandbox/prod URLs

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

export type TeslaFleetMode = 'test' | 'live';

// Tesla Fleet API base URLs
const TESLA_API_BASE = {
  test: 'https://fleet-api.prd.na.vn.cloud.tesla.com', // Tesla sandbox/test
  live: 'https://fleet-api.prd.na.vn.cloud.tesla.com', // Production (same URL, different auth)
};

const TESLA_AUTH_BASE = 'https://auth.tesla.com';

/**
 * Get Tesla Fleet API base URL for given mode
 */
export function getTeslaApiBase(mode: TeslaFleetMode): string {
  return TESLA_API_BASE[mode];
}

/**
 * Fetch tenant's Tesla Fleet mode from database
 */
export async function getTenantTeslaFleetMode(
  supabase: SupabaseClient,
  tenantId: string
): Promise<TeslaFleetMode> {
  const { data, error } = await supabase
    .from('tenants')
    .select('tesla_fleet_mode')
    .eq('id', tenantId)
    .single();

  if (error) throw new Error(`Failed to fetch tenant Tesla mode: ${error.message}`);
  return (data?.tesla_fleet_mode as TeslaFleetMode) || 'test';
}

/**
 * Get Tesla Fleet API credentials for a tenant
 */
export async function getTenantTeslaCredentials(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{
  apiToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  mode: TeslaFleetMode;
}> {
  const { data, error } = await supabase
    .from('tenants')
    .select('tesla_fleet_api_token, tesla_fleet_refresh_token, tesla_fleet_token_expires_at, tesla_fleet_mode')
    .eq('id', tenantId)
    .single();

  if (error) throw new Error(`Failed to fetch tenant Tesla credentials: ${error.message}`);
  if (!data?.tesla_fleet_api_token) throw new Error('Tesla Fleet API not configured for this tenant');

  return {
    apiToken: data.tesla_fleet_api_token,
    refreshToken: data.tesla_fleet_refresh_token,
    tokenExpiresAt: data.tesla_fleet_token_expires_at,
    mode: (data.tesla_fleet_mode as TeslaFleetMode) || 'test',
  };
}

/**
 * Check if the Tesla API token needs refresh (expired or within 5 min of expiry)
 */
export function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer
  return now >= expiry - bufferMs;
}

/**
 * Refresh the Tesla OAuth token
 */
export async function refreshTeslaToken(
  supabase: SupabaseClient,
  tenantId: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: string }> {
  const clientId = Deno.env.get('TESLA_CLIENT_ID');
  const clientSecret = Deno.env.get('TESLA_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('Missing TESLA_CLIENT_ID or TESLA_CLIENT_SECRET env vars');
  }

  const resp = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Tesla token refresh failed: ${err}`);
  }

  const data = await resp.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  // Update tenant with new tokens
  await supabase
    .from('tenants')
    .update({
      tesla_fleet_api_token: data.access_token,
      tesla_fleet_refresh_token: data.refresh_token || refreshToken,
      tesla_fleet_token_expires_at: expiresAt,
    })
    .eq('id', tenantId);

  return { accessToken: data.access_token, expiresAt };
}

/**
 * Get a valid Tesla API token, refreshing if needed
 */
export async function getValidTeslaToken(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string> {
  const creds = await getTenantTeslaCredentials(supabase, tenantId);

  if (!isTokenExpired(creds.tokenExpiresAt)) {
    return creds.apiToken;
  }

  if (!creds.refreshToken) {
    throw new Error('Tesla token expired and no refresh token available. Please reconnect.');
  }

  const { accessToken } = await refreshTeslaToken(supabase, tenantId, creds.refreshToken);
  return accessToken;
}

/**
 * Make an authenticated request to the Tesla Fleet API
 */
export async function teslaApiRequest(
  token: string,
  mode: TeslaFleetMode,
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const base = getTeslaApiBase(mode);
  const url = `${base}${path}`;

  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Tesla API error (${resp.status}): ${errText}`);
  }

  return resp.json();
}

/**
 * List all vehicles accessible by the Tesla account
 */
export async function listTeslaVehicles(
  token: string,
  mode: TeslaFleetMode
): Promise<any[]> {
  const data = await teslaApiRequest(token, mode, '/api/1/vehicles');
  return data.response || [];
}

/**
 * Get charging history for a vehicle
 */
export async function getChargingHistory(
  token: string,
  mode: TeslaFleetMode,
  vehicleId: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  let path = `/api/1/vehicles/${vehicleId}/charging_history`;
  const params = new URLSearchParams();
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  const qs = params.toString();
  if (qs) path += `?${qs}`;

  const data = await teslaApiRequest(token, mode, path);
  return data.response?.charging_history || [];
}

/**
 * Check if a VIN belongs to a Tesla vehicle accessible by the account
 */
export async function checkVehicleByVin(
  token: string,
  mode: TeslaFleetMode,
  vin: string
): Promise<{ compatible: boolean; vehicleId?: string; vehicleName?: string }> {
  const vehicles = await listTeslaVehicles(token, mode);
  const match = vehicles.find((v: any) => v.vin?.toUpperCase() === vin.toUpperCase());

  if (match) {
    return {
      compatible: true,
      vehicleId: String(match.id),
      vehicleName: match.display_name || `${match.vin}`,
    };
  }

  return { compatible: false };
}

/**
 * Generate Tesla OAuth authorization URL
 */
export function getTeslaAuthUrl(redirectUri: string, state: string): string {
  const clientId = Deno.env.get('TESLA_CLIENT_ID');
  if (!clientId) throw new Error('Missing TESLA_CLIENT_ID');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid vehicle_device_data vehicle_charging_cmds',
    state,
  });

  return `${TESLA_AUTH_BASE}/oauth2/v3/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeTeslaAuthCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = Deno.env.get('TESLA_CLIENT_ID');
  const clientSecret = Deno.env.get('TESLA_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('Missing TESLA_CLIENT_ID or TESLA_CLIENT_SECRET');
  }

  const resp = await fetch(`${TESLA_AUTH_BASE}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Tesla auth code exchange failed: ${err}`);
  }

  const data = await resp.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}
