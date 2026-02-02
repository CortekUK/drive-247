// Bonzah Insurance API Client
// Handles authentication, token caching, and API calls to Bonzah

// Token cache with expiry
let cachedToken: { token: string; expiresAt: number } | null = null;

const BONZAH_API_URL = Deno.env.get('BONZAH_API_URL') || 'https://bonzah.sb.insillion.com/bb1';
const BONZAH_USERNAME = Deno.env.get('BONZAH_USERNAME') || '';
const BONZAH_PASSWORD = Deno.env.get('BONZAH_PASSWORD') || '';

// Token TTL (15 minutes, with 1 minute buffer)
const TOKEN_TTL_MS = 14 * 60 * 1000;

/**
 * Get Bonzah authentication token (cached for 15 minutes)
 */
export async function getBonzahToken(): Promise<string> {
  // Check if cached token is still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  console.log('[Bonzah] Authenticating with API...');

  const response = await fetch(`${BONZAH_API_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: BONZAH_USERNAME,
      password: BONZAH_PASSWORD,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Bonzah] Authentication failed:', errorText);
    throw new Error(`Bonzah authentication failed: ${response.status}`);
  }

  const data = await response.json();

  if (!data.token) {
    console.error('[Bonzah] No token in response:', data);
    throw new Error('Bonzah authentication did not return a token');
  }

  // Cache the token
  cachedToken = {
    token: data.token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  console.log('[Bonzah] Authentication successful');
  return cachedToken.token;
}

/**
 * Make an authenticated API call to Bonzah
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
      'Authorization': `Bearer ${token}`,
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();

  if (!response.ok) {
    console.error(`[Bonzah] API error ${response.status}:`, responseText);
    throw new Error(`Bonzah API error: ${response.status} - ${responseText}`);
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    console.error('[Bonzah] Failed to parse response:', responseText);
    throw new Error('Failed to parse Bonzah API response');
  }
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
