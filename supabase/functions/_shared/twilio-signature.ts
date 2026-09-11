/**
 * X-Twilio-Signature validation.
 *
 * Every Twilio webhook on this platform runs with verify_jwt = false — it has to, or
 * Twilio's unauthenticated POST gets a 401 and calls and texts stop working. That left
 * knowing the URL as the only barrier, and the URLs are not secret: they appear in the
 * tenant's own Twilio console and in TwiML this platform emits. Forged callbacks could
 * fabricate calls and customer messages in an operator's portal.
 *
 * Twilio's scheme (https://www.twilio.com/docs/usage/security):
 *   1. Take the full URL Twilio was configured to call, including any query string.
 *   2. For a form-encoded POST, append each POST parameter sorted by key, as key then
 *      value concatenated with no separator.
 *   3. HMAC-SHA1 that string with the account's auth token, base64 the digest.
 *   4. Compare with the X-Twilio-Signature header.
 *
 * The auth token is per tenant, so a caller must resolve the tenant first (by To
 * number, AccountSid, CallSid, or an explicit tenantId) and pass that tenant's token.
 *
 * URL reconstruction is the fragile part of retrofitting this: behind a proxy,
 * req.url is not always byte-identical to what Twilio signed. candidateUrls() returns
 * the plausible forms and validate() accepts if ANY matches. Every candidate is
 * derived from the request itself, so this does not weaken the check — a forger still
 * needs the auth token to produce a matching digest for any of them.
 */

function base64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/** Constant-time compare, so a wrong signature cannot be recovered byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): Promise<string> {
  // Sort by key, then concatenate key and value with no separator.
  const sorted = Object.keys(params).sort();
  let data = url;
  for (const k of sorted) data += k + params[k];

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64(sig);
}

/**
 * The URL forms Twilio may have signed, given how this request arrived.
 * Ordered most-likely-first; callers try them all.
 */
export function candidateUrls(req: Request): string[] {
  const out: string[] = [];
  const push = (u: string) => { if (u && !out.includes(u)) out.push(u); };

  push(req.url);

  let parsed: URL | null = null;
  try { parsed = new URL(req.url); } catch { /* keep req.url as the only candidate */ }
  if (!parsed) return out;

  // Observed on Supabase edge runtime: req.url arrives as
  //   http://<project>.supabase.co/<function-name>
  // i.e. http rather than https, and WITHOUT the /functions/v1 prefix that Twilio was
  // actually configured with — while x-forwarded-host is the INTERNAL
  // edge-runtime.supabase.com. So the URL Twilio signed is not any single header; it
  // has to be rebuilt from the cross-product of the hosts, schemes and path shapes
  // this request could have arrived under. Verified against live Twilio traffic: the
  // match is https + the project host + the /functions/v1 prefix.
  const hosts = [parsed.hostname, req.headers.get('x-forwarded-host'), req.headers.get('host')]
    .filter((h): h is string => !!h)
    .map((h) => h.replace(/:\d+$/, ''));

  const protos = ['https', (req.headers.get('x-forwarded-proto') || parsed.protocol.replace(':', ''))];

  const paths = [parsed.pathname];
  if (!parsed.pathname.startsWith('/functions/v1/')) {
    paths.push(`/functions/v1${parsed.pathname}`);
  } else {
    // and the reverse, in case the prefix is present locally but absent upstream
    paths.push(parsed.pathname.replace('/functions/v1', ''));
  }

  for (const proto of protos) {
    for (const host of hosts) {
      for (const path of paths) {
        push(`${proto}://${host}${path}${parsed.search}`);
      }
    }
  }

  return out;
}


/**
 * True when the request carries a signature that verifies against `authToken`.
 *
 * Returns false when the header is absent: a caller that treats "no signature" as
 * valid would leave the hole wide open, which is exactly what the previous stub did.
 */
export async function validateTwilioRequest(
  req: Request,
  authToken: string | null | undefined,
  params: Record<string, string>,
): Promise<boolean> {
  if (!authToken) return false;
  const provided = req.headers.get('x-twilio-signature');
  if (!provided) return false;

  for (const url of candidateUrls(req)) {
    const expected = await computeTwilioSignature(authToken, url, params);
    if (timingSafeEqual(expected, provided)) return true;
  }
  return false;
}

/** FormData -> the plain string map Twilio signs. Files are not signed; skip them. */
export function formDataToParams(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Enforcement kill-switch. Set TWILIO_SIGNATURE_ENFORCE=false to log-and-allow if a
 * URL-reconstruction edge case ever starts rejecting genuine Twilio traffic — that
 * beats a rollback, because it restores calls and texts without redeploying.
 */
export function signatureEnforcementEnabled(): boolean {
  return (Deno.env.get('TWILIO_SIGNATURE_ENFORCE') ?? 'true').toLowerCase() !== 'false';
}

/**
 * Same check, but reports WHICH candidate URL matched. Used to prove URL
 * reconstruction against real Twilio traffic before enforcement is switched on —
 * a signature retrofit that guesses wrong at the URL rejects genuine callbacks and
 * takes calls and texts down, so this is verified with live traffic first.
 */
export async function validateTwilioRequestVerbose(
  req: Request,
  authToken: string | null | undefined,
  params: Record<string, string>,
): Promise<{ valid: boolean; reason: string; matchedUrl?: string; candidates: string[] }> {
  const candidates = candidateUrls(req);
  if (!authToken) return { valid: false, reason: 'no_auth_token_for_tenant', candidates };
  const provided = req.headers.get('x-twilio-signature');
  if (!provided) return { valid: false, reason: 'missing_signature_header', candidates };

  for (const url of candidates) {
    const expected = await computeTwilioSignature(authToken, url, params);
    if (timingSafeEqual(expected, provided)) return { valid: true, reason: 'ok', matchedUrl: url, candidates };
  }
  return { valid: false, reason: 'no_candidate_url_matched', candidates };
}

/**
 * One place that decides what a webhook does about a failed check, so the ten
 * endpoints cannot drift apart. Logs the verdict either way; returns whether the
 * caller should REJECT. With enforcement off it always returns false (allow), which
 * is the kill-switch behaviour.
 */
export async function twilioSignatureGate(
  req: Request,
  authToken: string | null | undefined,
  params: Record<string, string>,
  label: string,
): Promise<boolean> {
  const res = await validateTwilioRequestVerbose(req, authToken, params);
  if (res.valid) {
    console.log(`[${label}] signature OK (matched ${res.matchedUrl})`);
    return false;
  }
  const enforcing = signatureEnforcementEnabled();
  console.error(
    `[${label}] signature INVALID (${res.reason}) enforcing=${enforcing} candidates=${JSON.stringify(res.candidates)}`,
  );
  return enforcing;
}

/**
 * The signing key is the tenant's OWN Twilio auth token (credentials are BYO per
 * tenant), so every webhook has to resolve its tenant before it can verify anything.
 * These cover the three identifiers Twilio gives us to do that with.
 */
export async function tenantTokenByAccountSid(
  supabase: any,
  accountSid: string | null | undefined,
): Promise<string | null> {
  if (!accountSid) return null;
  const { data } = await supabase
    .from('tenants')
    .select('twilio_auth_token')
    .eq('twilio_account_sid', accountSid)
    .not('twilio_auth_token', 'is', null)
    .limit(1);
  return data?.[0]?.twilio_auth_token ?? null;
}

export async function tenantTokenByTenantId(
  supabase: any,
  tenantId: string | null | undefined,
): Promise<string | null> {
  if (!tenantId) return null;
  const { data } = await supabase
    .from('tenants')
    .select('twilio_auth_token')
    .eq('id', tenantId)
    .limit(1);
  return data?.[0]?.twilio_auth_token ?? null;
}

/** For status callbacks, which name a CallSid rather than a tenant. */
export async function tenantTokenByCallSid(
  supabase: any,
  callSid: string | null | undefined,
): Promise<string | null> {
  if (!callSid) return null;
  const { data } = await supabase
    .from('call_logs')
    .select('tenant_id')
    .eq('twilio_call_sid', callSid)
    .limit(1);
  return tenantTokenByTenantId(supabase, data?.[0]?.tenant_id);
}
