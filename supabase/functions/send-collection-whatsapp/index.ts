import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

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
    .replace(/\{\{notes\}\}/g, data.notes || '');
}

function buildDynamicSections(data: CollectionWhatsAppRequest): string {
  let sections = '';

  if (data.lockboxCode) {
    sections += `\n\n🔑 *Lockbox Code:* ${data.lockboxCode}`;
    if (data.lockboxInstructions) sections += `\n${data.lockboxInstructions}`;
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

    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_WHATSAPP_NUMBER = Deno.env.get('TWILIO_WHATSAPP_NUMBER');

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
      console.error('Twilio WhatsApp credentials not configured');
      return errorResponse('Twilio WhatsApp credentials not configured', 500);
    }

    if (!data.customerPhone) {
      return errorResponse('Customer phone number is required', 400);
    }

    // Build message — use custom template if available, otherwise default
    let message = buildDefaultMessage(data);

    if (data.tenantId) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // Check for custom WhatsApp template, fall back to SMS template
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
          // Append dynamic sections not covered by template variables
          message += buildDynamicSections(data);
          console.log('Using custom template (channel:', customTemplate === whatsappTemplate ? 'whatsapp' : 'sms', ')');
        }
      } catch (templateError) {
        console.warn('Error loading templates, using default:', templateError);
      }
    }

    // Truncate message if over WhatsApp 4096-char limit
    if (message.length > 4096) {
      message = message.substring(0, 4093) + '...';
    }

    // Normalize phone number
    let phone = data.customerPhone.replace(/[^+\d]/g, '');
    if (!phone.startsWith('+')) {
      phone = '+44' + phone; // Default UK prefix
    }

    // Build Twilio request
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams();
    params.append('To', `whatsapp:${phone}`);
    params.append('From', `whatsapp:${TWILIO_WHATSAPP_NUMBER}`);
    params.append('Body', message);

    // Add photo MediaUrls (Twilio supports up to 10)
    const photoUrls = (data.photoUrls || []).slice(0, 10);
    photoUrls.forEach((url) => {
      params.append('MediaUrl', url);
    });

    console.log(`Sending WhatsApp to ${phone} with ${photoUrls.length} photos`);

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error('Twilio WhatsApp error:', result);
      return errorResponse(result.message || 'Failed to send WhatsApp message', 500);
    }

    console.log('WhatsApp sent successfully, SID:', result.sid);

    return jsonResponse({
      success: true,
      messageId: result.sid,
      status: result.status,
    });
  } catch (error: any) {
    console.error('Error sending collection WhatsApp:', error);
    return errorResponse(error.message || 'Internal server error', 500);
  }
});
