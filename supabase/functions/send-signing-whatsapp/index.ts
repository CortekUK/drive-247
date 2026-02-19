import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { customerPhone, message } = await req.json();

    if (!customerPhone || !message) {
      return errorResponse('customerPhone and message are required', 400);
    }

    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
    const TWILIO_WHATSAPP_NUMBER = Deno.env.get('TWILIO_WHATSAPP_NUMBER');

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER) {
      return errorResponse('Twilio WhatsApp credentials not configured', 500);
    }

    // Normalize phone number
    let phone = customerPhone.replace(/[^+\d]/g, '');
    if (!phone.startsWith('+')) {
      phone = '+44' + phone;
    }

    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const params = new URLSearchParams();
    params.append('To', `whatsapp:${phone}`);
    params.append('From', `whatsapp:${TWILIO_WHATSAPP_NUMBER}`);
    params.append('Body', message);

    console.log(`Sending signing WhatsApp to ${phone}`);

    const twilioResponse = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    if (!twilioResponse.ok) {
      const error = await twilioResponse.text();
      console.error('Twilio error:', error);
      return errorResponse(`Twilio error: ${error}`, 500);
    }

    const result = await twilioResponse.json();
    console.log('WhatsApp sent, SID:', result.sid);

    return jsonResponse({ success: true, sid: result.sid });
  } catch (error) {
    console.error('Send signing WhatsApp error:', error);
    return errorResponse(error.message || 'Internal error', 500);
  }
});
