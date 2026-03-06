// Meta WhatsApp Business Cloud API client — per-tenant support
// Each tenant connects their own WhatsApp Business Account via Embedded Signup

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

// Platform-level credentials (env vars — our Facebook App)
const META_APP_ID = () => Deno.env.get('META_WHATSAPP_APP_ID') || '';
const META_APP_SECRET = () => Deno.env.get('META_WHATSAPP_APP_SECRET') || '';
const META_CONFIG_ID = () => Deno.env.get('META_WHATSAPP_CONFIG_ID') || '';

export interface TenantWhatsAppCredentials {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  phoneNumber: string;
  isConfigured: boolean;
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// --- Platform-level functions ---

export function isWhatsAppPlatformConfigured(): boolean {
  return !!(META_APP_ID() && META_APP_SECRET() && META_CONFIG_ID());
}

export function getPlatformWhatsAppConfig() {
  return {
    appId: META_APP_ID(),
    appSecret: META_APP_SECRET(),
    configId: META_CONFIG_ID(),
  };
}

// --- Graph API helper ---

async function graphFetch(
  url: string,
  accessToken: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: Record<string, any>
): Promise<any> {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    console.error('[WhatsApp] Graph API error:', data);
    const errMsg = data?.error?.message || `Graph API error: ${response.status}`;
    throw new Error(errMsg);
  }

  return data;
}

// --- Token exchange (Embedded Signup) ---

export async function exchangeCodeForToken(code: string): Promise<string> {
  const appId = META_APP_ID();
  const appSecret = META_APP_SECRET();

  if (!appId || !appSecret) {
    throw new Error('Meta WhatsApp App credentials not configured');
  }

  const url = `${GRAPH_API_BASE}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`;
  const data = await fetch(url).then(r => r.json());

  if (data.error) {
    throw new Error(data.error.message || 'Failed to exchange code for token');
  }

  return data.access_token;
}

export async function getPhoneNumberDetails(
  phoneNumberId: string,
  accessToken: string
): Promise<{ displayPhoneNumber: string; verifiedName: string }> {
  const data = await graphFetch(
    `${GRAPH_API_BASE}/${phoneNumberId}?fields=display_phone_number,verified_name`,
    accessToken
  );

  return {
    displayPhoneNumber: data.display_phone_number || '',
    verifiedName: data.verified_name || '',
  };
}

export async function subscribeWabaToApp(
  wabaId: string,
  accessToken: string
): Promise<void> {
  await graphFetch(
    `${GRAPH_API_BASE}/${wabaId}/subscribed_apps`,
    accessToken,
    'POST'
  );
}

// --- Per-tenant credential lookup ---

export async function getTenantWhatsAppCredentials(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<TenantWhatsAppCredentials> {
  const { data, error } = await supabaseClient
    .from('tenants')
    .select('meta_whatsapp_access_token, meta_whatsapp_phone_number_id, meta_whatsapp_waba_id, meta_whatsapp_phone_number, integration_whatsapp')
    .eq('id', tenantId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch tenant WhatsApp credentials: ${error.message}`);
  }

  return {
    accessToken: data?.meta_whatsapp_access_token || '',
    phoneNumberId: data?.meta_whatsapp_phone_number_id || '',
    wabaId: data?.meta_whatsapp_waba_id || '',
    phoneNumber: data?.meta_whatsapp_phone_number || '',
    isConfigured: !!data?.integration_whatsapp,
  };
}

// --- Messaging functions ---

export async function sendWhatsAppText(
  credentials: TenantWhatsAppCredentials,
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  if (!credentials.isConfigured || !credentials.accessToken || !credentials.phoneNumberId) {
    return { success: false, error: 'WhatsApp not configured for this tenant' };
  }

  try {
    const data = await graphFetch(
      `${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`,
      credentials.accessToken,
      'POST',
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body },
      }
    );

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err: any) {
    console.error('[WhatsApp] Send text error:', err.message);
    return { success: false, error: err.message };
  }
}

export async function sendWhatsAppTemplate(
  credentials: TenantWhatsAppCredentials,
  to: string,
  templateName: string,
  languageCode: string,
  components: any[]
): Promise<WhatsAppSendResult> {
  if (!credentials.isConfigured || !credentials.accessToken || !credentials.phoneNumberId) {
    return { success: false, error: 'WhatsApp not configured for this tenant' };
  }

  try {
    const data = await graphFetch(
      `${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`,
      credentials.accessToken,
      'POST',
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components,
        },
      }
    );

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err: any) {
    console.error('[WhatsApp] Send template error:', err.message);
    return { success: false, error: err.message };
  }
}

export async function sendWhatsAppImage(
  credentials: TenantWhatsAppCredentials,
  to: string,
  imageUrl: string,
  caption?: string
): Promise<WhatsAppSendResult> {
  if (!credentials.isConfigured || !credentials.accessToken || !credentials.phoneNumberId) {
    return { success: false, error: 'WhatsApp not configured for this tenant' };
  }

  try {
    const imagePayload: any = { link: imageUrl };
    if (caption) imagePayload.caption = caption;

    const data = await graphFetch(
      `${GRAPH_API_BASE}/${credentials.phoneNumberId}/messages`,
      credentials.accessToken,
      'POST',
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'image',
        image: imagePayload,
      }
    );

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err: any) {
    console.error('[WhatsApp] Send image error:', err.message);
    return { success: false, error: err.message };
  }
}

// --- Phone normalization ---

export function normalizeWhatsAppPhone(phone: string, defaultCountryCode = '+44'): string {
  let cleaned = phone.replace(/[^+\d]/g, '');

  if (!cleaned.startsWith('+')) {
    // Strip leading 0 (common in UK numbers: 07xxx -> 7xxx)
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    cleaned = defaultCountryCode + cleaned;
  }

  return cleaned;
}
