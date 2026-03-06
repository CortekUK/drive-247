import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getTenantWhatsAppCredentials,
  sendWhatsAppText,
  sendWhatsAppImage,
  normalizeWhatsAppPhone,
} from "../_shared/whatsapp-client.ts";

interface CollectionWhatsAppRequest {
  customerName: string;
  customerPhone: string;
  vehicleName: string;
  vehicleReg: string;
  bookingRef: string;
  lockboxCode?: string | null;
  lockboxInstructions?: string | null;
  deliveryAddress?: string | null;
  odometerReading?: string | null;
  notes?: string | null;
  photoUrls?: string[];
  tenantId?: string;
  defaultInstructions?: string | null;
}

function replaceVars(template: string, data: CollectionWhatsAppRequest): string {
  return template
    .replace(/\{\{customer_name\}\}/g, data.customerName || '')
    .replace(/\{\{vehicle_name\}\}/g, data.vehicleName || '')
    .replace(/\{\{vehicle_reg\}\}/g, data.vehicleReg || '')
    .replace(/\{\{lockbox_code\}\}/g, data.lockboxCode || '')
    .replace(/\{\{lockbox_instructions\}\}/g, data.lockboxInstructions || '')
    .replace(/\{\{delivery_address\}\}/g, data.deliveryAddress || '')
    .replace(/\{\{booking_ref\}\}/g, data.bookingRef || '')
    .replace(/\{\{odometer\}\}/g, data.odometerReading || '')
    .replace(/\{\{notes\}\}/g, data.notes || '')
    .replace(/\{\{default_instructions\}\}/g, data.defaultInstructions || '');
}

function buildDynamicSections(data: CollectionWhatsAppRequest): string {
  let sections = '';

  if (data.lockboxCode) {
    sections += `\n\n🔑 *Lockbox Code:* ${data.lockboxCode}`;
    if (data.lockboxInstructions) sections += `\n${data.lockboxInstructions}`;
  }

  if (data.defaultInstructions) {
    sections += `\n\n📋 *Instructions:*\n${data.defaultInstructions}`;
  }

  if (data.deliveryAddress) {
    sections += `\n\n📍 *Delivery Address:* ${data.deliveryAddress}`;
  }

  if (data.odometerReading) {
    sections += `\n\n🔢 *Odometer Reading:* ${data.odometerReading} miles`;
  }

  if (data.notes) {
    sections += `\n\n📝 *Notes:* ${data.notes}`;
  }

  return sections;
}

function buildDefaultMessage(data: CollectionWhatsAppRequest): string {
  let msg = `*Vehicle Collection Confirmation*\n\nHi ${data.customerName},\n\nYour vehicle *${data.vehicleName}* (${data.vehicleReg}) has been collected.\n\nBooking Ref: ${data.bookingRef}`;
  msg += buildDynamicSections(data);
  return msg;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const data: CollectionWhatsAppRequest = await req.json();
    console.log('Sending collection WhatsApp for:', data.bookingRef);

    if (!data.customerPhone) {
      return errorResponse('Customer phone number is required', 400);
    }

    if (!data.tenantId) {
      return errorResponse('tenantId is required', 400);
    }

    // Get tenant's WhatsApp credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const creds = await getTenantWhatsAppCredentials(supabase, data.tenantId);
    if (!creds.isConfigured) {
      return errorResponse('WhatsApp not configured for this tenant', 400);
    }

    const phone = normalizeWhatsAppPhone(data.customerPhone);

    // Build message — check for custom template first
    let message = buildDefaultMessage(data);

    try {
      const { data: templates } = await supabase
        .from('lockbox_templates')
        .select('channel, body, is_active')
        .eq('tenant_id', data.tenantId)
        .eq('is_active', true)
        .in('channel', ['whatsapp', 'sms']);

      const whatsappTemplate = templates?.find((t: any) => t.channel === 'whatsapp');
      const smsTemplate = templates?.find((t: any) => t.channel === 'sms');
      const customTemplate = whatsappTemplate || smsTemplate;

      if (customTemplate?.body) {
        message = replaceVars(customTemplate.body, data);
        message += buildDynamicSections(data);
        console.log('Using custom template (channel:', customTemplate === whatsappTemplate ? 'whatsapp' : 'sms', ')');
      }
    } catch (templateError) {
      console.warn('Error loading templates, using default:', templateError);
    }

    // Truncate if over WhatsApp 4096-char limit
    if (message.length > 4096) {
      message = message.substring(0, 4093) + '...';
    }

    // Send main text message
    console.log(`Sending WhatsApp text to ${phone}`);
    const textResult = await sendWhatsAppText(creds, phone, message);

    if (!textResult.success) {
      return errorResponse(textResult.error || 'Failed to send WhatsApp message', 500);
    }

    // Send photos as separate image messages
    const photoUrls = (data.photoUrls || []).slice(0, 10);
    if (photoUrls.length > 0) {
      console.log(`Sending ${photoUrls.length} photo(s) via WhatsApp`);
      for (let i = 0; i < photoUrls.length; i++) {
        try {
          const caption = photoUrls.length > 1 ? `Vehicle photo ${i + 1}/${photoUrls.length}` : undefined;
          await sendWhatsAppImage(creds, phone, photoUrls[i], caption);
        } catch (photoErr: any) {
          console.warn(`[WhatsApp] Failed to send photo ${i + 1}:`, photoErr.message);
        }
      }
    }

    console.log('WhatsApp sent successfully, messageId:', textResult.messageId);

    return jsonResponse({
      success: true,
      messageId: textResult.messageId,
    });
  } catch (error: any) {
    console.error('Error sending collection WhatsApp:', error);
    return errorResponse(error.message || 'Internal server error', 500);
  }
});
