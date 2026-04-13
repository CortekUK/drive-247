import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';

/**
 * twilio-voice-connect
 *
 * Called by Twilio when a browser client (via TwiML App) initiates an outbound call.
 * Twilio sends form-encoded data including CallSid, AccountSid, To (customer phone),
 * and custom parameters from the browser client.
 *
 * Returns TwiML that dials the customer's phone number using the tenant's caller ID.
 */

function twimlResponse(twiml: string): Response {
  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function twimlError(message: string): Response {
  return twimlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${message}</Say></Response>`
  );
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse Twilio form data
    const formData = await req.formData();
    const callSid = formData.get('CallSid') as string;
    const accountSid = formData.get('AccountSid') as string;
    const from = formData.get('From') as string; // Browser client identity (e.g., "client:tenant_xxx")
    const to = formData.get('To') as string; // Customer phone number passed from browser

    console.log(`[twilio-voice-connect] CallSid=${callSid} AccountSid=${accountSid} From=${from} To=${to}`);

    if (!to) {
      console.error('[twilio-voice-connect] Missing To parameter');
      return twimlError('No phone number specified.');
    }

    if (!accountSid) {
      console.error('[twilio-voice-connect] Missing AccountSid');
      return twimlError('Configuration error.');
    }

    // Identify tenant by Twilio Account SID (BYO)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, twilio_phone_number, call_recording_enabled')
      .eq('twilio_account_sid', accountSid)
      .single();

    if (tenantError || !tenant) {
      console.error(`[twilio-voice-connect] No tenant found for AccountSid ${accountSid}:`, tenantError);
      return twimlError('Tenant not found.');
    }

    const callerNumber = tenant.twilio_phone_number;
    if (!callerNumber) {
      console.error(`[twilio-voice-connect] Tenant ${tenant.id} has no phone number`);
      return twimlError('No caller ID configured.');
    }

    // Extract the app_user_id from the client identity (format: "client:tenant_{uuid}")
    let callerId: string | null = null;
    if (from && from.startsWith('client:tenant_')) {
      callerId = from.replace('client:tenant_', '');
    }

    // Try to match customer by phone number
    const normalizedTo = (to.startsWith('+') ? to : `+${to}`).replace(/[^+\d]/g, '');
    const toDigitsOnly = normalizedTo.replace('+', '');

    let customerId: string | null = null;
    let channelId: string | null = null;

    const { data: customers } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', tenant.id)
      .or(`phone.eq.${normalizedTo},phone.eq.${toDigitsOnly},phone.eq.${to}`);

    if (!customers?.length) {
      // Fuzzy match: strip non-digits from stored phones
      const { data: allCustomers } = await supabase
        .from('customers')
        .select('id, phone')
        .eq('tenant_id', tenant.id)
        .not('phone', 'is', null);

      if (allCustomers?.length) {
        const match = allCustomers.find((c: any) => {
          if (!c.phone) return false;
          const storedDigits = c.phone.replace(/[^+\d]/g, '');
          return storedDigits === normalizedTo || storedDigits === `+${toDigitsOnly}` || storedDigits.endsWith(toDigitsOnly);
        });
        if (match) customerId = match.id;
      }
    } else {
      customerId = customers[0].id;
    }

    // Get chat channel if customer is known
    if (customerId) {
      const { data: channel } = await supabase
        .from('chat_channels')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('customer_id', customerId)
        .single();

      channelId = channel?.id || null;
    }

    // Log the outbound call
    const { error: logError } = await supabase
      .from('call_logs')
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
        channel_id: channelId,
        caller_type: 'tenant',
        caller_id: callerId,
        direction: 'outbound',
        status: 'initiated',
        twilio_call_sid: callSid,
        from_number: callerNumber,
        to_number: normalizedTo,
        started_at: new Date().toISOString(),
      });

    if (logError) {
      console.error('[twilio-voice-connect] Failed to log call:', logError);
      // Don't fail the call — just log the error
    }

    // Recording attributes if call recording is enabled
    const recordingCallbackUrl = `${supabaseUrl}/functions/v1/process-call-recording`;
    const recordAttrs = tenant.call_recording_enabled
      ? ` record="record-from-answer" recordingStatusCallback="${recordingCallbackUrl}" recordingStatusCallbackMethod="POST"`
      : '';
    const consentSay = tenant.call_recording_enabled
      ? '<Say>This call may be recorded for quality and training purposes.</Say>'
      : '';

    // Return TwiML to dial the customer
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${consentSay}
  <Dial callerId="${callerNumber}"${recordAttrs}>
    <Number>${normalizedTo}</Number>
  </Dial>
</Response>`;

    console.log(`[twilio-voice-connect] Dialing ${normalizedTo} with caller ID ${callerNumber}`);
    return twimlResponse(twiml);
  } catch (err: any) {
    console.error('[twilio-voice-connect] Error:', err);
    return twimlError('An error occurred. Please try again.');
  }
});
