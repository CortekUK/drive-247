// Shared Tesla Fleet API client helper
// Single production endpoint (Tesla has no usable sandbox).

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TESLA_API_BASE = 'https://fleet-api.prd.na.vn.cloud.tesla.com';
const TESLA_AUTH_BASE = 'https://auth.tesla.com';

// ─── HMAC-signed OAuth state ──────────────────────────────────────
// The OAuth `state` parameter MUST be authenticated; otherwise an attacker
// can craft a state pointing at another tenant and steal tokens.

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getStateSecret(): string {
  // Prefer a dedicated secret; fall back to the service role key which is
  // always injected into the Edge Functions runtime. Used only as an HMAC key
  // — never returned to clients.
  const secret = Deno.env.get('TESLA_STATE_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new Error('Missing TESLA_STATE_SECRET / SUPABASE_SERVICE_ROLE_KEY');
  return secret;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

export async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = { ...payload, iat: Date.now() };
  const bodyB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(body)));
  const sig = await hmacSha256(getStateSecret(), bodyB64);
  return `${bodyB64}.${b64urlEncode(sig)}`;
}

export async function verifyState<T = Record<string, unknown>>(state: string): Promise<T> {
  const dot = state.indexOf('.');
  if (dot < 0) throw new Error('Malformed state');
  const bodyB64 = state.slice(0, dot);
  const sigB64 = state.slice(dot + 1);
  const expected = await hmacSha256(getStateSecret(), bodyB64);
  const provided = b64urlDecode(sigB64);
  if (!constantTimeEqual(expected, provided)) throw new Error('Invalid state signature');
  const body = JSON.parse(new TextDecoder().decode(b64urlDecode(bodyB64)));
  if (typeof body.iat !== 'number' || Date.now() - body.iat > STATE_TTL_MS) {
    throw new Error('State expired');
  }
  return body as T;
}

export async function getTenantTeslaCredentials(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{
  apiToken: string;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
}> {
  // Tokens live in Supabase Vault; tesla_get_tokens is a SECURITY DEFINER RPC
  // granted to service_role only.
  const { data, error } = await supabase.rpc('tesla_get_tokens', { p_tenant_id: tenantId });

  if (error) throw new Error(`Failed to fetch tenant Tesla credentials: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.access_token) throw new Error('Tesla Fleet API not configured for this tenant');

  return {
    apiToken: row.access_token,
    refreshToken: row.refresh_token ?? null,
    tokenExpiresAt: row.expires_at ?? null,
  };
}

export async function storeTeslaTokens(
  supabase: SupabaseClient,
  tenantId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: string,
): Promise<void> {
  const { error } = await supabase.rpc('tesla_store_tokens', {
    p_tenant_id: tenantId,
    p_access_token: accessToken,
    p_refresh_token: refreshToken,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(`Failed to store Tesla tokens: ${error.message}`);
}

export async function clearTeslaTokens(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const { error } = await supabase.rpc('tesla_clear_tokens', { p_tenant_id: tenantId });
  if (error) throw new Error(`Failed to clear Tesla tokens: ${error.message}`);
}

export function isTokenExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000;
  return now >= expiry - bufferMs;
}

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

  await storeTeslaTokens(
    supabase,
    tenantId,
    data.access_token,
    data.refresh_token || refreshToken,
    expiresAt,
  );

  return { accessToken: data.access_token, expiresAt };
}

export async function getValidTeslaToken(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string> {
  const creds = await getTenantTeslaCredentials(supabase, tenantId);

  if (!isTokenExpired(creds.tokenExpiresAt)) {
    return creds.apiToken;
  }

  if (!creds.refreshToken) {
    throw new Error('Tesla token expired and no refresh token available. Please reconnect Tesla in Settings.');
  }

  const { accessToken } = await refreshTeslaToken(supabase, tenantId, creds.refreshToken);
  return accessToken;
}

async function teslaApiRequest(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const resp = await fetch(`${TESLA_API_BASE}${path}`, {
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

export async function listTeslaVehicles(token: string): Promise<any[]> {
  const data = await teslaApiRequest(token, '/api/1/vehicles');
  return data.response || [];
}

export async function getChargingHistory(
  token: string,
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

  const data = await teslaApiRequest(token, path);
  return data.response?.charging_history || [];
}

export async function checkVehicleByVin(
  token: string,
  vin: string
): Promise<{ compatible: boolean; vehicleId?: string; vehicleName?: string }> {
  const vehicles = await listTeslaVehicles(token);
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

export function getTeslaAuthUrl(redirectUri: string, state: string): string {
  const clientId = Deno.env.get('TESLA_CLIENT_ID');
  if (!clientId) throw new Error('Missing TESLA_CLIENT_ID');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    // offline_access is required for Tesla to return a refresh_token.
    scope: 'openid offline_access vehicle_device_data vehicle_charging_cmds',
    state,
  });

  return `${TESLA_AUTH_BASE}/oauth2/v3/authorize?${params.toString()}`;
}

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
