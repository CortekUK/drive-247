// Bonzah Insurance API Client
// Handles authentication, token caching, and API calls to Bonzah

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

// Token cache with expiry (global env-based, backward compat)
let cachedToken: { token: string; expiresAt: number } | null = null;

// Per-tenant token cache keyed by username
const tenantTokenCache = new Map<string, { token: string; expiresAt: number }>();

// API base URL - note: /api/v1 is the API path, /bb1 is the portal
const BONZAH_API_URL = Deno.env.get('BONZAH_API_URL') || 'https://bonzah.sb.insillion.com/api/v1';
const BONZAH_USERNAME = Deno.env.get('BONZAH_USERNAME') || '';
const BONZAH_PASSWORD = Deno.env.get('BONZAH_PASSWORD') || '';

// Token TTL (15 minutes, with 1 minute buffer)
const TOKEN_TTL_MS = 14 * 60 * 1000;

/**
 * Get the Bonzah API URL for a given mode
 */
export function getBonzahApiUrl(mode: 'test' | 'live'): string {
  return mode === 'live'
    ? 'https://bonzah.insillion.com/api/v1'
    : 'https://bonzah.sb.insillion.com/api/v1';
}

/**
 * Tenant Bonzah credentials
 */
export interface TenantBonzahCredentials {
  username: string;
  password: string;
  mode: 'test' | 'live';
}

/**
 * Fetch tenant's Bonzah credentials from the database
 */
export async function getTenantBonzahCredentials(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<TenantBonzahCredentials> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('bonzah_username, bonzah_password, bonzah_mode')
    .eq('id', tenantId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch tenant Bonzah credentials: ${error.message}`);
  }

  if (!data?.bonzah_username || !data?.bonzah_password) {
    throw new Error('Tenant does not have Bonzah credentials configured');
  }

  return {
    username: data.bonzah_username,
    password: data.bonzah_password,
    mode: data.bonzah_mode as 'test' | 'live',
  };
}

/**
 * Get Bonzah authentication token for specific credentials (cached per-username)
 */
export async function getBonzahTokenForCredentials(
  username: string,
  password: string,
  apiUrl: string
): Promise<string> {
  const cached = tenantTokenCache.get(username);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  console.log('[Bonzah] Authenticating with API for:', username);

  const response = await fetch(`${apiUrl}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: username, pwd: password }),
  });

  const responseData = await response.json();

  if (responseData.status !== 0) {
    console.error('[Bonzah] Authentication failed:', responseData);
    throw new Error(`Bonzah authentication failed: ${responseData.txt || 'Unknown error'}`);
  }

  if (!responseData.data?.token) {
    console.error('[Bonzah] No token in response:', responseData);
    throw new Error('Bonzah authentication did not return a token');
  }

  tenantTokenCache.set(username, {
    token: responseData.data.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  console.log('[Bonzah] Authentication successful for:', responseData.data.email);
  return responseData.data.token;
}

/**
 * Make an authenticated API call to Bonzah using per-tenant credentials
 */
export async function bonzahFetchWithCredentials<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  credentials: TenantBonzahCredentials,
  method: 'POST' | 'GET' = 'POST'
): Promise<T> {
  const apiUrl = getBonzahApiUrl(credentials.mode);
  const token = await getBonzahTokenForCredentials(credentials.username, credentials.password, apiUrl);

  const url = endpoint.startsWith('http') ? endpoint : `${apiUrl}${endpoint}`;

  console.log(`[Bonzah] ${method} ${endpoint} (tenant: ${credentials.username})`);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'in-auth-token': token,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();

  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    console.error('[Bonzah] Failed to parse response:', responseText);
    throw new Error('Failed to parse Bonzah API response');
  }

  if (responseData.status !== 0 && responseData.status !== undefined) {
    console.error(`[Bonzah] API error (status ${responseData.status}):`, responseData);
    const errorMsg = responseData.txt || 'Unknown error';
    const error = new Error(`Bonzah API error: ${errorMsg}`) as Error & { bonzahStatus: number };
    error.bonzahStatus = responseData.status;
    throw error;
  }

  return responseData as T;
}

/**
 * Get Bonzah authentication token (cached for 15 minutes) — global env-based (backward compat)
 */
export async function getBonzahToken(): Promise<string> {
  // Check if cached token is still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  console.log('[Bonzah] Authenticating with API...');

  // Bonzah/Insillion API uses 'email' and 'pwd' fields, endpoint is /auth
  const response = await fetch(`${BONZAH_API_URL}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: BONZAH_USERNAME,
      pwd: BONZAH_PASSWORD,
    }),
  });

  const responseData = await response.json();

  // Check for API-level error (status !== 0 means error)
  if (responseData.status !== 0) {
    console.error('[Bonzah] Authentication failed:', responseData);
    throw new Error(`Bonzah authentication failed: ${responseData.txt || 'Unknown error'}`);
  }

  // Token is nested in data.token
  if (!responseData.data?.token) {
    console.error('[Bonzah] No token in response:', responseData);
    throw new Error('Bonzah authentication did not return a token');
  }

  // Cache the token
  cachedToken = {
    token: responseData.data.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  console.log('[Bonzah] Authentication successful for:', responseData.data.email);
  return cachedToken.token;
}

/**
 * Make an authenticated API call to Bonzah — global env-based (backward compat)
 */
export async function bonzahFetch<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  method: 'POST' | 'GET' = 'POST'
): Promise<T> {
  const token = await getBonzahToken();

  const url = endpoint.startsWith('http') ? endpoint : `${BONZAH_API_URL}${endpoint}`;

  console.log(`[Bonzah] ${method} ${endpoint}`);

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'in-auth-token': token, // Bonzah/Insillion uses this header instead of Authorization
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();

  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch {
    console.error('[Bonzah] Failed to parse response:', responseText);
    throw new Error('Failed to parse Bonzah API response');
  }

  // Bonzah API returns status: 0 for success, negative for errors
  if (responseData.status !== 0 && responseData.status !== undefined) {
    console.error(`[Bonzah] API error (status ${responseData.status}):`, responseData);
    // Include the status code in the error for better debugging
    const errorMsg = responseData.txt || 'Unknown error';
    const error = new Error(`Bonzah API error: ${errorMsg}`) as Error & { bonzahStatus: number };
    error.bonzahStatus = responseData.status;
    throw error;
  }

  return responseData as T;
}

/**
 * Format date for Bonzah API (MM/DD/YYYY)
 */
export function formatDateForBonzah(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

/**
 * Coverage type codes used by Bonzah API
 */
export const COVERAGE_CODES = {
  CDW: 'CDW',    // Collision Damage Waiver
  RCLI: 'RCLI',  // Rental Car Liability Insurance
  SLI: 'SLI',    // Supplemental Liability Insurance
  PAI: 'PAI',    // Personal Accident Insurance
} as const;

/**
 * Coverage types interface
 */
export interface CoverageTypes {
  cdw: boolean;
  rcli: boolean;
  sli: boolean;
  pai: boolean;
}

/**
 * Premium calculation response
 */
export interface PremiumResponse {
  total_premium: number;
  breakdown: {
    cdw: number;
    rcli: number;
    sli: number;
    pai: number;
  };
}

/**
 * Quote response from Bonzah
 */
export interface BonzahQuoteResponse {
  quote_id: string;
  quote_no?: string;
  payment_id?: string;
  premium: number;
}

/**
 * Payment/Policy response from Bonzah
 */
export interface BonzahPolicyResponse {
  policy_no: string;
  policy_id: string;
  status: string;
}

/**
 * Renter details for quote creation
 */
export interface RenterDetails {
  first_name: string;
  last_name: string;
  dob: string; // YYYY-MM-DD
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  license: {
    number: string;
    state: string;
  };
}
