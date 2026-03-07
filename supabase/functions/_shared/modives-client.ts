// Modives / CheckMyDriver API Client
// Handles authentication, token caching, and API calls to Modives

import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";
import { encode as base64Encode } from "https://deno.land/std@0.177.0/encoding/base64.ts";

const MODIVES_APIM_URL = Deno.env.get('MODIVES_APIM_URL') || 'https://api-stgext1.modives.com';
const MODIVES_CLIENT_ID = Deno.env.get('MODIVES_CLIENT_ID') || '';
const MODIVES_CLIENT_SECRET = Deno.env.get('MODIVES_CLIENT_SECRET') || '';
const MODIVES_SUBSCRIPTION_KEY = Deno.env.get('MODIVES_SUBSCRIPTION_KEY') || '';
const MODIVES_AUTH_KEY = Deno.env.get('MODIVES_AUTH_KEY') || '';
const MODIVES_WEBHOOK_SECRET = Deno.env.get('MODIVES_WEBHOOK_SECRET') || '';
const MODIVES_DEALER_GUID_ID = Deno.env.get('MODIVES_DEALER_GUID_ID') || '';

// Token cache with 9-min TTL (token lasts ~10 min)
let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_TTL_MS = 9 * 60 * 1000;

/**
 * Get Modives authentication token (cached)
 */
export async function getModivesToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  console.log('[Modives] Authenticating...');

  const response = await fetch(`${MODIVES_APIM_URL}/api/app/modives/get-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': MODIVES_SUBSCRIPTION_KEY,
    },
    body: JSON.stringify({
      clientId: MODIVES_CLIENT_ID,
      clientSecret: MODIVES_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Modives] Auth failed:', response.status, errorText);
    throw new Error(`Modives authentication failed: ${response.status}`);
  }

  const data = await response.json();

  if (!data.access_Token) {
    console.error('[Modives] No token in response:', data);
    throw new Error('Modives authentication did not return a token');
  }

  cachedToken = {
    token: data.access_Token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  console.log('[Modives] Authentication successful');
  return cachedToken.token;
}

/**
 * Strip country code and non-digit chars, return last 10 digits
 */
function normalizePhoneFor10Digits(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-10);
}

/**
 * Create a new verification request
 */
export async function createModivesVerification(params: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  metaData?: string;
  leaseStartDate?: string;
  leaseEndDate?: string;
}): Promise<{ verificationId: string }> {
  const token = await getModivesToken();

  console.log('[Modives] Creating verification for:', params.email);

  const requestBody = {
    dealerGuid: MODIVES_DEALER_GUID_ID,
    verificationTypeId: 'Rental',
    acquisitionTypeId: 'Rental',
    isCPI: false,
    leaseTerm: 12,
    metaData: params.metaData || 'Drive247 Verification',
    leaseStartDate: params.leaseStartDate || new Date().toISOString(),
    leaseEndDate: params.leaseEndDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    applicants: [
      {
        applicantType: 'Primary',
        firstName: params.firstName,
        lastName: params.lastName,
        applicantEmail: params.email,
        phoneNumber: normalizePhoneFor10Digits(params.phone),
        mobile: normalizePhoneFor10Digits(params.phone),
        addressLine1: params.addressLine1,
        city: params.city,
        state: params.state,
        zipCode: params.zipCode,
      },
    ],
  };

  console.log('[Modives] Exact request body:', JSON.stringify(requestBody));

  const response = await fetch(`${MODIVES_APIM_URL}/api/app/modives/verification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': MODIVES_SUBSCRIPTION_KEY,
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  let data;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error('[Modives] Failed to parse verification response:', responseText);
    throw new Error('Failed to parse Modives verification response');
  }

  if (!response.ok) {
    console.error('[Modives] Create verification failed:', response.status, JSON.stringify(data));
    throw new Error(`Create verification failed: ${response.status} - ${JSON.stringify(data)}`);
  }

  console.log('[Modives] Create verification response:', JSON.stringify(data));

  // Modives returns 200 even on failure — check isSuccess flag
  if (data.isSuccess === false) {
    throw new Error(`Modives error: ${data.message || JSON.stringify(data)}`);
  }

  const verificationId = data.result?.verificationId || data.result?.id || data.verificationId || data.id;
  if (!verificationId) {
    console.error('[Modives] Could not extract verificationId from response:', JSON.stringify(data));
    throw new Error('Modives did not return a verification ID');
  }
  console.log('[Modives] Verification created:', verificationId);

  return { verificationId: String(verificationId) };
}

/**
 * Get verification detail to retrieve applicantVerificationReqGUIDId
 */
export async function getVerificationDetail(verificationId: string): Promise<{
  applicantVerificationReqGUIDId: string;
  [key: string]: unknown;
}> {
  const token = await getModivesToken();

  console.log('[Modives] Getting verification detail for:', verificationId);

  const response = await fetch(
    `${MODIVES_APIM_URL}/api/app/modives/verification-detail/${verificationId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': MODIVES_SUBSCRIPTION_KEY,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Modives] Get detail failed:', response.status, errorText);
    throw new Error(`Modives get verification detail failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('[Modives] Verification detail retrieved');

  return data;
}

/**
 * Generate consumer magic link
 */
export async function generateMagicLink(applicantVerificationReqGUIDId: string): Promise<string> {
  const token = await getModivesToken();

  console.log('[Modives] Generating magic link for:', applicantVerificationReqGUIDId);

  const response = await fetch(`${MODIVES_APIM_URL}/api/app/modives/consumer-magic-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': MODIVES_SUBSCRIPTION_KEY,
    },
    body: JSON.stringify({
      authKey: MODIVES_AUTH_KEY,
      refKey: applicantVerificationReqGUIDId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Modives] Magic link generation failed:', response.status, errorText);
    throw new Error(`Modives magic link generation failed: ${response.status}`);
  }

  const data = await response.json();
  const magicLinkUrl = data.url || data.magicLink || data;
  console.log('[Modives] Magic link generated');

  return String(magicLinkUrl);
}

/**
 * Get verification results
 */
export async function getVerificationResults(applicantVerificationId: string): Promise<Record<string, unknown>> {
  const token = await getModivesToken();

  console.log('[Modives] Getting results for:', applicantVerificationId);

  const response = await fetch(
    `${MODIVES_APIM_URL}/api/app/modives/verification-results/${applicantVerificationId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': MODIVES_SUBSCRIPTION_KEY,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Modives] Get results failed:', response.status, errorText);
    throw new Error(`Modives get results failed: ${response.status}`);
  }

  const data = await response.json();
  console.log('[Modives] Results retrieved');

  return data;
}

/**
 * Verify webhook signature using HMAC-SHA256
 * Modives sends: modives-signature: t=<timestamp>|s=<base64-encoded hash>
 * signed_payload = {timestamp}|{json_body_trimmed}
 */
export function verifyWebhookSignature(
  timestamp: string,
  jsonBody: string,
  signatureBase64: string
): boolean {
  try {
    const signedPayload = `${timestamp}|${jsonBody.trim()}`;
    const hmac = createHmac('sha256', MODIVES_WEBHOOK_SECRET);
    hmac.update(signedPayload);
    const computedSignature = base64Encode(hmac.digest());

    return computedSignature === signatureBase64;
  } catch (error) {
    console.error('[Modives] Error verifying webhook signature:', error);
    return false;
  }
}

export { MODIVES_DEALER_GUID_ID };
