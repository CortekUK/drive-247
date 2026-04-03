import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';

/**
 * twilio-voice-inbound
 *
 * Called by Twilio when a customer calls the tenant's phone number.
 * Matches the tenant by the called number (To), matches the customer by caller number (From),
 * and returns TwiML to ring all online tenant users via browser client.
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
      .select('id, name')
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
        .select('id, name')
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

    // Step 3: Get all active tenant users to ring via browser client
    const { data: appUsers, error: usersError } = await supabase
      .from('app_users')
      .select('id, role')
      .eq('tenant_id', tenant.id)
      .in('role', ['head_admin', 'admin', 'manager', 'ops'])
      .eq('is_active', true);

    if (usersError || !appUsers?.length) {
      console.error(`[twilio-voice-inbound] No active users for tenant ${tenant.id}:`, usersError);
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

    // Step 5: Build TwiML to ring all tenant users' browser clients simultaneously
    // Twilio will ring all <Client> elements in a <Dial> and connect to whichever answers first
    const clientElements = appUsers
      .map((u: any) => `    <Client>tenant_${u.id}</Client>`)
      .join('\n');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30" action="${supabaseUrl}/functions/v1/twilio-voice-status">
${clientElements}
  </Dial>
  <Say>Sorry, no one is available to take your call right now. Please try again later.</Say>
</Response>`;

    console.log(`[twilio-voice-inbound] Ringing ${appUsers.length} tenant users for ${tenant.name}`);
    return twimlResponse(twiml);
  } catch (err: any) {
    console.error('[twilio-voice-inbound] Error:', err);
    return twimlResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred. Please try again later.</Say></Response>'
    );
  }
});
