import { handleCors } from '../_shared/cors.ts';

/**
 * twilio-voice-whisper
 *
 * Call-screening "whisper" leg for forwarded inbound calls.
 *
 * When twilio-voice-inbound forwards a call to a staff member's personal phone in
 * `business_line` caller-id mode, the phone shows the BUSINESS number (not the
 * customer's), so the staff member can't tell who is calling. This function is set
 * as the `url` on the forwarded <Number>, so Twilio plays it TO THE STAFF MEMBER
 * (only) when they answer, BEFORE the two parties are connected. It announces the
 * caller's name and asks them to press any key to accept the call.
 *
 * Why require a key press:
 *   (a) confirms a human — not the staff member's personal voicemail — is answering,
 *       so the customer is never dumped into a personal voicemail, and
 *   (b) gives them a moment to hear who is calling and decline by hanging up.
 *
 * Note on names: CNAM (caller-NAME display) is US-only, so on international phones
 * (e.g. UK) you cannot push a name into the caller ID. A spoken announcement is the
 * carrier-independent way to convey the caller's name.
 *
 * Query params:
 *   name   - caller display name (or number) to announce. URL-encoded.
 *   screen - '1' when Twilio posts back the <Gather> result (the key press / timeout).
 *   test   - '1' for the dev-panel test call (says a confirmation instead of bridging).
 *
 * Flow:
 *   1. Initial hit           -> <Gather> "Business call from {name}. Press any key to accept."
 *   2. Gather posts ?screen=1 (actionOnEmptyResult=true, so it ALWAYS posts back):
 *        - Digits present  -> real call: empty <Response/> (document ends -> Twilio bridges)
 *                             test call: <Say> success </Say><Hangup/>
 *        - Digits empty    -> <Hangup/> this leg (declines / avoids personal voicemail)
 *
 * verify_jwt = false (Twilio calls it directly).
 */

function xml(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const url = new URL(req.url);
    const rawName = (url.searchParams.get('name') || '').trim();
    const isScreen = url.searchParams.get('screen') === '1';
    const isTest = url.searchParams.get('test') === '1';

    // Step 2: <Gather> posted back the key press (or timed out).
    if (isScreen) {
      let digits = '';
      try {
        const form = await req.formData();
        digits = ((form.get('Digits') as string) || '').trim();
      } catch {
        // no form body — treat as no input
      }

      if (digits) {
        // Accepted.
        if (isTest) {
          return xml(
            '<?xml version="1.0" encoding="UTF-8"?>' +
              '<Response><Say>Test successful. Your phone shows the business line as the caller I D, ' +
              'and the caller name was announced. Goodbye.</Say><Hangup/></Response>'
          );
        }
        // Real call: reaching the end of the document connects the two parties.
        return xml('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      // No key pressed (timeout / voicemail auto-answer) -> drop this leg so the
      // customer is not connected to an unattended phone / personal voicemail.
      return xml(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Response><Say>No key pressed. Goodbye.</Say><Hangup/></Response>'
      );
    }

    // Step 1: initial whisper — announce the caller and ask the staff member to accept.
    const spokenName = rawName ? escapeXml(rawName) : 'an unknown number';

    const actionParams = new URLSearchParams({ screen: '1' });
    if (rawName) actionParams.set('name', rawName);
    if (isTest) actionParams.set('test', '1');
    const action = `${supabaseUrl}/functions/v1/twilio-voice-whisper?${actionParams.toString()}`;

    const twiml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Response>' +
      `<Gather numDigits="1" timeout="10" actionOnEmptyResult="true" action="${escapeXml(action)}" method="POST">` +
      `<Say>Business call from ${spokenName}. Press any key to accept.</Say>` +
      '</Gather>' +
      '</Response>';

    return xml(twiml);
  } catch (err: any) {
    console.error('[twilio-voice-whisper] Error:', err);
    // Fail OPEN: on error, connect the call rather than dropping it.
    return xml('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});
