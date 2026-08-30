// Shared Modives CheckMyDriver (CMD) client helper.
//
// Auth: POST /api/app/modives/get-token with {clientId, clientSecret} returns a
// JWT valid for ~2-3 minutes (per Bhopan at Modives). We cache in-memory for
// 90 seconds to balance reuse against the short TTL. Every API call must also
// include the Ocp-Apim-Subscription-Key header for the APIM gateway.
//
// Per Modives compliance ("integration provider shall not store any information
// it receives from Modives API Services"), only call this helper from edge
// functions — never expose responses to the browser without scrubbing.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { encode as base64Encode } from 'https://deno.land/std@0.207.0/encoding/base64.ts'

const TOKEN_CACHE_TTL_MS = 90 * 1000; // 90s — well under the 2-3 min token expiry

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

let cachedToken: CachedToken | null = null;

function env(name: string, required = true): string {
  const v = Deno.env.get(name);
  if (required && !v) throw new Error(`Missing env var: ${name}`);
  return v ?? '';
}

export function getModivesBaseUrl(): string {
  return env('MODIVES_BASE_URL').replace(/\/$/, '');
}

function getSubscriptionKey(): string {
  return env('MODIVES_SUBSCRIPTION_KEY');
}

export function getModivesAuthKey(): string {
  return env('MODIVES_AUTH_KEY');
}

export function getModivesWebhookSecret(): string {
  return env('MODIVES_WEBHOOK_SECRET');
}

/**
 * Get an access token, using in-memory cache when possible.
 */
export async function getCMDToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const url = `${getModivesBaseUrl()}/api/app/modives/get-token`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': getSubscriptionKey(),
    },
    body: JSON.stringify({
      clientId: env('MODIVES_CLIENT_ID'),
      clientSecret: env('MODIVES_CLIENT_SECRET'),
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Modives get-token failed (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  // Modives returns either {access_Token,...} or wrapped under {result:{...}}
  const token: string | undefined = data?.access_Token ?? data?.result?.access_Token;
  if (!token) {
    throw new Error(`Modives get-token returned no access_Token: ${JSON.stringify(data)}`);
  }

  cachedToken = {
    token,
    expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
  };

  return token;
}

interface CMDFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Set false to skip the auto-retry on 401 */
  retryOnAuthFail?: boolean;
}

/**
 * Wrapper around fetch that injects auth + subscription key, parses JSON,
 * and retries once on 401 with a fresh token.
 */
export async function cmdFetch<T = unknown>(
  path: string,
  opts: CMDFetchOptions = {}
): Promise<T> {
  const { method = 'GET', body, retryOnAuthFail = true } = opts;
  const url = `${getModivesBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

  const doFetch = async (token: string): Promise<Response> => {
    return await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': getSubscriptionKey(),
        'Authorization': `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let token = await getCMDToken();
  let resp = await doFetch(token);

  if (resp.status === 401 && retryOnAuthFail) {
    token = await getCMDToken(true);
    resp = await doFetch(token);
  }

  const text = await resp.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!resp.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data
      ? (data as { message?: string }).message
      : text;
    throw new Error(`Modives ${method} ${path} failed (${resp.status}): ${message ?? 'unknown error'}`);
  }

  return data as T;
}

/**
 * Verify a Modives webhook signature.
 *
 * The header arrives as `t=<UTC timestamp string>|s=<base64(HMAC-SHA256(secret, payload))>`.
 * We HMAC the raw request body (untouched) using the webhook secret and compare
 * to the base64-decoded `s` portion of the header.
 *
 * NOTE: Modives' .NET sample concatenates `t=<utc-now>|s=<b64>` but signs ONLY
 * the payload bytes (not `timestamp|payload`). We follow that .NET logic.
 */
export async function verifyWebhookSignature(
  rawPayload: string,
  signatureHeader: string | null
): Promise<{ valid: boolean; timestamp: string | null; reason?: string }> {
  if (!signatureHeader) {
    return { valid: false, timestamp: null, reason: 'missing modives-signature header' };
  }

  const parts = signatureHeader.split('|').reduce<Record<string, string>>((acc, p) => {
    const [k, ...rest] = p.split('=');
    if (k && rest.length) acc[k.trim()] = rest.join('=').trim();
    return acc;
  }, {});

  const t = parts['t'] ?? null;
  const s = parts['s'] ?? null;

  if (!s) {
    return { valid: false, timestamp: t, reason: 'no signature value in header' };
  }

  const secret = getModivesWebhookSecret();
  const keyData = new TextEncoder().encode(secret);
  const payloadData = new TextEncoder().encode(rawPayload);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);
  const computed = base64Encode(new Uint8Array(sigBytes));

  // Constant-time compare
  if (computed.length !== s.length) {
    return { valid: false, timestamp: t, reason: 'signature length mismatch' };
  }
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ s.charCodeAt(i);
  }
  return { valid: diff === 0, timestamp: t, reason: diff === 0 ? undefined : 'signature mismatch' };
}

/**
 * Load the current Modives config row (dealer_guid, location_guid, etc).
 */
export async function getModivesConfig(
  supabase: SupabaseClient,
  environment: 'test' | 'live' = 'test'
): Promise<{
  id: string;
  environment: string;
  dealer_guid: string | null;
  location_guid: string | null;
} | null> {
  const { data, error } = await supabase
    .from('modives_config')
    .select('id, environment, dealer_guid, location_guid')
    .eq('environment', environment)
    .maybeSingle();
  if (error) {
    console.error('[modives-client] failed to load modives_config', error);
    return null;
  }
  return data;
}

/**
 * Modives schema-specific types (only the fields we actually use).
 */
export type ModivesApplicantInput = {
  firstName: string;
  middleName?: string;
  lastName: string;
  applicantType: 'Primary' | 'Joint' | 'Cosigner';
  applicantEmail: string;
  phoneNumber: string;   // 10 digits, US format
  mobile: string;        // same as phone if not separate
  state: string;         // 2-letter
  zipCode: string;       // 5 digits
  city: string;
  addressLine1: string;
  addressLine2?: string;
};

export type ModivesCreateVerificationInput = {
  dealerGuid: string;
  acquisitionTypeId: 'Rental' | 'Loaner';
  verificationTypeId: 'Rental' | 'Loaner';
  isCPI: boolean;
  metaData: string;
  leaseTerm: number;
  leaseStartDate?: string;     // ISO
  applicants: ModivesApplicantInput[];
};

export type ModivesCreateVerificationResponse = {
  result?: Record<string, string> | string;
  isSuccess?: boolean;
  message?: string;
};

export type ModivesMagicLinkResponse = {
  result?: Record<string, string> | string;
  isSuccess?: boolean;
  message?: string;
};
