import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

// TwiML empty response to acknowledge receipt
const twimlResponse = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Only accept POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse Twilio webhook payload (URL-encoded form data)
    const formData = await req.formData();
    const from = formData.get('From') as string;
    const to = formData.get('To') as string;
    const body = formData.get('Body') as string;
    const messageSid = formData.get('MessageSid') as string;
    const accountSid = formData.get('AccountSid') as string;

    if (!from || !to || !messageSid) {
      console.error('[twilio-inbound-sms] Missing required fields:', { from, to, messageSid });
      return twimlResponse();
    }

    console.log(`[twilio-inbound-sms] Received SMS from ${from} to ${to}: "${body?.substring(0, 50)}..."`);

    // Step 1: Identify tenant by matching 'To' number against tenants.twilio_phone_number
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('twilio_phone_number', to)
      .single();

    if (tenantError || !tenant) {
      // Also try with normalized variants (with/without +)
      const altTo = to.startsWith('+') ? to.substring(1) : `+${to}`;
      const { data: altTenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('twilio_phone_number', altTo)
        .single();

      if (!altTenant) {
        console.error(`[twilio-inbound-sms] No tenant found for number: ${to}`);
        return twimlResponse();
      }

      // Use alt tenant
      return await processInboundSms(supabase, altTenant.id, from, body, messageSid);
    }

    return await processInboundSms(supabase, tenant.id, from, body, messageSid);
  } catch (err: any) {
    console.error('[twilio-inbound-sms] Error:', err);
    return twimlResponse();
  }
});

async function processInboundSms(
  supabase: any,
  tenantId: string,
  from: string,
  body: string,
  messageSid: string
): Promise<Response> {
  // Step 2: Try to match 'From' number against customers.phone
  // Normalize phone: try with and without + prefix, and partial matches
  const normalizedFrom = from.startsWith('+') ? from : `+${from}`;
  const fromWithout = from.startsWith('+') ? from.substring(1) : from;

  // Search for customer by phone number (multiple formats)
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone')
    .eq('tenant_id', tenantId)
    .or(`phone.eq.${normalizedFrom},phone.eq.${fromWithout},phone.eq.${from}`);

  const customer = customers?.[0];

  if (customer) {
    // --- Known customer: insert into unified chat thread ---

    // Get or create chat channel
    let channelId: string;
    const { data: existingChannel } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customer.id)
      .single();

    if (existingChannel) {
      channelId = existingChannel.id;
    } else {
      const { data: newChannel, error: createError } = await supabase
        .from('chat_channels')
        .insert({
          tenant_id: tenantId,
          customer_id: customer.id,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[twilio-inbound-sms] Failed to create channel:', createError);
        return twimlResponse();
      }
      channelId = newChannel.id;
    }

    // Insert message
    const { error: insertError } = await supabase
      .from('chat_channel_messages')
      .insert({
        channel_id: channelId,
        sender_type: 'customer',
        sender_id: customer.id,
        content: body || '',
        channel: 'sms',
        external_id: messageSid,
        external_status: 'delivered',
        from_number: normalizedFrom,
      });

    if (insertError) {
      console.error('[twilio-inbound-sms] Failed to insert message:', insertError);
    }

    // Update channel last_message_at and last_channel
    await supabase
      .from('chat_channels')
      .update({
        last_message_at: new Date().toISOString(),
        last_channel: 'sms',
        updated_at: new Date().toISOString(),
      })
      .eq('id', channelId);

    console.log(`[twilio-inbound-sms] Matched customer ${customer.name} (${customer.id}), saved to channel ${channelId}`);
  } else {
    // --- Unknown number: create/update unknown thread ---
    const { data: existingThread } = await supabase
      .from('sms_unknown_threads')
      .select('id, message_count')
      .eq('tenant_id', tenantId)
      .eq('phone_number', normalizedFrom)
      .single();

    let threadId: string;

    if (existingThread) {
      threadId = existingThread.id;
      await supabase
        .from('sms_unknown_threads')
        .update({
          last_message_at: new Date().toISOString(),
          message_count: (existingThread.message_count || 0) + 1,
        })
        .eq('id', threadId);
    } else {
      const { data: newThread, error: createError } = await supabase
        .from('sms_unknown_threads')
        .insert({
          tenant_id: tenantId,
          phone_number: normalizedFrom,
          last_message_at: new Date().toISOString(),
          message_count: 1,
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[twilio-inbound-sms] Failed to create unknown thread:', createError);
        return twimlResponse();
      }
      threadId = newThread.id;
    }

    // Insert into unknown messages
    await supabase
      .from('sms_unknown_messages')
      .insert({
        thread_id: threadId,
        direction: 'inbound',
        content: body || '',
        external_id: messageSid,
        external_status: 'delivered',
      });

    console.log(`[twilio-inbound-sms] Unknown number ${normalizedFrom}, saved to thread ${threadId}`);
  }

  return twimlResponse();
}
