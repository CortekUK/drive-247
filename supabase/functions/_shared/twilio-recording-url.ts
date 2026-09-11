/**
 * Validates a Twilio RecordingUrl before it is fetched with tenant credentials.
 *
 * Why this exists: twilio-voicemail-handler and process-call-recording both took
 * RecordingUrl straight from the webhook body, appended ".mp3", and fetched it with
 * an `Authorization: Basic <accountSid:authToken>` header built from the tenant's
 * stored Twilio credentials. Neither checked where the URL pointed, and both run with
 * verify_jwt = false. A POST naming any host therefore delivered that tenant's live
 * Twilio auth token to it — full takeover of their Twilio account, including sending
 * SMS from their A2P-registered number.
 *
 * The only legitimate value is a Twilio media URL on api.twilio.com whose path names
 * the SAME account the credentials belong to, so that is all this accepts. Everything
 * else is refused, and the caller must not send credentials anywhere it rejects.
 */
export function isValidTwilioRecordingUrl(
  rawUrl: string | null | undefined,
  expectedAccountSid?: string | null,
): boolean {
  if (!rawUrl) return false;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  // https only — an http URL would put the Basic header on the wire in clear.
  if (parsed.protocol !== 'https:') return false;

  // Exact host match. Not endsWith: "api.twilio.com.evil.tld" would pass that, and
  // userinfo ("https://api.twilio.com@evil.tld/") is why we read .hostname and not
  // the raw string.
  if (parsed.hostname !== 'api.twilio.com') return false;

  // Must be a Recordings resource, not some other API path.
  if (!/^\/\d{4}-\d{2}-\d{2}\/Accounts\/AC[0-9a-fA-F]{32}\/Recordings\/RE[0-9a-fA-F]{32}(\.\w+)?$/.test(parsed.pathname)) {
    return false;
  }

  // The recording must belong to the account whose credentials we are about to send.
  if (expectedAccountSid) {
    const m = parsed.pathname.match(/\/Accounts\/(AC[0-9a-fA-F]{32})\//);
    if (!m || m[1].toLowerCase() !== expectedAccountSid.toLowerCase()) return false;
  }

  return true;
}
