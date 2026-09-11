/**
 * diag-twilio-voice — READ-ONLY.
 *
 * Why this exists: RevTek's inbound calls forward to the owner's mobile
 * (+19046357309) and the child leg comes back `busy` at 0s, over and over,
 * while a handful of otherwise identical calls connect fine. call_logs can't
 * settle why, because it only stores what the status callback POSTed. This
 * asks Twilio what it actually did: the caller ID presented on each child
 * leg, the leg's own error code, and the SIP/Q.850 cause from call events.
 *
 * Performs GETs only. Sends nothing, changes nothing. Credentials never
 * leave this function.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';

const API = 'https://api.twilio.com/2010-04-01';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let slug = 'revtekrentals';
  let sids: string[] = [];
  try {
    const b = await req.json();
    if (b?.slug) slug = String(b.slug);
    if (Array.isArray(b?.sids)) sids = b.sids.map(String);
  } catch { /* defaults */ }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: t, error } = await supabase
    .from('tenants')
    .select('slug, twilio_account_sid, twilio_auth_token, twilio_phone_number, forwarding_number, forwarding_caller_id_mode')
    .eq('slug', slug)
    .single();
  if (error || !t) return errorResponse(`Tenant ${slug} not found`, 404);

  const acct = (t as any).twilio_account_sid;
  const tok = (t as any).twilio_auth_token;
  if (!acct || !tok) return errorResponse('Tenant has no Twilio credentials stored', 400);
  const auth = `Basic ${btoa(`${acct}:${tok}`)}`;

  const get = async (url: string) => {
    try {
      const r = await fetch(url, { headers: { Authorization: auth } });
      const txt = await r.text();
      let j: any = {}; try { j = JSON.parse(txt); } catch { /* non-JSON */ }
      return { ok: r.ok, status: r.status, body: j, raw: r.ok ? undefined : txt.slice(0, 300) };
    } catch (e) {
      return { ok: false, status: 0, body: {}, raw: String((e as Error)?.message ?? e).slice(0, 300) };
    }
  };

  // 1. Per-call detail: what caller ID did Twilio present, and why did the leg end?
  const calls: unknown[] = [];
  for (const s of sids.slice(0, 12)) {
    const c = await get(`${API}/Accounts/${acct}/Calls/${s}.json`);
    const ev = await get(`${API}/Accounts/${acct}/Calls/${s}/Events.json?PageSize=20`);
    const causes = (ev.body?.events ?? [])
      .map((e: any) => ({
        name: e?.request?.method ? undefined : e?.name,
        sip_code: e?.response?.response_code ?? e?.request?.parameters?.sip_response_code,
        q850: e?.response?.parameters?.q850_cause ?? e?.request?.parameters?.q850_cause,
        err: e?.response?.parameters?.error_code ?? e?.request?.parameters?.error_code,
      }))
      .filter((x: any) => x.sip_code || x.q850 || x.err);
    calls.push({
      sid: s,
      http: c.status,
      from: c.body?.from,
      to: c.body?.to,
      status: c.body?.status,
      duration: c.body?.duration,
      start_time: c.body?.start_time,
      end_time: c.body?.end_time,
      direction: c.body?.direction,
      parent_call_sid: c.body?.parent_call_sid,
      answered_by: c.body?.answered_by,
      price: c.body?.price,
      caller_name: c.body?.caller_name,
      error_code: c.body?.['error_code'] ?? null,
      error_message: c.body?.['error_message'] ?? null,
      event_causes: causes.slice(0, 6),
      events_http: ev.status,
    });
  }

  // 2. Is the forwarding target itself a number on this Twilio account?
  //    A forward that loops back would produce exactly this signature.
  const fwd = (t as any).forwarding_number;
  const owned = await get(`${API}/Accounts/${acct}/IncomingPhoneNumbers.json?PageSize=50`);
  const ownedNumbers = (owned.body?.incoming_phone_numbers ?? []).map((n: any) => ({
    phone_number: n.phone_number,
    friendly_name: n.friendly_name,
    voice_url: n.voice_url,
    voice_method: n.voice_method,
    voice_fallback_url: n.voice_fallback_url,
    status_callback: n.status_callback,
    sms_url: n.sms_url,
    voice_caller_id_lookup: n.voice_caller_id_lookup,
    emergency_status: n.emergency_status,
    trunk_sid: n.trunk_sid,
  }));

  // 3. Verified outbound caller IDs (relevant only if callerId is NOT an owned number).
  const outgoing = await get(`${API}/Accounts/${acct}/OutgoingCallerIds.json?PageSize=50`);

  // 4. Account-wide tally of every leg that dialled the forwarding number.
  const toFwd = await get(`${API}/Accounts/${acct}/Calls.json?To=${encodeURIComponent(fwd ?? '')}&PageSize=50`);
  const fwdLegs = (toFwd.body?.calls ?? []).map((c: any) => ({
    sid: c.sid, from: c.from, status: c.status, duration: c.duration,
    start: c.start_time, parent: c.parent_call_sid,
  }));


  // 5. Voice Insights: the only source that reports the SIP cause and the
  //    caller ID actually presented on the wire. REST `from` on a dial-child
  //    echoes the PARENT's From regardless of callerId, so it cannot answer this.
  const insights: unknown[] = [];
  for (const s2 of sids.slice(0, 12)) {
    const r = await get(`https://insights.twilio.com/v1/Voice/${s2}/Summary?ProcessingState=complete`);
    const b = r.body ?? {};
    insights.push({
      sid: s2,
      http: r.status,
      call_type: b.call_type,
      call_state: b.call_state,
      from: b.from,
      to: b.to,
      carrier_edge_from: b?.attributes?.from ?? b?.carrier_edge?.properties?.from,
      sip_from: b?.carrier_edge?.properties?.from_user ?? null,
      last_sip_response_num: b?.properties?.last_sip_response_num,
      disconnected_by: b?.properties?.disconnected_by,
      pdd_ms: b?.properties?.pdd_ms,
      direction: b?.properties?.direction,
      tags: b?.tags,
      raw: r.ok ? undefined : (r.raw ?? null),
    });
  }

  // 6. Account notifications — Twilio logs 13214 "invalid callerId" here and
  //    silently falls back to the caller's number when it fires.
  const notif = await get(`${API}/Accounts/${acct}/Notifications.json?PageSize=50`);
  const notifications = (notif.body?.notifications ?? []).map((n: any) => ({
    error_code: n.error_code, log: n.log, message_date: n.message_date,
    call_sid: n.call_sid, message_text: String(n.message_text ?? '').slice(0, 200),
  }));


  // 7. Account-wide status tally by destination, month by month. If only the
  //    forwarding number returns `busy`, the cause is that handset/carrier;
  //    if every US destination does, it is the originating number's reputation.
  const tally: Record<string, Record<string, number>> = {};
  const monthly: Record<string, Record<string, number>> = {};
  let pageUrl: string | null = `${API}/Accounts/${acct}/Calls.json?PageSize=1000`;
  let pages = 0;
  const samples: unknown[] = [];
  while (pageUrl && pages < 6) {
    const r: any = await get(pageUrl);
    if (!r.ok) break;
    for (const c of (r.body?.calls ?? [])) {
      const dest = String(c.to ?? 'unknown');
      const st = String(c.status ?? 'unknown');
      (tally[dest] ??= {})[st] = ((tally[dest] ??= {})[st] ?? 0) + 1;
      const m = String(c.start_time ?? '').slice(0, 16);
      if (dest === fwd) {
        const mk = new Date(c.start_time).toISOString().slice(0, 7);
        (monthly[mk] ??= {})[st] = ((monthly[mk] ??= {})[st] ?? 0) + 1;
        if (samples.length < 400) samples.push({ sid: c.sid, from: c.from, st, dur: c.duration, t: m, parent: c.parent_call_sid });
      }
    }
    pageUrl = r.body?.next_page_uri ? `https://api.twilio.com${r.body.next_page_uri}` : null;
    pages++;
  }

  // 8. Monitor Alerts — where Twilio surfaces per-call warnings (13214 etc).
  const alerts = await get(`https://monitor.twilio.com/v1/Alerts?PageSize=50`);
  const alertDetail: unknown[] = [];
  for (const a of (alerts.body?.alerts ?? []).slice(0, 6)) {
    const d2 = await get(`https://monitor.twilio.com/v1/Alerts/${a.sid}`);
    alertDetail.push({ code: d2.body?.error_code, date: d2.body?.date_created,
      call_sid: d2.body?.call_sid, text: d2.body?.alert_text,
      request_url: d2.body?.request_url, response_body: String(d2.body?.request_variables ?? '').slice(0, 1500) });
  }
  const alertList = (alerts.body?.alerts ?? []).map((a: any) => ({
    error_code: a.error_code, date: a.date_created, sid: a.resource_sid,
    text: String(a.alert_text ?? '').slice(0, 200),
  }));

  return jsonResponse({
    tenant: {
      slug: (t as any).slug,
      twilio_number: (t as any).twilio_phone_number,
      forwarding_number: fwd,
      caller_id_mode: (t as any).forwarding_caller_id_mode,
    },
    calls,
    owned_numbers: ownedNumbers,
    forwarding_number_is_owned: ownedNumbers.some((n: any) => n.phone_number === fwd),
    verified_caller_ids: (outgoing.body?.outgoing_caller_ids ?? []).map((o: any) => o.phone_number),
    legs_to_forwarding_number: fwdLegs,
    insights,
    notifications,
    tally_by_destination: tally,
    forwarding_monthly: monthly,
    forwarding_samples: samples,
    alerts: alertList,
    alert_detail: alertDetail,
    pages_scanned: pages,
  });
});
