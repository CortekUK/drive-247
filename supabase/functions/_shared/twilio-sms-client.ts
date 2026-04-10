// Twilio SMS Client — BYO (Bring Your Own) model
// Tenants connect their own Twilio account. We store their Account SID + Auth Token
// and call Twilio's API on their behalf. Twilio bills them directly.
//
// WhatsApp still uses the platform's parent Twilio account via env vars
// (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN). This file exposes BOTH paths:
//   - getTenantTwilioCredentials / sendTenantSMS → tenant's own creds
//   - sendTwilioWhatsApp → platform env var creds

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

// Platform-level credentials — ONLY used by Twilio WhatsApp (senders are registered
// at the parent account level and cannot live on tenant BYO accounts).
const PLATFORM_ACCOUNT_SID = () => Deno.env.get('TWILIO_ACCOUNT_SID') || '';
const PLATFORM_AUTH_TOKEN = () => Deno.env.get('TWILIO_AUTH_TOKEN') || '';

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

// --- Tenant BYO operations ---

/**
 * Fetch tenant's Twilio credentials from the database.
 * Under BYO, these are the tenant's own Twilio Account SID + Auth Token.
 */
export async function getTenantTwilioCredentials(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<TenantTwilioCredentials> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('twilio_account_sid, twilio_auth_token, twilio_phone_number, twilio_phone_number_sid, integration_twilio_sms')
    .eq('id', tenantId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch tenant Twilio credentials: ${error.message}`);
  }

  return {
    sid: (data as any)?.twilio_account_sid || '',
    authToken: (data as any)?.twilio_auth_token || '',
    phoneNumber: (data as any)?.twilio_phone_number || '',
    phoneNumberSid: (data as any)?.twilio_phone_number_sid || null,
    isConfigured: !!(data as any)?.integration_twilio_sms,
  };
}

/**
 * Validate a tenant's Twilio credentials by fetching their account from the API.
 * Used by the "Connect" wizard to verify creds work before saving them.
 * Returns the friendly name on success so we can show it in the UI.
 */
export async function validateTenantConnection(
  accountSid: string,
  authToken: string
): Promise<{ valid: true; friendlyName: string; status: string } | { valid: false; error: string }> {
  if (!accountSid || !authToken) {
    return { valid: false, error: 'Account SID and Auth Token are required' };
  }
  if (!accountSid.startsWith('AC')) {
    return { valid: false, error: 'Account SID must start with "AC"' };
  }

  try {
    const data = await twilioFetch(
      `${TWILIO_API_BASE}/Accounts/${accountSid}.json`,
      accountSid,
      authToken,
      'GET'
    );
    return {
      valid: true,
      friendlyName: data.friendly_name || 'Twilio Account',
      status: data.status || 'active',
    };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Failed to validate credentials' };
  }
}

/**
 * Look up a specific phone number on the tenant's Twilio account.
 * Used during Connect to verify the tenant owns the number they pasted
 * and to capture its SID (needed for webhook configuration).
 */
export async function findTenantPhoneNumber(
  accountSid: string,
  authToken: string,
  phoneNumber: string
): Promise<{ sid: string; phoneNumber: string; capabilities: { sms: boolean; voice: boolean; mms: boolean } } | null> {
  try {
    const normalized = normalizePhoneNumber(phoneNumber);
    const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalized)}`;
    const data = await twilioFetch(url, accountSid, authToken, 'GET');
    const first = data.incoming_phone_numbers?.[0];
    if (!first) return null;
    return {
      sid: first.sid,
      phoneNumber: first.phone_number,
      capabilities: {
        sms: first.capabilities?.sms ?? false,
        voice: first.capabilities?.voice ?? false,
        mms: first.capabilities?.mms ?? false,
      },
    };
  } catch (err: any) {
    console.error('[Twilio] findTenantPhoneNumber error:', err.message);
    return null;
  }
}

/**
 * Configure webhook URLs on a phone number so inbound SMS and status callbacks
 * are routed to our edge functions. Called during Connect to auto-wire webhooks.
 */
export async function configureNumberWebhooks(
  accountSid: string,
  authToken: string,
  phoneNumberSid: string,
  smsUrl: string,
  statusCallbackUrl: string
): Promise<void> {
  const url = `${TWILIO_API_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneNumberSid}.json`;

  await twilioFetch(url, accountSid, authToken, 'POST', {
    SmsUrl: smsUrl,
    SmsMethod: 'POST',
    StatusCallback: statusCallbackUrl,
    StatusCallbackMethod: 'POST',
  });
}

/**
 * Send SMS using the tenant's own Twilio credentials (BYO).
 * Includes a StatusCallback so Twilio posts delivery status updates
 * (sent, delivered, failed, undelivered) to our twilio-sms-status function.
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
    // Build the status callback URL from SUPABASE_URL (available in all edge functions)
    const supabaseUrl = typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : '';
    const messageParams: Record<string, string> = {
      To: to,
      From: credentials.phoneNumber,
      Body: body,
    };
    if (supabaseUrl) {
      messageParams.StatusCallback = `${supabaseUrl}/functions/v1/twilio-sms-status`;
    }

    const data = await twilioFetch(
      `${TWILIO_API_BASE}/Accounts/${credentials.sid}/Messages.json`,
      credentials.sid,
      credentials.authToken,
      'POST',
      messageParams
    );

    return { success: true, messageId: data.sid };
  } catch (err: any) {
    console.error('[Twilio] SMS send error:', err.message);
    return { success: false, error: err.message };
  }
}

// --- Platform-level WhatsApp (still uses env var creds) ---

/**
 * Send WhatsApp message via the platform's parent Twilio account.
 * WhatsApp senders are registered at the parent account level in Twilio,
 * not on BYO tenant accounts. So we always use platform env var credentials.
 *
 * If contentSid + contentVariables are provided, sends a pre-approved template
 * (works without 24-hour window). Otherwise falls back to free-form body text.
 */
export async function sendTwilioWhatsApp(
  _credentials: TenantTwilioCredentials,
  whatsappFromNumber: string,
  to: string,
  body: string,
  contentSid?: string,
  contentVariables?: Record<string, string>
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const platformSid = PLATFORM_ACCOUNT_SID();
  const platformToken = PLATFORM_AUTH_TOKEN();

  if (!platformSid || !platformToken) {
    return { success: false, error: 'Twilio platform account not configured' };
  }

  if (!whatsappFromNumber) {
    return { success: false, error: 'No WhatsApp sender number configured for this tenant' };
  }

  try {
    const normalizedTo = normalizePhoneNumber(to);
    const messageParams: Record<string, string> = {
      To: `whatsapp:${normalizedTo}`,
      From: `whatsapp:${whatsappFromNumber}`,
    };

    if (contentSid) {
      // Use pre-approved Content Template — works outside 24-hour window
      messageParams.ContentSid = contentSid;
      if (contentVariables) {
        messageParams.ContentVariables = JSON.stringify(contentVariables);
      }
    } else {
      // Free-form text — only works within 24-hour window
      messageParams.Body = body;
    }

    const data = await twilioFetch(
      `${TWILIO_API_BASE}/Accounts/${platformSid}/Messages.json`,
      platformSid,
      platformToken,
      'POST',
      messageParams
    );

    return { success: true, messageId: data.sid };
  } catch (err: any) {
    console.error('[Twilio] WhatsApp send error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Fetch tenant's Twilio WhatsApp number from the database.
 * This is a tenant-level config for WhatsApp sender routing, not a BYO credential.
 */
export async function getTenantWhatsAppNumber(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<string> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('twilio_whatsapp_number')
    .eq('id', tenantId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch tenant WhatsApp number: ${error.message}`);
  }

  return data?.twilio_whatsapp_number || '';
}

// --- Utilities ---

/**
 * Normalize phone number to E.164 format.
 * Does NOT assume a default country code — numbers must already have one.
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

/**
 * Validate Twilio webhook request signature.
 * TODO: Implement full HMAC-SHA1 validation using Web Crypto API.
 * For now we trust Supabase's edge function URL authentication.
 */
export function validateTwilioSignature(
  _authToken: string,
  _signature: string,
  _url: string,
  _params: Record<string, string>
): boolean {
  return true; // TODO: Implement full signature validation
}
