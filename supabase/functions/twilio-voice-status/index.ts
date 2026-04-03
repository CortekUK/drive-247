import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';

/**
 * twilio-voice-status
 *
 * Status callback for Twilio voice calls. Updates call_logs with status changes
 * and logs completed calls into chat_channel_messages for the conversation thread.
 *
 * Twilio sends: CallSid, CallStatus, CallDuration, AccountSid, From, To, etc.
 * CallStatus values: initiated, ringing, in-progress, completed, busy, no-answer, canceled, failed
 */

// TwiML empty response — Twilio expects a 200 for status callbacks
function emptyResponse(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
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
    const callStatus = formData.get('CallStatus') as string;
    const callDuration = formData.get('CallDuration') as string; // seconds, only on completed
    const accountSid = formData.get('AccountSid') as string;
    const from = formData.get('From') as string;
    const to = formData.get('To') as string;
    const timestamp = formData.get('Timestamp') as string;

    console.log(`[twilio-voice-status] CallSid=${callSid} Status=${callStatus} Duration=${callDuration || 'n/a'}`);

    if (!callSid || !callStatus) {
      console.error('[twilio-voice-status] Missing CallSid or CallStatus');
      return emptyResponse();
    }

    // Find the existing call log by twilio_call_sid
    const { data: callLog, error: findError } = await supabase
      .from('call_logs')
      .select('id, tenant_id, customer_id, channel_id, caller_id, direction, from_number, to_number')
      .eq('twilio_call_sid', callSid)
      .single();

    if (findError || !callLog) {
      // Call might not have been logged yet (e.g., if connect/inbound had an issue)
      // Try to create a minimal log entry if we can identify the tenant
      if (accountSid) {
        const { data: tenant } = await supabase
          .from('tenants')
          .select('id')
          .eq('twilio_subaccount_sid', accountSid)
          .single();

        if (tenant) {
          const { error: insertError } = await supabase
            .from('call_logs')
            .insert({
              tenant_id: tenant.id,
              caller_type: 'tenant', // default, may not be accurate
              direction: 'outbound', // default
              status: callStatus,
              duration_seconds: callDuration ? parseInt(callDuration, 10) : 0,
              twilio_call_sid: callSid,
              from_number: from || null,
              to_number: to || null,
              started_at: new Date().toISOString(),
              ...(isTerminalStatus(callStatus) ? { ended_at: new Date().toISOString() } : {}),
            });

          if (insertError) {
            console.error('[twilio-voice-status] Failed to create fallback call log:', insertError);
          }
        }
      }

      console.warn(`[twilio-voice-status] No existing call log for CallSid ${callSid}`);
      return emptyResponse();
    }

    // Build update payload
    const updatePayload: Record<string, any> = {
      status: callStatus,
    };

    if (callDuration) {
      updatePayload.duration_seconds = parseInt(callDuration, 10);
    }

    if (isTerminalStatus(callStatus)) {
      updatePayload.ended_at = new Date().toISOString();
    }

    // Update call log
    const { error: updateError } = await supabase
      .from('call_logs')
      .update(updatePayload)
      .eq('id', callLog.id);

    if (updateError) {
      console.error('[twilio-voice-status] Failed to update call log:', updateError);
    }

    // If call is completed and we have a chat channel, log it as a message in the thread
    if (callStatus === 'completed' && callLog.channel_id) {
      const durationSec = callDuration ? parseInt(callDuration, 10) : 0;
      const durationFormatted = formatDuration(durationSec);
      const directionLabel = callLog.direction === 'inbound' ? 'Inbound' : 'Outbound';

      const callMessage = `${directionLabel} voice call - ${durationFormatted}`;

      const { error: msgError } = await supabase
        .from('chat_channel_messages')
        .insert({
          channel_id: callLog.channel_id,
          sender_type: callLog.direction === 'inbound' ? 'customer' : 'tenant',
          sender_id: callLog.direction === 'inbound'
            ? (callLog.customer_id || '00000000-0000-0000-0000-000000000000')
            : (callLog.caller_id || '00000000-0000-0000-0000-000000000000'),
          content: callMessage,
          channel: 'voice',
          metadata: {
            type: 'voice_call',
            call_sid: callSid,
            direction: callLog.direction,
            duration_seconds: durationSec,
            status: callStatus,
            from_number: callLog.from_number,
            to_number: callLog.to_number,
          },
        });

      if (msgError) {
        console.error('[twilio-voice-status] Failed to insert call message:', msgError);
      } else {
        // Update channel last_message_at
        await supabase
          .from('chat_channels')
          .update({
            last_message_at: new Date().toISOString(),
            last_channel: 'voice',
            updated_at: new Date().toISOString(),
          })
          .eq('id', callLog.channel_id);

        console.log(`[twilio-voice-status] Logged call message in channel ${callLog.channel_id}`);
      }
    }

    console.log(`[twilio-voice-status] Updated call ${callSid} to status ${callStatus}`);
    return emptyResponse();
  } catch (err: any) {
    console.error('[twilio-voice-status] Error:', err);
    return emptyResponse();
  }
});

function isTerminalStatus(status: string): boolean {
  return ['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(status);
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}
