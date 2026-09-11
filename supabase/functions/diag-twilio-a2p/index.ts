/**
 * diag-twilio-a2p  — READ-ONLY.
 *
 * Reads the tenant's own Twilio credentials the same way the SMS client does
 * (tenants.twilio_account_sid / twilio_auth_token, BYO per tenant) and reports
 * the A2P 10DLC posture. Credentials never leave this function.
 *
 * Why this exists: US A2P 10DLC is enforced per Messaging Service, not per
 * number, so this reports campaign state, brand state, number config and the
 * recent per-error tallies for a tenant's own Twilio account.
 *
 * NOTE, because an earlier revision of this comment claimed the opposite: sending
 * with a bare `From:` and no MessagingServiceSid is FINE. A number that belongs to
 * a Messaging Service with an approved campaign inherits that campaign's
 * registration whichever way it is addressed. This was verified against RevTek:
 * campaign CU07SL8 is VERIFIED, and every 30034 ("message from unregistered
 * number") on the account predates its approval. Always read an error tally with
 * its timeline before concluding the code is at fault.
 *
 * Performs GETs only. Sends nothing, changes nothing.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

const API = 'https://api.twilio.com/2010-04-01';
const MSG = 'https://messaging.twilio.com/v1';
const TRUSTHUB = 'https://trusthub.twilio.com/v1';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let slug = 'revtekrentals';
  try { const b = await req.json(); if (b?.slug) slug = String(b.slug); } catch { /* default */ }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: t, error } = await supabase
    .from('tenants')
    .select('slug, twilio_account_sid, twilio_auth_token, twilio_phone_number, twilio_phone_number_sid, twilio_messaging_service_sid')
    .eq('slug', slug)
    .single();
  if (error || !t) return errorResponse(`Tenant ${slug} not found`, 404);

  const sid = (t as any).twilio_account_sid;
  const tok = (t as any).twilio_auth_token;
  if (!sid || !tok) return errorResponse('Tenant has no Twilio credentials stored', 400);
  const auth = `Basic ${btoa(`${sid}:${tok}`)}`;

  const get = async (url: string) => {
    try {
      const r = await fetch(url, { headers: { Authorization: auth } });
      const txt = await r.text();
      let j: any = {}; try { j = JSON.parse(txt); } catch { /* non-JSON */ }
      return { ok: r.ok, status: r.status, body: j, raw: r.ok ? undefined : txt.slice(0, 200) };
    } catch (e) {
      return { ok: false, status: 0, body: {}, raw: String((e as Error)?.message ?? e).slice(0, 200) };
    }
  };

  // 1. Messaging Services — an A2P campaign attaches to one of these.
  const svcs = await get(`${MSG}/Services?PageSize=20`);
  const services = (svcs.body?.services ?? []).map((s: any) => ({
    sid: s.sid, friendly_name: s.friendly_name, use_inbound_webhook_on_number: s.use_inbound_webhook_on_number,
  }));

  // 2. For each service: the numbers in it, and its A2P campaign (us_app_to_person).
  const serviceDetail: unknown[] = [];
  for (const s of services) {
    const nums = await get(`${MSG}/Services/${s.sid}/PhoneNumbers?PageSize=20`);
    const camp = await get(`${MSG}/Services/${s.sid}/Compliance/Usa2p`);
    serviceDetail.push({
      service_sid: s.sid,
      name: s.friendly_name,
      numbers: (nums.body?.phone_numbers ?? []).map((n: any) => n.phone_number),
      campaign_http: camp.status,
      campaign_raw: camp.ok ? camp.body : (camp.raw ?? camp.body),
    });
  }

  // 3. A2P brand registrations on the account.
  const brands = await get(`${MSG}/a2p/BrandRegistrations?PageSize=10`);
  const brandList = (brands.body?.data ?? brands.body?.meta ? brands.body?.data : brands.body?.brand_registrations) ?? [];

  // 4. The number's own config — is it webhook-wired for voice and SMS?
  const numSid = (t as any).twilio_phone_number_sid;
  const number = numSid ? await get(`${API}/Accounts/${sid}/IncomingPhoneNumbers/${numSid}.json`) : null;

  // 5. Recent outbound messages and their error codes — 30034 is the
  //    "unregistered number" A2P rejection we expect to see.
  const msgs = await get(`${API}/Accounts/${sid}/Messages.json?PageSize=30`);
  const recent = (msgs.body?.messages ?? []).map((m: any) => ({
    to: m.to, from: m.from, status: m.status, error_code: m.error_code,
    direction: m.direction, date_sent: m.date_sent,
    messaging_service_sid: m.messaging_service_sid ?? null,
  }));
  const errorTally: Record<string, number> = {};
  for (const m of recent) {
    const k = `${m.status}${m.error_code ? ' / ' + m.error_code : ''}`;
    errorTally[k] = (errorTally[k] ?? 0) + 1;
  }

  // also list campaigns directly, independent of the per-service lookup
  const allCampaigns = await get(`${MSG}/Services/PreregisteredUsa2p`);

  return jsonResponse({
    ok: true,
    all_campaigns_probe: { http: allCampaigns.status, body: allCampaigns.body },
    tenant: slug,
    account_sid: sid,
    stored_messaging_service_sid: (t as any).twilio_messaging_service_sid,
    messaging_services: serviceDetail,
    brand_registrations: brandList,
    number: number?.ok
      ? {
          phone_number: number.body?.phone_number,
          voice_url: number.body?.voice_url,
          sms_url: number.body?.sms_url,
          status_callback: number.body?.status_callback,
        }
      : { lookup_http: number?.status ?? null },
    recent_message_tally: errorTally,
    recent_messages: recent.slice(0, 30),
  });
});
