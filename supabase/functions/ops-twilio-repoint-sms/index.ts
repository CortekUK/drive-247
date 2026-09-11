/**
 * ops-twilio-repoint-sms
 *
 * Points a tenant's Twilio number at the PLATFORM inbound-SMS handler.
 *
 * Why this exists: manage-twilio-connection sets SmsUrl to twilio-inbound-sms during
 * `connect`, but it swallows webhook-config failures ("Don't fail the whole connection
 * — tenant can retry webhook config later"), and nothing exposes that retry. A number
 * can also be repointed by hand in the Twilio console. Either way it silently drifts,
 * and every inbound text then fails with error 11200 while Twilio still bills for it.
 *
 * Safety properties:
 *   - The destination is HARD-CODED to this project's twilio-inbound-sms. This cannot
 *     be used to point a customer's number at an arbitrary URL.
 *   - Defaults to a DRY RUN. Nothing is written unless confirm === true.
 *   - Always returns the previous value, so the change is revertible.
 *   - Touches only SmsUrl/SmsMethod. Voice config is never modified.
 *
 * NOTE: this is only correct while the number's Messaging Service (if any) has
 * use_inbound_webhook_on_number = true. When that flag is false the SERVICE's
 * inbound_request_url wins and the number's SmsUrl is ignored — so it is checked
 * here and the write is refused rather than silently doing nothing.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

const API = 'https://api.twilio.com/2010-04-01';
const MSG = 'https://messaging.twilio.com/v1';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let slug = '';
  let confirm = false;
  try {
    const b = await req.json();
    slug = String(b?.slug ?? '');
    confirm = b?.confirm === true;
  } catch { /* no body */ }
  if (!slug) return errorResponse('slug is required', 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: t, error } = await supabase
    .from('tenants')
    .select('slug, twilio_account_sid, twilio_auth_token, twilio_phone_number, twilio_phone_number_sid')
    .eq('slug', slug)
    .single();
  if (error || !t) return errorResponse(`Tenant ${slug} not found`, 404);

  const acct = (t as any).twilio_account_sid;
  const tok = (t as any).twilio_auth_token;
  if (!acct || !tok) return errorResponse('Tenant has no Twilio credentials stored', 400);
  const auth = `Basic ${btoa(`${acct}:${tok}`)}`;

  const call = async (url: string, method = 'GET', form?: Record<string, string>) => {
    const init: RequestInit = { method, headers: { Authorization: auth } };
    if (form) {
      init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = new URLSearchParams(form).toString();
    }
    const r = await fetch(url, init);
    const txt = await r.text();
    let j: any = {}; try { j = JSON.parse(txt); } catch { /* non-JSON */ }
    return { ok: r.ok, status: r.status, body: j, raw: r.ok ? undefined : txt.slice(0, 300) };
  };

  // Locate the number resource.
  let numSid = (t as any).twilio_phone_number_sid as string | null;
  const list = await call(`${API}/Accounts/${acct}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent((t as any).twilio_phone_number ?? '')}`);
  const found = (list.body?.incoming_phone_numbers ?? [])[0];
  if (!numSid) numSid = found?.sid ?? null;
  if (!numSid) return errorResponse('Could not resolve the Twilio number SID', 404);

  const before = {
    phone_number: found?.phone_number,
    sms_url: found?.sms_url,
    sms_method: found?.sms_method,
    sms_fallback_url: found?.sms_fallback_url,
    voice_url: found?.voice_url,
  };

  // Refuse if a Messaging Service would override the number-level webhook, since the
  // write would appear to succeed and change nothing.
  const svcs = await call(`${MSG}/Services?PageSize=20`);
  const overriding: unknown[] = [];
  for (const s of (svcs.body?.services ?? [])) {
    const nums = await call(`${MSG}/Services/${s.sid}/PhoneNumbers?PageSize=20`);
    const holds = (nums.body?.phone_numbers ?? []).some((n: any) => n.phone_number === before.phone_number);
    if (holds && s.use_inbound_webhook_on_number === false) {
      overriding.push({ service_sid: s.sid, inbound_request_url: s.inbound_request_url });
    }
  }

  const target = `${supabaseUrl}/functions/v1/twilio-inbound-sms`;

  if (overriding.length) {
    return jsonResponse({
      applied: false,
      refused: 'A Messaging Service holding this number has use_inbound_webhook_on_number=false, so its inbound_request_url governs and changing the number SmsUrl would do nothing.',
      overriding_services: overriding,
      before,
    }, 409);
  }

  if (before.sms_url === target) {
    return jsonResponse({ applied: false, already_correct: true, before, target });
  }

  if (!confirm) {
    return jsonResponse({
      applied: false,
      dry_run: true,
      note: 'Re-send with confirm:true to apply.',
      before,
      would_set: { SmsUrl: target, SmsMethod: 'POST' },
    });
  }

  const upd = await call(`${API}/Accounts/${acct}/IncomingPhoneNumbers/${numSid}.json`, 'POST', {
    SmsUrl: target,
    SmsMethod: 'POST',
  });
  if (!upd.ok) return errorResponse(`Twilio rejected the update: ${upd.status} ${upd.raw ?? ''}`, 502);

  // Read back rather than trusting the write response.
  const verify = await call(`${API}/Accounts/${acct}/IncomingPhoneNumbers/${numSid}.json`);
  return jsonResponse({
    applied: true,
    before,
    after: {
      sms_url: verify.body?.sms_url,
      sms_method: verify.body?.sms_method,
      voice_url: verify.body?.voice_url,
    },
    revert_with: { SmsUrl: before.sms_url },
  });
});
