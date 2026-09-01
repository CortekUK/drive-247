import { handleCors } from '../_shared/cors.ts';

/**
 * twilio-voice-whisper
 *
 * "Whisper" announcement leg for forwarded inbound calls.
 *
 * When twilio-voice-inbound forwards a call to a staff member's personal phone in
 * `business_line` caller-id mode, the phone shows the BUSINESS number (not the
 * customer's), so the staff member can't tell who is calling. This function is set as
 * the `url` on the forwarded <Number>, so Twilio plays it TO THE STAFF MEMBER only,
 * when they answer, BEFORE the two parties are connected. It announces the caller's
 * name; when the announcement ends, the call bridges automatically.
 *
 * Design note — why announce-only (no "press a key to accept" screening):
 *   A screening <Gather> that <Hangup>s on "no key" makes Twilio report the parent
 *   <Dial> as DialCallStatus=completed (per Twilio's TwiML changelog), which is
 *   indistinguishable from a genuinely answered-and-completed call. twilio-voicemail-handler
 *   treats `completed` as "answered, no voicemail needed", so a declined / unanswered
 *   screened call would DEAD-END the customer (hang up, no business voicemail) — e.g.
 *   when the staff phone rolls to its carrier voicemail. Screening safely requires a
 *   per-call "screened-declined" marker shared with the voicemail handler (a schema
 *   change). Until that exists, we announce and always bridge: this delivers the core
 *   requirement (name + business line) with zero dead-end risk.
 *
 * CNAM (caller-NAME display) is US-only, so on international phones (e.g. UK) a spoken
 * announcement is the only carrier-independent way to convey the caller's name.
 *
 * Query params:
 *   name - caller display name (or number) to announce. URL-encoded.
 *   test - '1' for the dev-panel test call (a standalone call: confirm + hang up, no bridge).
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
    const url = new URL(req.url);
    const rawName = (url.searchParams.get('name') || '').trim();
    const isTest = url.searchParams.get('test') === '1';
    const spokenName = rawName ? escapeXml(rawName) : 'an unknown number';

    if (isTest) {
      // Dev-panel test: a standalone call (NOT part of a <Dial>), so we announce a
      // confirmation and hang up — there is no bridge target.
      return xml(
        '<?xml version="1.0" encoding="UTF-8"?>' +
          '<Response><Say>Test call. Business call from ' + spokenName + '. ' +
          'Your phone is showing your business line as the caller I D, and the caller name ' +
          'was announced correctly. Goodbye.</Say><Hangup/></Response>'
      );
    }

    // Real forwarded call: announce the caller to the staff member, then let the
    // document end so Twilio bridges the two parties. No <Hangup>, so the parent
    // <Dial> never sees a screening-reject (which would break the voicemail fallback).
    return xml(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Say>Business call from ' + spokenName + '. Connecting you now.</Say></Response>'
    );
  } catch (err: any) {
    console.error('[twilio-voice-whisper] Error:', err);
    // Fail OPEN: on error, connect the call rather than dropping it.
    return xml('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});
