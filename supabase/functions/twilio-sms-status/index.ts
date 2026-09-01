import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';

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

    // Parse Twilio status callback (URL-encoded form data)
    const formData = await req.formData();
    const messageSid = formData.get('MessageSid') as string;
    const messageStatus = formData.get('MessageStatus') as string;
    const errorCode = formData.get('ErrorCode') as string | null;
    const errorMessage = formData.get('ErrorMessage') as string | null;

    if (!messageSid || !messageStatus) {
      return new Response('OK', { status: 200 });
    }

    console.log(`[twilio-sms-status] ${messageSid}: ${messageStatus}`);

    // Map Twilio status to our status enum
    const statusMap: Record<string, string> = {
      queued: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      failed: 'failed',
      undelivered: 'undelivered',
    };

    const normalizedStatus = statusMap[messageStatus] || messageStatus;

    // Update chat_channel_messages where external_id matches
    const { data: updated, error: updateError } = await supabase
      .from('chat_channel_messages')
      .update({ external_status: normalizedStatus })
      .eq('external_id', messageSid)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[twilio-sms-status] Failed to update message:', updateError);
    }

    // Also try updating unknown messages
    if (!updated) {
      await supabase
        .from('sms_unknown_messages')
        .update({ external_status: normalizedStatus })
        .eq('external_id', messageSid);
    }

    // Log to sms_message_log for audit trail
    const rawPayload: Record<string, string> = {};
    formData.forEach((value, key) => {
      rawPayload[key] = value as string;
    });

    await supabase
      .from('sms_message_log')
      .insert({
        message_id: updated?.id || null,
        twilio_sid: messageSid,
        status: normalizedStatus,
        error_code: errorCode,
        error_message: errorMessage,
        raw_payload: rawPayload,
      });

    return new Response('OK', { status: 200 });
  } catch (err: any) {
    console.error('[twilio-sms-status] Error:', err);
    return new Response('OK', { status: 200 }); // Always return 200 to Twilio
  }
});
