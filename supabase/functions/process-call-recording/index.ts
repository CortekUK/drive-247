import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors } from '../_shared/cors.ts';
import { chatCompletion } from '../_shared/openai.ts';

/**
 * process-call-recording
 *
 * Triggered by Twilio's recordingStatusCallback when a call recording is ready.
 * Downloads the MP3, transcribes via OpenAI Whisper, generates summary + action items
 * via GPT, and saves everything to call_logs.
 *
 * Twilio form data: RecordingUrl, RecordingSid, RecordingDuration, CallSid, RecordingStatus
 */

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

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

    const formData = await req.formData();
    const recordingUrl = formData.get('RecordingUrl') as string;
    const recordingSid = formData.get('RecordingSid') as string;
    const recordingDuration = formData.get('RecordingDuration') as string;
    const callSid = formData.get('CallSid') as string;
    const recordingStatus = formData.get('RecordingStatus') as string;

    console.log(`[process-call-recording] CallSid=${callSid} RecordingSid=${recordingSid} Status=${recordingStatus} Duration=${recordingDuration}s`);

    // Only process completed recordings
    if (recordingStatus !== 'completed') {
      console.log(`[process-call-recording] Skipping non-completed recording: ${recordingStatus}`);
      return new Response('OK', { status: 200 });
    }

    if (!callSid || !recordingUrl || !recordingSid) {
      console.error('[process-call-recording] Missing required fields');
      return new Response('Missing fields', { status: 400 });
    }

    // Step 1: Find call_log and save recording URL
    const { data: callLog, error: findError } = await supabase
      .from('call_logs')
      .select('id, tenant_id, customer_id, channel_id, direction, from_number, to_number')
      .eq('twilio_call_sid', callSid)
      .single();

    if (findError || !callLog) {
      console.error(`[process-call-recording] No call_log for CallSid ${callSid}:`, findError);
      return new Response('Call not found', { status: 404 });
    }

    const mp3Url = `${recordingUrl}.mp3`;

    // Save recording URL immediately
    await supabase
      .from('call_logs')
      .update({
        recording_url: mp3Url,
        recording_sid: recordingSid,
      })
      .eq('id', callLog.id);

    console.log(`[process-call-recording] Saved recording URL for call ${callLog.id}`);

    // Step 2: Download the recording
    if (!OPENAI_API_KEY) {
      console.error('[process-call-recording] OPENAI_API_KEY not set, skipping transcription');
      return new Response('OK', { status: 200 });
    }

    let audioBlob: Blob;
    try {
      const audioResponse = await fetch(mp3Url);
      if (!audioResponse.ok) {
        throw new Error(`Failed to download recording: ${audioResponse.status}`);
      }
      audioBlob = await audioResponse.blob();
      console.log(`[process-call-recording] Downloaded recording: ${(audioBlob.size / 1024).toFixed(1)}KB`);
    } catch (err: any) {
      console.error(`[process-call-recording] Failed to download recording:`, err.message);
      return new Response('OK', { status: 200 });
    }

    // Step 3: Transcribe via OpenAI Whisper
    let transcript = '';
    try {
      const whisperForm = new FormData();
      whisperForm.append('file', audioBlob, 'recording.mp3');
      whisperForm.append('model', 'whisper-1');
      whisperForm.append('response_format', 'text');

      const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: whisperForm,
      });

      if (!whisperResponse.ok) {
        const errText = await whisperResponse.text();
        throw new Error(`Whisper API error: ${whisperResponse.status} - ${errText}`);
      }

      transcript = await whisperResponse.text();
      transcript = transcript.trim();
      console.log(`[process-call-recording] Transcript length: ${transcript.length} chars`);
    } catch (err: any) {
      console.error(`[process-call-recording] Transcription failed:`, err.message);
      // Save what we have and return
      await supabase.from('call_logs').update({ transcript: '[Transcription failed]' }).eq('id', callLog.id);
      return new Response('OK', { status: 200 });
    }

    if (!transcript || transcript.length < 5) {
      console.log('[process-call-recording] Transcript too short, skipping AI summary');
      await supabase.from('call_logs').update({ transcript: transcript || '[No speech detected]' }).eq('id', callLog.id);
      return new Response('OK', { status: 200 });
    }

    // Step 4: Generate AI summary + action items via GPT
    let aiSummary = '';
    let aiActionItems: string[] = [];

    try {
      const durationSec = parseInt(recordingDuration || '0', 10);
      const directionLabel = callLog.direction === 'inbound' ? 'inbound (customer called)' : 'outbound (staff called customer)';

      const result = await chatCompletion([
        {
          role: 'system',
          content: `You are a call summary assistant for a car rental business. Analyze the call transcript and provide:
1. A concise summary (2-3 sentences) of what was discussed
2. A list of action items that need follow-up

Respond in JSON format:
{
  "summary": "...",
  "action_items": ["item 1", "item 2"]
}

If there are no action items, return an empty array. Be specific and actionable. Focus on rental-related details: vehicle info, dates, payments, extensions, issues, etc.`,
        },
        {
          role: 'user',
          content: `This was a ${directionLabel} call lasting ${Math.floor(durationSec / 60)}m ${durationSec % 60}s.

Transcript:
${transcript}`,
        },
      ], {
        temperature: 0.3,
        max_tokens: 512,
      });

      const content = result.choices?.[0]?.message?.content || '';

      // Parse JSON response
      try {
        // Extract JSON from response (might have markdown code blocks)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          aiSummary = parsed.summary || '';
          aiActionItems = Array.isArray(parsed.action_items) ? parsed.action_items : [];
        }
      } catch (parseErr: any) {
        console.error('[process-call-recording] Failed to parse GPT response:', parseErr.message);
        aiSummary = content; // Use raw content as fallback
      }

      console.log(`[process-call-recording] AI summary generated: ${aiSummary.length} chars, ${aiActionItems.length} action items`);
    } catch (err: any) {
      console.error(`[process-call-recording] GPT summary failed:`, err.message);
    }

    // Step 5: Save everything to call_logs
    const { error: updateError } = await supabase
      .from('call_logs')
      .update({
        transcript,
        ai_summary: aiSummary || null,
        ai_action_items: aiActionItems.length > 0 ? aiActionItems : null,
      })
      .eq('id', callLog.id);

    if (updateError) {
      console.error('[process-call-recording] Failed to save transcript:', updateError);
    }

    // Step 6: Update the chat message metadata to flag transcript availability
    if (callLog.channel_id) {
      const { data: chatMsg } = await supabase
        .from('chat_channel_messages')
        .select('id, metadata')
        .eq('channel_id', callLog.channel_id)
        .eq('channel', 'voice')
        .filter('metadata->>call_sid', 'eq', callSid)
        .single();

      if (chatMsg) {
        const existingMetadata = (chatMsg.metadata as Record<string, unknown>) || {};
        await supabase
          .from('chat_channel_messages')
          .update({
            metadata: {
              ...existingMetadata,
              has_transcript: true,
            },
          })
          .eq('id', chatMsg.id);

        console.log(`[process-call-recording] Updated chat message ${chatMsg.id} with has_transcript flag`);
      }
    }

    console.log(`[process-call-recording] Complete for call ${callLog.id}`);
    return new Response('OK', { status: 200 });
  } catch (err: any) {
    console.error('[process-call-recording] Error:', err);
    return new Response('Error', { status: 500 });
  }
});
