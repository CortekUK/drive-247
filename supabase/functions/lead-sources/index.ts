// lead-sources
//
// Super-admin endpoint behind Contact Requests → Connect. Connects and
// disconnects the places leads come from:
//
//   status            what is configured (Meta app present?) and the webhook base URL
//   google_connect    create the Google Ads webhook connection (URL + key to paste)
//   google_rotate     issue a new key for it
//   meta_exchange     Facebook Login code → long-lived user token (held as a
//                     15-minute handoff) → the Pages it manages
//   meta_connect      subscribe the chosen Pages to leadgen, keep their tokens
//   disconnect        unsubscribe (Meta) and remove a connection
//
// The Meta app is the project's existing one (META_LEADS_APP_ID/SECRET, else
// META_WHATSAPP_APP_ID/SECRET). Its Page webhook is pointed at
// lead-webhook-meta here too, so no one has to configure it by hand.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts';
import { GRAPH, metaAppCredentials, metaVerifyToken } from '../_shared/lead-intake.ts';

const META_SCOPES = ['pages_show_list', 'pages_manage_metadata', 'pages_read_engagement', 'leads_retrieval', 'business_management'];

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function graph(path: string, init?: RequestInit) {
  const res = await fetch(`${GRAPH}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Meta returned ${res.status}`);
  return data;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const auth = req.headers.get('Authorization');
    if (!auth) return errorResponse('Missing authorization header', 401);
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return errorResponse('Unauthorized', 401);

    const supabase = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: me } = await supabase
      .from('app_users')
      .select('id, is_super_admin, is_active')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!me?.is_super_admin || me.is_active === false) return errorResponse('Forbidden', 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const functionsBase = `${url}/functions/v1`;
    const { appId, appSecret } = metaAppCredentials();

    switch (action) {
      case 'status': {
        return jsonResponse({
          meta: { configured: Boolean(appId && appSecret), appId: appId || null, scopes: META_SCOPES },
          googleWebhookBase: `${functionsBase}/lead-webhook-google`,
        });
      }

      case 'google_connect': {
        const { data: existing } = await supabase.from('lead_connections').select('*').eq('provider', 'google').limit(1).maybeSingle();
        if (existing) return jsonResponse({ connection: existing });
        const { data, error } = await supabase
          .from('lead_connections')
          .insert({ provider: 'google', label: 'Google Ads lead forms', webhook_key: randomKey(), connected_by: me.id })
          .select('*')
          .single();
        if (error) throw error;
        return jsonResponse({ connection: data });
      }

      case 'google_rotate': {
        const { data, error } = await supabase
          .from('lead_connections')
          .update({ webhook_key: randomKey(), updated_at: new Date().toISOString() })
          .eq('id', body.id)
          .eq('provider', 'google')
          .select('*')
          .single();
        if (error) throw error;
        return jsonResponse({ connection: data });
      }

      case 'meta_exchange': {
        if (!appId || !appSecret) return errorResponse('The Meta app is not set up on the server.', 412);
        const code = String(body.code ?? '');
        const redirectUri = String(body.redirectUri ?? '');
        if (!code || !redirectUri) return errorResponse('code and redirectUri are required');

        const short = await graph(
          `/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
        );
        // Long-lived user token: Page tokens taken from it do not expire.
        const long = await graph(
          `/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(short.access_token)}`,
        );
        const pages = await graph(`/me/accounts?fields=id,name,tasks&limit=200&access_token=${encodeURIComponent(long.access_token)}`);

        await supabase.from('lead_oauth_handoffs').delete().lt('expires_at', new Date().toISOString());
        const { data: handoff, error } = await supabase
          .from('lead_oauth_handoffs')
          .insert({ provider: 'meta', user_token: long.access_token, created_by: me.id })
          .select('id')
          .single();
        if (error) throw error;

        const { data: connected } = await supabase.from('lead_connections').select('external_id').eq('provider', 'meta');
        const connectedIds = new Set((connected ?? []).map((c: { external_id: string }) => c.external_id));
        return jsonResponse({
          handoffId: handoff.id,
          pages: (pages.data ?? []).map((p: { id: string; name: string; tasks?: string[] }) => ({
            id: p.id,
            name: p.name,
            connected: connectedIds.has(p.id),
            // Leads can only be read by someone who can advertise on / manage the Page.
            canReadLeads: !p.tasks || p.tasks.includes('ADVERTISE') || p.tasks.includes('MANAGE'),
          })),
        });
      }

      case 'meta_connect': {
        if (!appId || !appSecret) return errorResponse('The Meta app is not set up on the server.', 412);
        const pageIds: string[] = Array.isArray(body.pageIds) ? body.pageIds.map(String) : [];
        if (!pageIds.length) return errorResponse('Pick at least one Page');

        const { data: handoff } = await supabase
          .from('lead_oauth_handoffs')
          .select('id, user_token, expires_at')
          .eq('id', body.handoffId)
          .eq('created_by', me.id)
          .maybeSingle();
        if (!handoff || new Date(handoff.expires_at) < new Date()) {
          return errorResponse('That Facebook sign-in expired. Connect again.', 410);
        }

        // Point the app's Page webhook at us (idempotent: Meta replaces it).
        await graph(`/${appId}/subscriptions`, {
          method: 'POST',
          body: new URLSearchParams({
            object: 'page',
            callback_url: `${functionsBase}/lead-webhook-meta`,
            fields: 'leadgen',
            verify_token: await metaVerifyToken(),
            include_values: 'true',
            access_token: `${appId}|${appSecret}`,
          }),
        });

        const pages = await graph(`/me/accounts?fields=id,name,access_token&limit=200&access_token=${encodeURIComponent(handoff.user_token)}`);
        const results: { id: string; name: string; ok: boolean; error?: string }[] = [];

        for (const pageId of pageIds) {
          const page = (pages.data ?? []).find((p: { id: string }) => p.id === pageId);
          if (!page) {
            results.push({ id: pageId, name: pageId, ok: false, error: 'This Facebook account no longer manages that Page' });
            continue;
          }
          try {
            await graph(`/${page.id}/subscribed_apps`, {
              method: 'POST',
              body: new URLSearchParams({ subscribed_fields: 'leadgen', access_token: page.access_token }),
            });
            const { data: conn, error } = await supabase
              .from('lead_connections')
              .upsert(
                { provider: 'meta', external_id: page.id, label: page.name, status: 'active', last_error: null, connected_by: me.id, updated_at: new Date().toISOString() },
                { onConflict: 'provider,external_id' },
              )
              .select('id')
              .single();
            if (error) throw error;
            const { error: secretError } = await supabase
              .from('lead_connection_secrets')
              .upsert({ connection_id: conn.id, access_token: page.access_token, updated_at: new Date().toISOString() });
            if (secretError) throw secretError;
            results.push({ id: page.id, name: page.name, ok: true });
          } catch (error) {
            results.push({ id: page.id, name: page.name, ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        }

        await supabase.from('lead_oauth_handoffs').delete().eq('id', handoff.id);
        return jsonResponse({ results });
      }

      case 'disconnect': {
        const { data: conn } = await supabase
          .from('lead_connections')
          .select('id, provider, external_id, lead_connection_secrets(access_token)')
          .eq('id', body.id)
          .maybeSingle();
        if (!conn) return errorResponse('Not found', 404);
        if (conn.provider === 'meta') {
          const secrets = conn.lead_connection_secrets as { access_token: string } | { access_token: string }[] | null;
          const token = Array.isArray(secrets) ? secrets[0]?.access_token : secrets?.access_token;
          if (token) {
            // Best effort: the Page may already have removed the app.
            await graph(`/${conn.external_id}/subscribed_apps?access_token=${encodeURIComponent(token)}`, { method: 'DELETE' }).catch((e) =>
              console.warn('[LEAD-SOURCES] unsubscribe failed', e),
            );
          }
        }
        const { error } = await supabase.from('lead_connections').delete().eq('id', conn.id);
        if (error) throw error;
        return jsonResponse({ ok: true });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('[LEAD-SOURCES]', error);
    return errorResponse(error instanceof Error ? error.message : 'Unexpected error', 500);
  }
});
