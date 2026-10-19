// lead-webhook-google
//
// Google Ads lead form webhook. In Google Ads → lead form → "Lead delivery
// options" → Webhook integration, paste:
//   URL:  https://<project>.supabase.co/functions/v1/lead-webhook-google?c=<connection id>
//   Key:  the connection's webhook_key
// Google POSTs each lead as JSON (user_column_data, lead_id, campaign_id,
// form_id, google_key, is_test …) and expects a 200.
//
// verify_jwt = false: Google sends no JWT. The google_key in the body is the
// credential, checked against the connection's key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { safeEqual, saveLead, type LeadField } from '../_shared/lead-intake.ts';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface GoogleLead {
  lead_id?: string;
  api_version?: string;
  form_id?: number | string;
  campaign_id?: number | string;
  adgroup_id?: number | string;
  creative_id?: number | string;
  gcl_id?: string;
  google_key?: string;
  is_test?: boolean;
  lead_submit_time?: string;
  user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const connectionId = new URL(req.url).searchParams.get('c');
  if (!connectionId || !/^[0-9a-f-]{36}$/i.test(connectionId)) return json({ error: 'Unknown connection' }, 404);

  let lead: GoogleLead;
  try {
    lead = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: conn } = await supabase
    .from('lead_connections')
    .select('id, provider, webhook_key')
    .eq('id', connectionId)
    .maybeSingle();

  if (!conn || conn.provider !== 'google' || !conn.webhook_key) return json({ error: 'Unknown connection' }, 404);
  if (!lead.google_key || !safeEqual(lead.google_key, conn.webhook_key)) return json({ error: 'Invalid key' }, 401);

  const fields: LeadField[] = (lead.user_column_data ?? []).map((c) => ({
    key: c.column_id || c.column_name || 'answer',
    label: c.column_name,
    value: c.string_value ?? '',
  }));

  // Google's test button sends a lead with is_test = true and a fixed lead id;
  // give each test its own id so every test shows up.
  const externalId = lead.is_test ? `test-${crypto.randomUUID()}` : String(lead.lead_id ?? crypto.randomUUID());
  const detail = [lead.campaign_id && `Campaign ${lead.campaign_id}`, lead.form_id && `Form ${lead.form_id}`]
    .filter(Boolean)
    .join(' · ');

  try {
    const result = await saveLead(supabase, {
      source: 'google-ads',
      connectionId: conn.id,
      externalId,
      sourceDetail: detail || null,
      isTest: lead.is_test === true,
      createdAt: isoOrUndefined(lead.lead_submit_time),
      fields,
      raw: { ...lead, google_key: undefined },
    });
    console.log(`[LEAD-GOOGLE] ${externalId} ${result}`);
    return json({ ok: true, result });
  } catch (error) {
    console.error('[LEAD-GOOGLE]', error);
    // A 5xx makes Google retry, which is what we want for a database hiccup.
    return json({ error: 'Could not save the lead' }, 500);
  }
});

function isoOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
}
