import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';

// TwiML empty response to acknowledge receipt
const twimlResponse = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse Twilio webhook payload (URL-encoded form data)
    const formData = await req.formData();
    const rawFrom = formData.get('From') as string; // whatsapp:+923074593601
    const rawTo = formData.get('To') as string;     // whatsapp:+447863772592
    const body = formData.get('Body') as string;
    const messageSid = formData.get('MessageSid') as string;

    if (!rawFrom || !rawTo || !messageSid) {
      console.error('[twilio-inbound-whatsapp] Missing required fields:', { rawFrom, rawTo, messageSid });
      return twimlResponse();
    }

    // Strip "whatsapp:" prefix
    const from = rawFrom.replace('whatsapp:', '');
    const to = rawTo.replace('whatsapp:', '');

    console.log(`[twilio-inbound-whatsapp] Received WhatsApp from ${from} to ${to}: "${body?.substring(0, 50)}..."`);

    // Step 1: Identify tenant by matching 'To' number against tenants.twilio_whatsapp_number
    let tenantId: string | null = null;

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('twilio_whatsapp_number', to)
      .single();

    if (tenant) {
      tenantId = tenant.id;
    } else {
      // Try with/without + prefix
      const altTo = to.startsWith('+') ? to.substring(1) : `+${to}`;
      const { data: altTenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('twilio_whatsapp_number', altTo)
        .single();

      if (altTenant) tenantId = altTenant.id;
    }

    if (!tenantId) {
      console.error(`[twilio-inbound-whatsapp] No tenant found for WhatsApp number: ${to}`);
      return twimlResponse();
    }

    // Step 2: Match customer by phone number
    const normalizedFrom = from.startsWith('+') ? from : `+${from}`;
    const fromDigits = normalizedFrom.replace('+', '');

    let { data: customers } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('tenant_id', tenantId)
      .or(`phone.eq.${normalizedFrom},phone.eq.${fromDigits},phone.eq.${from}`);

    // Fuzzy match if no exact match
    if (!customers?.length) {
      const { data: allCustomers } = await supabase
        .from('customers')
        .select('id, name, phone')
        .eq('tenant_id', tenantId)
        .not('phone', 'is', null);

      if (allCustomers?.length) {
        customers = allCustomers.filter((c: any) => {
          if (!c.phone) return false;
          const storedDigits = c.phone.replace(/[^+\d]/g, '');
          return storedDigits === normalizedFrom || storedDigits === `+${fromDigits}` || storedDigits.endsWith(fromDigits);
        });
      }
    }

    const customer = customers?.[0];

    if (customer) {
      // --- Known customer: insert into unified chat thread ---
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
          .insert({ tenant_id: tenantId, customer_id: customer.id })
          .select('id')
          .single();

        if (createError) {
          console.error('[twilio-inbound-whatsapp] Failed to create channel:', createError);
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
          channel: 'whatsapp',
          external_id: messageSid,
          external_status: 'delivered',
          from_number: normalizedFrom,
        });

      if (insertError) {
        console.error('[twilio-inbound-whatsapp] Failed to insert message:', insertError);
      }

      // Update channel
      await supabase
        .from('chat_channels')
        .update({
          last_message_at: new Date().toISOString(),
          last_channel: 'whatsapp',
          updated_at: new Date().toISOString(),
        })
        .eq('id', channelId);

      console.log(`[twilio-inbound-whatsapp] Matched customer ${customer.name} (${customer.id}), saved to channel ${channelId}`);
    } else {
      // --- Unknown number: save to unknown threads ---
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
          console.error('[twilio-inbound-whatsapp] Failed to create unknown thread:', createError);
          return twimlResponse();
        }
        threadId = newThread.id;
      }

      await supabase
        .from('sms_unknown_messages')
        .insert({
          thread_id: threadId,
          direction: 'inbound',
          content: body || '',
          external_id: messageSid,
          external_status: 'delivered',
        });

      console.log(`[twilio-inbound-whatsapp] Unknown number ${normalizedFrom}, saved to thread ${threadId}`);
    }

    return twimlResponse();
  } catch (err: any) {
    console.error('[twilio-inbound-whatsapp] Error:', err);
    return twimlResponse();
  }
});
