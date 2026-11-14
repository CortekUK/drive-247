// push-operator-notification
//
// QA R15.6 / R15.7 (2026-11-14): a new booking or a signed agreement rang the
// portal bell (a `notifications` row) but never reached a staff member's phone:
// nothing turned an operator notification into a Web Push. The only pushes that
// fired were the platform ones (notify-platform-activity, super admins).
//
// Called by the `on_notification_operator_push` trigger with ONLY the
// notification id (same pattern as notify-operator-email). The row is re-read
// here and never trusted from the caller, and each notification is pushed at
// most once and only while fresh, so calling this by hand cannot replay or
// invent anything.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getVapidKeys, sendWebPush, type PushPayload } from '../_shared/web-push.ts';

const SEND_CONCURRENCY = 10;
/** Older notifications are not pushed: a late push about an old booking is noise. */
const FRESH_MS = 10 * 60 * 1000;

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  let notificationId: string | null = null;
  try {
    const body = await req.json();
    notificationId = typeof body?.notification_id === 'string' ? body.notification_id : null;
  } catch {
    // fall through
  }
  if (!notificationId) return jsonResponse({ error: 'notification_id required' }, 400);

  const { data: n } = await supabase
    .from('notifications')
    .select('id, tenant_id, user_id, type, title, message, link, created_at')
    .eq('id', notificationId)
    .maybeSingle();
  if (!n) return jsonResponse({ success: true, sent: 0, reason: 'not_found' });
  // Operator broadcasts only: addressed to the tenant, not to one user.
  if (n.user_id || !n.tenant_id) return jsonResponse({ success: true, sent: 0, reason: 'not_a_broadcast' });
  if (Date.now() - new Date(n.created_at).getTime() > FRESH_MS) {
    return jsonResponse({ success: true, sent: 0, reason: 'stale' });
  }

  const source = `bell:${n.id}`;
  const { count: already } = await supabase
    .from('push_notification_log')
    .select('id', { count: 'exact', head: true })
    .eq('source', source);
  if ((already ?? 0) > 0) return jsonResponse({ success: true, sent: 0, reason: 'already_pushed' });

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('tenant_id', n.tenant_id)
    .eq('audience', 'staff')
    .eq('is_active', true)
    .is('revoked_at', null);
  const recipients = subs ?? [];
  if (recipients.length === 0) return jsonResponse({ success: true, sent: 0, reason: 'no_devices' });

  let vapid;
  try {
    vapid = getVapidKeys();
  } catch (error) {
    console.error('[PUSH-OPERATOR]', error);
    return jsonResponse({ error: 'Push is not configured' }, 500);
  }

  const { data: tenant } = await supabase.from('tenants').select('company_name, slug').eq('id', n.tenant_id).maybeSingle();
  const title = `${tenant?.company_name ?? 'Drive247'} · ${n.title ?? 'New notification'}`.slice(0, 100);
  const payload: PushPayload = {
    title,
    body: (n.message ?? '').slice(0, 300) || undefined,
    url: n.link || '/notifications',
    tag: `bell-${n.type ?? 'notice'}-${n.id}`,
    data: { notificationId: n.id, type: n.type, tenantId: n.tenant_id },
  };

  const results = await mapLimit(recipients, SEND_CONCURRENCY, async (sub) => ({
    sub,
    result: await sendWebPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload, vapid),
  }));

  const nowIso = new Date().toISOString();
  const succeeded = results.filter((r) => r.result.ok).map((r) => r.sub.id);
  const expired = results.filter((r) => r.result.expired).map((r) => r.sub.id);
  const bookkeeping: PromiseLike<unknown>[] = [
    supabase.from('push_notification_log').insert(
      results.map(({ sub, result }) => ({
        tenant_id: n.tenant_id,
        subscription_id: sub.id,
        endpoint: sub.endpoint,
        audience: 'staff',
        title,
        body: payload.body ?? null,
        url: payload.url ?? null,
        status: result.ok ? 'sent' : result.expired ? 'expired' : 'failed',
        http_status: result.status || null,
        error: result.error ?? null,
        source,
      })),
    ),
  ];
  if (succeeded.length) {
    bookkeeping.push(
      supabase.from('push_subscriptions')
        .update({ last_success_at: nowIso, last_seen_at: nowIso, failure_count: 0, last_error: null })
        .in('id', succeeded),
    );
  }
  if (expired.length) {
    bookkeeping.push(
      supabase.from('push_subscriptions')
        .update({ is_active: false, revoked_at: nowIso, last_error: 'Subscription expired at push service' })
        .in('id', expired),
    );
  }
  await Promise.allSettled(bookkeeping);

  console.log(`[PUSH-OPERATOR] ${tenant?.slug ?? n.tenant_id} ${n.type} -> sent=${succeeded.length}/${recipients.length}`);
  return jsonResponse({ success: true, sent: succeeded.length, devices: recipients.length });
});
