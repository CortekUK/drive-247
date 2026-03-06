import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getTenantWhatsAppCredentials,
  sendWhatsAppText,
  normalizeWhatsAppPhone,
} from "../_shared/whatsapp-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { customerPhone, message, tenantId } = await req.json();

    if (!customerPhone || !message) {
      return errorResponse('customerPhone and message are required', 400);
    }

    if (!tenantId) {
      return errorResponse('tenantId is required', 400);
    }

    // Get tenant's WhatsApp credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const creds = await getTenantWhatsAppCredentials(supabase, tenantId);
    if (!creds.isConfigured) {
      return errorResponse('WhatsApp not configured for this tenant', 400);
    }

    const phone = normalizeWhatsAppPhone(customerPhone);

    console.log(`Sending signing WhatsApp to ${phone}`);
    const result = await sendWhatsAppText(creds, phone, message);

    if (!result.success) {
      console.error('WhatsApp send error:', result.error);
      return errorResponse(result.error || 'Failed to send WhatsApp message', 500);
    }

    console.log('WhatsApp sent, messageId:', result.messageId);
    return jsonResponse({ success: true, messageId: result.messageId });
  } catch (error: any) {
    console.error('Send signing WhatsApp error:', error);
    return errorResponse(error.message || 'Internal error', 500);
  }
});
