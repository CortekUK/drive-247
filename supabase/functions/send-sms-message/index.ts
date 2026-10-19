import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getTenantTwilioCredentials, sendTenantSMS, normalizePhoneNumber } from '../_shared/twilio-sms-client.ts';
import { resolveStaffSender, loadOwnedConversation, loadOwnedUnknownThread } from '../_shared/conversation-ownership.ts';

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('Missing authorization', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return errorResponse('Unauthorized', 401);

    /* `metadata` is optional and new. Older clients omit it and the row is
       written with {} exactly as before. */
    const {
      channelId, customerId, content, phoneNumber, tenantId: bodyTenantId, threadId, metadata,
    } = await req.json();

    if (!content) return errorResponse('content is required');

    // Resolve the caller's tenant. Everything below is pinned to it: a staff
    // user may only message their own tenant's customers and threads.
    const sender = await resolveStaffSender(supabase, user.id, bodyTenantId);
    if (!sender.ok) return errorResponse(sender.message, sender.status);
    const { appUser, tenantId } = sender;

    // Get Twilio credentials
    const creds = await getTenantTwilioCredentials(supabase, tenantId);
    if (!creds.isConfigured) {
      return errorResponse('Twilio SMS not configured for this tenant. Complete setup in Settings → Integrations.');
    }

    // --- Path A: Send to known customer (via channelId/customerId) ---
    if (channelId && customerId) {
      const owned = await loadOwnedConversation<{ phone: string | null }>(supabase, tenantId, customerId, channelId, 'phone');
      if (!owned.ok) return errorResponse(owned.message, owned.status);
      const customer = owned.customer;

      if (!customer?.phone) {
        return errorResponse('Customer has no phone number on file');
      }

      const normalizedPhone = normalizePhoneNumber(customer.phone);

      // Send via Twilio
      const smsResult = await sendTenantSMS(creds, normalizedPhone, content);
      if (!smsResult.success) {
        return errorResponse(`SMS send failed: ${smsResult.error}`);
      }

      // Insert message into chat_channel_messages
      const { data: message, error: insertError } = await supabase
        .from('chat_channel_messages')
        .insert({
          channel_id: channelId,
          sender_type: 'tenant',
          sender_id: appUser.id,
          content,
          channel: 'sms',
          external_id: smsResult.messageId,
          external_status: 'queued',
          /* Was hardcoded {}, which silently dropped a booking reference the
             composer had already accepted and shown. */
          metadata: metadata && typeof metadata === 'object' ? metadata : {},
        })
        .select()
        .single();

      if (insertError) {
        console.error('[send-sms-message] DB insert error:', insertError);
        return errorResponse('SMS sent but failed to save to database');
      }

      // Update channel's last_message_at and last_channel
      await supabase
        .from('chat_channels')
        .update({
          last_message_at: message.created_at,
          last_channel: 'sms',
          updated_at: new Date().toISOString(),
        })
        .eq('id', channelId);

      return jsonResponse({
        success: true,
        messageId: message.id,
        twilioSid: smsResult.messageId,
      });
    }

    // --- Path B: Send to unknown thread (via threadId or raw phoneNumber) ---
    if (threadId || phoneNumber) {
      let targetPhone = phoneNumber;

      if (threadId) {
        const owned = await loadOwnedUnknownThread(supabase, tenantId, threadId);
        if (!owned.ok) return errorResponse(owned.message, owned.status);
        targetPhone = owned.thread.phone_number;
      }

      if (!targetPhone) return errorResponse('No phone number to send to');

      const normalizedPhone = normalizePhoneNumber(targetPhone);

      // Send via Twilio
      const smsResult = await sendTenantSMS(creds, normalizedPhone, content);
      if (!smsResult.success) {
        return errorResponse(`SMS send failed: ${smsResult.error}`);
      }

      // Insert into unknown messages table
      const resolvedThreadId = threadId;
      if (resolvedThreadId) {
        await supabase
          .from('sms_unknown_messages')
          .insert({
            thread_id: resolvedThreadId,
            direction: 'outbound',
            sender_id: appUser.id,
            content,
            external_id: smsResult.messageId,
            external_status: 'queued',
          });

        // Update thread timestamp
        await supabase
          .from('sms_unknown_threads')
          .update({
            last_message_at: new Date().toISOString(),
          })
          .eq('id', resolvedThreadId);
      }

      return jsonResponse({
        success: true,
        twilioSid: smsResult.messageId,
      });
    }

    return errorResponse('Either channelId+customerId or threadId/phoneNumber is required');
  } catch (err: any) {
    console.error('[send-sms-message] Error:', err);
    return errorResponse(err.message || 'Internal error', 500);
  }
});
