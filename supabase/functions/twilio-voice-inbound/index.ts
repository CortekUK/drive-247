import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';

/**
 * twilio-voice-inbound
 *
 * Called by Twilio when a customer calls the tenant's phone number.
 * Matches the tenant by the called number (To), matches the customer by caller number (From),
 * and returns TwiML to ring all online tenant users via browser client AND their forwarding numbers.
 *
 * If call_forwarding_enabled is true, <Number> elements are added alongside <Client> elements
 * so calls ring on both the browser and the user's personal phone simultaneously.
 *
 * If nobody answers within 30s and voicemail is enabled, the caller is prompted to leave a voicemail.
 */

function twimlResponse(twiml: string): Response {
  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
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
    const from = formData.get('From') as string; // Customer's phone number
    const to = formData.get('To') as string; // Tenant's phone number

    console.log(`[twilio-voice-inbound] CallSid=${callSid} From=${from} To=${to}`);

    if (!from || !to) {
      console.error('[twilio-voice-inbound] Missing From or To');
      return twimlResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, we could not process your call.</Say></Response>'
      );
    }

    // Step 1: Identify tenant by matching To number
    let tenant: any = null;

    const { data: directMatch } = await supabase
      .from('tenants')
      .select('id, company_name, call_forwarding_enabled, voicemail_enabled, voicemail_greeting_url, forwarding_number, call_recording_enabled')
      .eq('twilio_phone_number', to)
      .eq('twilio_voice_enabled', true)
      .single();

    if (directMatch) {
      tenant = directMatch;
    } else {
      // Try normalized variant
      const altTo = to.startsWith('+') ? to.substring(1) : `+${to}`;
      const { data: altMatch } = await supabase
        .from('tenants')
        .select('id, company_name, call_forwarding_enabled, voicemail_enabled, voicemail_greeting_url, forwarding_number, call_recording_enabled')
        .eq('twilio_phone_number', altTo)
        .eq('twilio_voice_enabled', true)
        .single();

      tenant = altMatch;
    }

    if (!tenant) {
      console.error(`[twilio-voice-inbound] No voice-enabled tenant found for number: ${to}`);
      return twimlResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not configured to receive calls.</Say></Response>'
      );
    }

    // Step 2: Match customer by From number
    const normalizedFrom = (from.startsWith('+') ? from : `+${from}`).replace(/[^+\d]/g, '');
    const fromDigitsOnly = normalizedFrom.replace('+', '');

    let customerId: string | null = null;
    let channelId: string | null = null;

    const { data: customers } = await supabase
      .from('customers')
      .select('id')
      .eq('tenant_id', tenant.id)
      .or(`phone.eq.${normalizedFrom},phone.eq.${fromDigitsOnly},phone.eq.${from}`);

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
          return storedDigits === normalizedFrom || storedDigits === `+${fromDigitsOnly}` || storedDigits.endsWith(fromDigitsOnly);
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

    // Step 3: Get all active tenant users to ring (with forwarding numbers)
    // Include both tenant users AND super admins (who have tenant_id = NULL but can access any tenant)
    const { data: tenantUsers } = await supabase
      .from('app_users')
      .select('id, role, forwarding_number')
      .eq('tenant_id', tenant.id)
      .in('role', ['head_admin', 'admin', 'manager', 'ops'])
      .eq('is_active', true);

    const { data: superAdmins } = await supabase
      .from('app_users')
      .select('id, role, forwarding_number')
      .eq('is_super_admin', true)
      .eq('is_active', true);

    const appUsers = [...(tenantUsers || []), ...(superAdmins || [])];

    if (!appUsers.length) {
      console.error(`[twilio-voice-inbound] No active users for tenant ${tenant.id}`);

      // If voicemail is enabled, go straight to voicemail
      if (tenant.voicemail_enabled) {
        return twimlResponse(buildVoicemailTwiml(supabaseUrl, tenant, callSid));
      }

      return twimlResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, no one is available to take your call right now. Please try again later.</Say></Response>'
      );
    }

    // Step 4: Log the inbound call
    const { error: logError } = await supabase
      .from('call_logs')
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
        channel_id: channelId,
        caller_type: 'customer',
        caller_id: customerId,
        direction: 'inbound',
        status: 'ringing',
        twilio_call_sid: callSid,
        from_number: normalizedFrom,
        to_number: to,
        started_at: new Date().toISOString(),
      });

    if (logError) {
      console.error('[twilio-voice-inbound] Failed to log call:', logError);
    }

    // Step 5: Build TwiML to ring all tenant users
    // Browser clients via <Client> elements
    const clientElements = appUsers
      .map((u: any) => `    <Client>tenant_${u.id}</Client>`)
      .join('\n');

    // Phone forwarding via <Number> elements (if enabled)
    let numberElements = '';
    if (tenant.call_forwarding_enabled) {
      const allNumbers: string[] = [];
      // Normalize the Twilio number for comparison to prevent call loops
      const twilioDigits = to.replace(/[^+\d]/g, '');

      const isSameAsTwilio = (num: string) => {
        const digits = num.replace(/[^+\d]/g, '');
        return digits === twilioDigits || digits.endsWith(twilioDigits.replace('+', '')) || twilioDigits.endsWith(digits.replace('+', ''));
      };

      // Tenant-level forwarding number (main business phone / solo operator)
      if (tenant.forwarding_number && !isSameAsTwilio(tenant.forwarding_number)) {
        allNumbers.push(tenant.forwarding_number);
      }

      // Per-user forwarding numbers
      appUsers
        .filter((u: any) => u.forwarding_number && !isSameAsTwilio(u.forwarding_number))
        .forEach((u: any) => {
          // Avoid duplicates if tenant number matches a user's number
          if (!allNumbers.includes(u.forwarding_number)) {
            allNumbers.push(u.forwarding_number);
          }
        });

      if (allNumbers.length > 0) {
        numberElements = '\n' + allNumbers
          .map((num) => `    <Number statusCallback="${supabaseUrl}/functions/v1/twilio-voice-status">${num}</Number>`)
          .join('\n');
        console.log(`[twilio-voice-inbound] Forwarding to ${allNumbers.length} phone numbers`);
      }
    }

    // Build the TwiML
    const statusCallbackUrl = `${supabaseUrl}/functions/v1/twilio-voice-status`;
    const recordingCallbackUrl = `${supabaseUrl}/functions/v1/process-call-recording`;

    // Recording attributes for <Dial> if call recording is enabled
    const recordAttrs = tenant.call_recording_enabled
      ? ` record="record-from-answer" recordingStatusCallback="${recordingCallbackUrl}" recordingStatusCallbackMethod="POST"`
      : '';

    // Consent announcement before connecting (only if recording enabled)
    const consentSay = tenant.call_recording_enabled
      ? '<Say>This call may be recorded for quality and training purposes.</Say>'
      : '';

    let fallbackTwiml: string;

    if (tenant.voicemail_enabled) {
      const voicemailAction = `${supabaseUrl}/functions/v1/twilio-voicemail-handler?tenantId=${tenant.id}&amp;callSid=${callSid}&amp;from=${encodeURIComponent(normalizedFrom)}&amp;to=${encodeURIComponent(to)}&amp;customerId=${customerId || ''}&amp;channelId=${channelId || ''}`;

      fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${consentSay}
  <Dial timeout="30" action="${voicemailAction}"${recordAttrs}>
${clientElements}${numberElements}
  </Dial>
</Response>`;
    } else {
      fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${consentSay}
  <Dial timeout="30" action="${statusCallbackUrl}"${recordAttrs}>
${clientElements}${numberElements}
  </Dial>
  <Say>Sorry, no one is available to take your call right now. Please try again later.</Say>
</Response>`;
    }

    const forwardCount = tenant.call_forwarding_enabled
      ? appUsers.filter((u: any) => u.forwarding_number).length
      : 0;
    console.log(`[twilio-voice-inbound] Ringing ${appUsers.length} browser clients + ${forwardCount} phones for ${tenant.company_name} (voicemail: ${tenant.voicemail_enabled ? 'on' : 'off'})`);

    return twimlResponse(fallbackTwiml);
  } catch (err: any) {
    console.error('[twilio-voice-inbound] Error:', err);
    return twimlResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred. Please try again later.</Say></Response>'
    );
  }
});

/**
 * Build TwiML for voicemail-only scenario (no users available)
 */
function buildVoicemailTwiml(supabaseUrl: string, tenant: any, callSid: string): string {
  const greeting = tenant.voicemail_greeting_url
    ? `<Play>${tenant.voicemail_greeting_url}</Play>`
    : `<Say>You've reached ${tenant.company_name || 'us'}. No one is available right now. Please leave a message after the beep.</Say>`;

  const recordAction = `${supabaseUrl}/functions/v1/twilio-voicemail-handler?tenantId=${tenant.id}&amp;callSid=${callSid}&amp;action=save`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${greeting}
  <Record maxLength="120" action="${recordAction}" playBeep="true" />
  <Say>We did not receive your message. Goodbye.</Say>
</Response>`;
}
