// lead-webhook-meta
//
// Meta Lead Ads webhook (object "page", field "leadgen"). The Meta app is
// subscribed to it by lead-sources when the first Page is connected.
//
//   GET  — Meta's verification handshake: echo hub.challenge when
//          hub.verify_token matches.
//   POST — a batch of leadgen changes. Each carries only ids, so the lead is
//          fetched from the Graph API with the connected Page's token.
//
// verify_jwt = false: Meta sends no JWT. Every POST is checked against
// X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  GRAPH,
  markConnectionError,
  metaAppCredentials,
  metaVerifyToken,
  safeEqual,
  saveLead,
  type LeadField,
} from '../_shared/lead-intake.ts';

const text = (body: string, status = 200) => new Response(body, { status });

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface LeadgenChange {
  field?: string;
  value?: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      safeEqual(url.searchParams.get('hub.verify_token') ?? '', await metaVerifyToken());
    return ok ? text(url.searchParams.get('hub.challenge') ?? '') : text('Forbidden', 403);
  }
  if (req.method !== 'POST') return text('Method not allowed', 405);

  const { appSecret } = metaAppCredentials();
  const body = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  if (!appSecret || !signature.startsWith('sha256=') || !safeEqual(signature.slice(7), await hmacHex(appSecret, body))) {
    return text('Invalid signature', 401);
  }

  let payload: { object?: string; entry?: { id?: string; changes?: LeadgenChange[] }[] };
  try {
    payload = JSON.parse(body);
  } catch {
    return text('Invalid JSON', 400);
  }
  if (payload.object !== 'page') return text('ok');

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let failed = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen' || !change.value?.leadgen_id) continue;
      const pageId = change.value.page_id ?? entry.id;
      const leadId = change.value.leadgen_id;

      const { data: conn } = await supabase
        .from('lead_connections')
        .select('id, lead_connection_secrets(access_token)')
        .eq('provider', 'meta')
        .eq('external_id', pageId)
        .maybeSingle();
      const secrets = conn?.lead_connection_secrets as { access_token: string } | { access_token: string }[] | null | undefined;
      const token = Array.isArray(secrets) ? secrets[0]?.access_token : secrets?.access_token;
      if (!conn || !token) {
        console.warn(`[LEAD-META] lead ${leadId} for page ${pageId}, which is not connected`);
        continue;
      }

      try {
        const lead = await fetchLead(leadId, token);
        const fields: LeadField[] = (lead.field_data ?? []).map((f) => ({
          key: f.name,
          value: (f.values ?? []).join(', '),
        }));
        const detail = [lead.campaign_name, lead.ad_name, lead.form_name].filter(Boolean).join(' · ');
        const result = await saveLead(supabase, {
          source: 'meta-ads',
          connectionId: conn.id,
          externalId: leadId,
          sourceDetail: detail || null,
          isTest: lead.is_test === true,
          createdAt: lead.created_time ? new Date(lead.created_time).toISOString() : undefined,
          fields,
          raw: lead,
        });
        console.log(`[LEAD-META] ${leadId} ${result}`);
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[LEAD-META] ${leadId}`, message);
        await markConnectionError(supabase, conn.id, message);
      }
    }
  }

  // A non-200 makes Meta retry the whole batch; saveLead skips the ones already in.
  return failed ? text('Some leads could not be saved', 500) : text('ok');
});

interface MetaLead {
  id: string;
  created_time?: string;
  field_data?: { name: string; values?: string[] }[];
  ad_name?: string;
  campaign_name?: string;
  form_name?: string;
  is_test?: boolean;
}

/** Ad and campaign names need ads permissions some Pages lack, so they are asked for and dropped on refusal. */
async function fetchLead(leadId: string, token: string): Promise<MetaLead> {
  const get = async (fields: string) => {
    const res = await fetch(`${GRAPH}/${leadId}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
    const data = await res.json();
    return { ok: res.ok, data };
  };
  const full = await get('id,created_time,field_data,ad_name,campaign_name,form_id,is_organic,platform');
  let lead: MetaLead;
  if (full.ok) lead = full.data;
  else {
    const basic = await get('id,created_time,field_data,form_id');
    if (!basic.ok) throw new Error(basic.data?.error?.message ?? 'Could not read the lead from Meta');
    lead = basic.data;
  }
  const formId = (lead as unknown as { form_id?: string }).form_id;
  if (formId) {
    const res = await fetch(`${GRAPH}/${formId}?fields=name&access_token=${encodeURIComponent(token)}`).catch(() => null);
    if (res?.ok) lead.form_name = (await res.json()).name;
  }
  return lead;
}
