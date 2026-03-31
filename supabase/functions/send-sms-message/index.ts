import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { getTenantTwilioCredentials, sendTenantSMS, normalizePhoneNumber } from '../_shared/twilio-sms-client.ts';

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

    // Get app user
    const { data: appUser } = await supabase
      .from('app_users')
      .select('id, tenant_id, role, is_super_admin')
      .eq('auth_user_id', user.id)
      .single();

    if (!appUser) return errorResponse('User not found', 403);

    const { channelId, customerId, content, phoneNumber, tenantId: bodyTenantId, threadId } = await req.json();

    if (!content) return errorResponse('content is required');

    // Resolve tenant
    const tenantId = appUser.tenant_id || (appUser.is_super_admin ? bodyTenantId : null);
    if (!tenantId) return errorResponse('No tenant context', 403);

    // Get Twilio credentials
    const creds = await getTenantTwilioCredentials(supabase, tenantId);
    if (!creds.isConfigured) {
      return errorResponse('Twilio SMS not configured for this tenant. Complete setup in Settings → Integrations.');
    }

    // --- Path A: Send to known customer (via channelId/customerId) ---
    if (channelId && customerId) {
      // Get customer phone number
      const { data: customer } = await supabase
        .from('customers')
        .select('phone')
        .eq('id', customerId)
        .single();

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
          metadata: {},
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
        const { data: thread } = await supabase
          .from('sms_unknown_threads')
          .select('phone_number')
          .eq('id', threadId)
          .single();

        if (!thread) return errorResponse('Unknown thread not found');
        targetPhone = thread.phone_number;
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
