import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import {
  getTenantTwilioCredentials,
  sendTenantSMS,
  normalizePhoneNumber,
} from '../_shared/twilio-sms-client.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { tenantId, to, body } = await req.json();

    if (!tenantId || !to || !body) {
      return errorResponse('Missing required fields: tenantId, to, body');
    }

    const creds = await getTenantTwilioCredentials(supabase, tenantId);

    if (!creds.isConfigured) {
      console.warn(`[send-tenant-sms] Twilio not configured for tenant ${tenantId}, skipping SMS`);
      return jsonResponse({ success: false, skipped: true, error: 'Twilio SMS not configured for this tenant' });
    }

    const normalized = normalizePhoneNumber(to);
    const result = await sendTenantSMS(creds, normalized, body);

    return jsonResponse(result);
  } catch (err: any) {
    console.error('[send-tenant-sms] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
