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

    // Normalize phone number
    let phone = data.customerPhone.replace(/[^+\d]/g, '');
    if (!phone.startsWith('+')) {
      phone = '+44' + phone; // Default UK prefix
    }

    // Check for Content Template (WhatsApp Business API production mode)
    const CONTENT_SID = Deno.env.get('TWILIO_WHATSAPP_CONTENT_SID');

    // Build Twilio request
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams();
    params.append('To', `whatsapp:${phone}`);
    params.append('From', `whatsapp:${TWILIO_WHATSAPP_NUMBER}`);

    // Add photo MediaUrls (Twilio supports up to 10)
    const photoUrls = (data.photoUrls || []).slice(0, 10);
    photoUrls.forEach((url) => {
      params.append('MediaUrl', url);
    });

    if (CONTENT_SID) {
      // Production mode — use Meta-approved Content Template
      // Build combined extras for {{7}}
      const extras: string[] = [];
      if (data.lockboxInstructions) extras.push(`📌 ${data.lockboxInstructions}`);
      if (data.defaultInstructions) extras.push(`📋 Instructions:\n${data.defaultInstructions}`);
      if (data.odometerReading) extras.push(`🔢 Odometer: ${data.odometerReading} miles`);
      if (data.notes) extras.push(`📝 Notes: ${data.notes}`);

      const contentVariables = JSON.stringify({
        '1': data.customerName || '',
        '2': data.vehicleName || '',
        '3': data.vehicleReg || '',
        '4': data.lockboxCode || 'N/A',
        '5': data.deliveryAddress || 'See booking details',
        '6': data.bookingRef || '',
        '7': extras.join('\n\n') || '',
      });

      params.append('ContentSid', CONTENT_SID);
      params.append('ContentVariables', contentVariables);
      console.log(`Sending WhatsApp (Content Template) to ${phone} with ${photoUrls.length} photos`);
    } else {
      // Sandbox mode — use free-form Body
      let message = buildDefaultMessage(data);

      if (data.tenantId) {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      }

      // Truncate if over WhatsApp 4096-char limit
      if (message.length > 4096) {
        message = message.substring(0, 4093) + '...';
      }

      params.append('Body', message);
      console.log(`Sending WhatsApp (Sandbox) to ${phone} with ${photoUrls.length} photos`);
    }

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
