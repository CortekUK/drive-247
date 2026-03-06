// Twilio SMS Client — per-tenant subaccount support
// Parent account creates subaccounts; each tenant gets its own SID + auth token

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

// Parent account credentials (env vars)
const PARENT_ACCOUNT_SID = () => Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const PARENT_AUTH_TOKEN = () => Deno.env.get('TWILIO_AUTH_TOKEN') || '';

export interface TenantTwilioCredentials {
  sid: string;
  authToken: string;
  phoneNumber: string;
  phoneNumberSid: string | null;
  isConfigured: boolean;
}

/**
 * Build Basic Auth header for Twilio API
 */
function twilioAuth(accountSid: string, authToken: string): string {
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}

/**
 * Make a Twilio API request
 */
async function twilioFetch(
  url: string,
  accountSid: string,
  authToken: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, string>
): Promise<any> {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': twilioAuth(accountSid, authToken),
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
  };

  if (body) {
    options.body = new URLSearchParams(body).toString();
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    console.error('[Twilio] API error:', data);
    throw new Error(data.message || `Twilio API error: ${response.status}`);
  }

  return data;
}

// --- Parent account operations ---

/**
 * Check if parent Twilio credentials are configured
 */
export function isParentTwilioConfigured(): boolean {
  return !!(PARENT_ACCOUNT_SID() && PARENT_AUTH_TOKEN());
}

/**
 * Create a Twilio subaccount under the parent account
 */
export async function createTwilioSubaccount(friendlyName: string): Promise<{
  sid: string;
  authToken: string;
  friendlyName: string;
}> {
  const parentSid = PARENT_ACCOUNT_SID();
  const parentToken = PARENT_AUTH_TOKEN();

  if (!parentSid || !parentToken) {
    throw new Error('Parent Twilio credentials not configured');
  }

  const data = await twilioFetch(
    `${TWILIO_API_BASE}/Accounts.json`,
    parentSid,
    parentToken,
    'POST',
    { FriendlyName: friendlyName }
  );

  return {
    sid: data.sid,
    authToken: data.auth_token,
    friendlyName: data.friendly_name,
  };
}

/**
 * Search available phone numbers by country code
 */
export async function searchAvailableNumbers(
  countryCode: string,
  accountSid: string,
  authToken: string,
  options?: { contains?: string; areaCode?: string; limit?: number }
): Promise<Array<{
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: { sms: boolean; voice: boolean; mms: boolean };
}>> {
  const params = new URLSearchParams();
  if (options?.contains) params.set('Contains', options.contains);
  if (options?.areaCode) params.set('AreaCode', options.areaCode);
  params.set('PageSize', String(options?.limit || 10));
  params.set('SmsEnabled', 'true');

  const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/AvailablePhoneNumbers/${countryCode}/Local.json?${params}`;
  const data = await twilioFetch(url, accountSid, authToken);

  return (data.available_phone_numbers || []).map((n: any) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    locality: n.locality || '',
    region: n.region || '',
    capabilities: {
      sms: n.capabilities?.sms ?? false,
      voice: n.capabilities?.voice ?? false,
      mms: n.capabilities?.mms ?? false,
    },
  }));
}

/**
 * Purchase a phone number for a subaccount
 */
export async function purchasePhoneNumber(
  accountSid: string,
  authToken: string,
  phoneNumber: string
): Promise<{ sid: string; phoneNumber: string; friendlyName: string }> {
  const data = await twilioFetch(
    `${TWILIO_API_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers.json`,
    accountSid,
    authToken,
    'POST',
    { PhoneNumber: phoneNumber }
  );

  return {
    sid: data.sid,
    phoneNumber: data.phone_number,
    friendlyName: data.friendly_name,
  };
}

/**
 * Release a phone number from a subaccount
 */
export async function releasePhoneNumber(
  accountSid: string,
  authToken: string,
  phoneNumberSid: string
): Promise<void> {
  await fetch(
    `${TWILIO_API_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneNumberSid}.json`,
    {
      method: 'DELETE',
      headers: { 'Authorization': twilioAuth(accountSid, authToken) },
    }
  );
}

/**
 * Suspend a Twilio subaccount
 */
export async function suspendSubaccount(
  accountSid: string
): Promise<void> {
  const parentSid = PARENT_ACCOUNT_SID();
  const parentToken = PARENT_AUTH_TOKEN();

  await twilioFetch(
    `${TWILIO_API_BASE}/Accounts/${accountSid}.json`,
    parentSid,
    parentToken,
    'POST',
    { Status: 'suspended' }
  );
}

// --- Per-tenant operations ---

/**
 * Fetch tenant's Twilio credentials from the database
 */
export async function getTenantTwilioCredentials(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<TenantTwilioCredentials> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('twilio_subaccount_sid, twilio_subaccount_auth_token, twilio_phone_number, twilio_phone_number_sid, integration_twilio_sms')
    .eq('id', tenantId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch tenant Twilio credentials: ${error.message}`);
  }

  return {
    sid: data?.twilio_subaccount_sid || '',
    authToken: data?.twilio_subaccount_auth_token || '',
    phoneNumber: data?.twilio_phone_number || '',
    phoneNumberSid: data?.twilio_phone_number_sid || null,
    isConfigured: !!data?.integration_twilio_sms,
  };
}

/**
 * Send SMS using tenant's Twilio subaccount credentials
 */
export async function sendTenantSMS(
  credentials: TenantTwilioCredentials,
  to: string,
  body: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!credentials.isConfigured || !credentials.sid || !credentials.authToken || !credentials.phoneNumber) {
    return { success: false, error: 'Twilio SMS not configured for this tenant' };
  }

  try {
    const data = await twilioFetch(
      `${TWILIO_API_BASE}/Accounts/${credentials.sid}/Messages.json`,
      credentials.sid,
      credentials.authToken,
      'POST',
      {
        To: to,
        From: credentials.phoneNumber,
        Body: body,
      }
    );

    return { success: true, messageId: data.sid };
  } catch (err: any) {
    console.error('[Twilio] SMS send error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Normalize phone number to E.164 format
 * Unlike the old AWS SNS helper, this does NOT assume a default country code.
 * Numbers must already have a country code or be passed with one.
 */
export function normalizePhoneNumber(phone: string): string {
  // Strip everything except digits and leading +
  let cleaned = phone.replace(/[^+\d]/g, '');

  // If no + prefix, assume it's already missing and add it
  if (!cleaned.startsWith('+') && cleaned.length > 10) {
    cleaned = '+' + cleaned;
  }

  return cleaned;
}
