import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';

/**
 * twilio-voicemail-handler
 *
 * Handles two scenarios:
 *
 * 1. Dial action callback (no answer / busy / failed) — plays voicemail greeting and records.
 * 2. Record action callback (after voicemail is recorded) — saves the recording to DB & chat.
 *
 * Query params: tenantId, callSid, from, to, customerId, channelId
 * Twilio form data: DialCallStatus (for dial action), RecordingUrl, RecordingSid, RecordingDuration (for record action)
 */

function twimlResponse(twiml: string): Response {
  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

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

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const callSid = url.searchParams.get('callSid');
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const customerId = url.searchParams.get('customerId') || null;
    const channelId = url.searchParams.get('channelId') || null;
    const explicitAction = url.searchParams.get('action'); // 'save' for direct voicemail (no users scenario)

    if (!tenantId) {
      console.error('[twilio-voicemail-handler] Missing tenantId');
      return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred.</Say></Response>');
    }

    const formData = await req.formData();
    const dialCallStatus = formData.get('DialCallStatus') as string | null;
    const recordingUrl = formData.get('RecordingUrl') as string | null;
    const recordingSid = formData.get('RecordingSid') as string | null;
    const recordingDuration = formData.get('RecordingDuration') as string | null;

    console.log(`[twilio-voicemail-handler] tenantId=${tenantId} callSid=${callSid} dialStatus=${dialCallStatus} recordingUrl=${recordingUrl} action=${explicitAction}`);

    // --- SCENARIO 1: Dial action callback (call wasn't answered) ---
    // Twilio sends DialCallStatus when the <Dial> completes
    if (dialCallStatus && !recordingUrl) {
      // If the call was answered, no voicemail needed — just hang up
      if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
        console.log('[twilio-voicemail-handler] Call was answered, no voicemail needed');
        return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>');
      }

      // Call wasn't answered (no-answer, busy, failed, canceled) — play voicemail prompt
      console.log(`[twilio-voicemail-handler] Call not answered (${dialCallStatus}), playing voicemail`);

      // Get tenant for greeting
      const { data: tenant } = await supabase
        .from('tenants')
        .select('company_name, voicemail_greeting_url')
        .eq('id', tenantId)
        .single();

      const greeting = tenant?.voicemail_greeting_url
        ? `<Play>${escapeXml(tenant.voicemail_greeting_url)}</Play>`
        : `<Say>You've reached ${escapeXml(tenant?.company_name || 'us')}. No one is available right now. Please leave a message after the beep.</Say>`;

      const recordAction = `${supabaseUrl}/functions/v1/twilio-voicemail-handler?tenantId=${tenantId}&amp;callSid=${callSid}&amp;from=${encodeURIComponent(from)}&amp;to=${encodeURIComponent(to)}&amp;customerId=${customerId || ''}&amp;channelId=${channelId || ''}&amp;action=save`;

      return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${greeting}
  <Record maxLength="120" action="${recordAction}" playBeep="true" transcribe="false" />
  <Say>We did not receive your message. Goodbye.</Say>
</Response>`);
    }

    // --- SCENARIO 2: Recording completed — save voicemail ---
    if ((explicitAction === 'save' || recordingUrl) && recordingUrl) {
      console.log(`[twilio-voicemail-handler] Saving voicemail: ${recordingSid} (${recordingDuration}s)`);

      const durationSec = recordingDuration ? parseInt(recordingDuration, 10) : 0;
      const twilioMp3Url = `${recordingUrl}.mp3`;

      // Download and upload to Supabase Storage (so browser can access without Twilio auth)
      let finalRecordingUrl = twilioMp3Url;
      try {
        const { data: tenantCreds } = await supabase.from('tenants')
          .select('twilio_account_sid, twilio_auth_token').eq('id', tenantId).single();

        const authHeader = tenantCreds?.twilio_account_sid && tenantCreds?.twilio_auth_token
          ? `Basic ${btoa(`${tenantCreds.twilio_account_sid}:${tenantCreds.twilio_auth_token}`)}`
          : undefined;

        const audioResponse = await fetch(twilioMp3Url, {
          headers: authHeader ? { 'Authorization': authHeader } : {},
        });

        if (audioResponse.ok) {
          const audioBlob = await audioResponse.blob();
          const storagePath = `${tenantId}/vm-${recordingSid || Date.now()}.mp3`;
          const { error: uploadErr } = await supabase.storage
            .from('voicemails').upload(storagePath, audioBlob, { contentType: 'audio/mpeg', upsert: true });

          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from('voicemails').getPublicUrl(storagePath);
            if (urlData?.publicUrl) finalRecordingUrl = urlData.publicUrl;
          }
        }
      } catch (err: any) {
        console.warn('[twilio-voicemail-handler] Storage upload failed, using Twilio URL:', err.message);
      }

      // Save voicemail recording to DB
      const { error: vmError } = await supabase
        .from('voicemail_recordings')
        .insert({
          tenant_id: tenantId,
          customer_id: customerId || null,
          channel_id: channelId || null,
          twilio_call_sid: callSid,
          twilio_recording_sid: recordingSid,
          recording_url: finalRecordingUrl,
          duration_seconds: durationSec,
          from_number: from || null,
          to_number: to || null,
        });

      if (vmError) {
        console.error('[twilio-voicemail-handler] Failed to save voicemail:', vmError);
      }

      // Also link to call_log if exists
      if (callSid) {
        const { data: callLog } = await supabase
          .from('call_logs')
          .select('id')
          .eq('twilio_call_sid', callSid)
          .single();

        if (callLog) {
          await supabase
            .from('voicemail_recordings')
            .update({ call_log_id: callLog.id })
            .eq('twilio_call_sid', callSid)
            .eq('tenant_id', tenantId);
        }
      }

      // Log voicemail as a chat message in the conversation thread
      if (channelId) {
        const { error: msgError } = await supabase
          .from('chat_channel_messages')
          .insert({
            channel_id: channelId,
            sender_type: 'customer',
            sender_id: customerId || '00000000-0000-0000-0000-000000000000',
            content: `Voicemail received (${formatDuration(durationSec)})`,
            channel: 'voice',
            metadata: {
              type: 'voicemail',
              recording_url: finalRecordingUrl,
              recording_sid: recordingSid,
              duration_seconds: durationSec,
              call_sid: callSid,
              from_number: from,
            },
          });

        if (msgError) {
          console.error('[twilio-voicemail-handler] Failed to insert voicemail message:', msgError);
        } else {
          await supabase
            .from('chat_channels')
            .update({
              last_message_at: new Date().toISOString(),
              last_channel: 'voice',
              updated_at: new Date().toISOString(),
            })
            .eq('id', channelId);

          console.log(`[twilio-voicemail-handler] Logged voicemail in channel ${channelId}`);
        }
      }

      // Respond with a thank-you
      return twimlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for your message. Goodbye.</Say>
</Response>`);
    }

    // Fallback — no dial status and no recording, just end the call
    console.warn('[twilio-voicemail-handler] Unexpected state, ending call');
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Goodbye.</Say></Response>');
  } catch (err: any) {
    console.error('[twilio-voicemail-handler] Error:', err);
    return twimlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred.</Say></Response>');
  }
});

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '0s';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}
