// send-push
//
// Fans one notification out to every live Web Push subscription matching a
// target, over the encrypted Web Push protocol in _shared/web-push.ts.
//
// Requires a portal JWT: this reaches customers' lock screens, so it is not a
// capability an anonymous caller may hold. The tenant is taken from the CALLER's
// app_users row, never from the request body — otherwise any operator could
// address another operator's customers by passing a different tenant_id. Only a
// super admin may name a tenant explicitly.
//
// Delivery notes that shape the code:
//  * A push service reports only whether it ACCEPTED the message. iOS gives no
//    read receipt, so `push_notification_log` is the sole record that a send
//    happened — it is written for failures too, or a silent phone is
//    indistinguishable from a send that never left.
//  * 404/410 mean the subscription is permanently dead (PWA deleted, storage
//    cleared). Those rows are retired immediately; every other error is treated
//    as transient and the row survives.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getVapidKeys, sendWebPush, type PushPayload } from '../_shared/web-push.ts';

/** Roles that may push to a whole audience without an explicit grant. */
const FULL_ACCESS_ROLES = new Set(['head_admin', 'admin']);

/** Push services rate-limit aggressive parallelism; this keeps a fan-out polite. */
const SEND_CONCURRENCY = 10;

const MAX_TITLE = 100;
const MAX_BODY = 300;

type Target = 'self' | 'staff' | 'customers' | 'all' | 'subscription';
const VALID_TARGETS = new Set<Target>(['self', 'staff', 'customers', 'all', 'subscription']);

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  audience: 'customer' | 'staff';
  platform: string;
  failure_count: number;
}

/** Runs `worker` over `items` at bounded concurrency, preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST required' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return jsonResponse({ error: 'Server is not configured' }, 500);
  }

  let vapid;
  try {
    vapid = getVapidKeys();
  } catch (error) {
    console.error('[SEND-PUSH]', error);
    return jsonResponse({
      error: 'Push is not configured on this project (VAPID keys missing)',
      code: 'vapid_missing',
    }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- 1. Who is asking? --------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Sign in to send notifications' }, 401);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  const authUser = authData?.user;
  if (authError || !authUser) {
    return jsonResponse({ error: 'Invalid session' }, 401);
  }

  const { data: appUser } = await supabase
    .from('app_users')
    .select('id, role, is_active, tenant_id, is_super_admin')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (!appUser) return jsonResponse({ error: 'No portal profile for this account' }, 403);
  if (!appUser.is_active) return jsonResponse({ error: 'This account is deactivated' }, 403);

  const isSuperAdmin = appUser.is_super_admin === true;
  let allowed = isSuperAdmin || FULL_ACCESS_ROLES.has(appUser.role);

  // A manager needs an explicit editor grant on the settings tab that owns this
  // screen; an unscoped manager (and every viewer/ops user) is denied.
  if (!allowed && appUser.role === 'manager') {
    const { data: perm } = await supabase
      .from('manager_permissions')
      .select('access_level')
      .eq('app_user_id', appUser.id)
      .eq('tab_key', 'settings.reminders')
      .maybeSingle();
    allowed = perm?.access_level === 'editor';
  }

  if (!allowed) {
    return jsonResponse({ error: 'Your role cannot send notifications' }, 403);
  }

  // ---- 2. Validate the request -------------------------------------------
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const target: Target = VALID_TARGETS.has(body.target) ? body.target : 'self';

  // Caller's own tenant wins. Only a super admin (tenant_id NULL by design) may
  // name one, and they MUST — there is no "all tenants" broadcast here.
  const tenantId = isSuperAdmin ? (body.tenantId ?? appUser.tenant_id) : appUser.tenant_id;
  if (!tenantId) {
    return jsonResponse({ error: 'tenantId is required for super admin sends' }, 400);
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, company_name, app_name, logo_url, push_notifications_enabled')
    .eq('id', tenantId)
    .maybeSingle();

  if (!tenant) return jsonResponse({ error: 'Unknown tenant' }, 404);
  if (!tenant.push_notifications_enabled) {
    return jsonResponse({
      error: 'Push notifications are not enabled for this account',
      code: 'push_disabled',
    }, 403);
  }

  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE);
  if (!title) return jsonResponse({ error: 'A title is required' }, 400);
  const messageBody = String(body.body ?? '').trim().slice(0, MAX_BODY) || undefined;
  const url = typeof body.url === 'string' && body.url.trim() ? body.url.trim() : undefined;
  const source = typeof body.source === 'string' ? body.source.slice(0, 50) : 'manual_test';

  // ---- 3. Resolve the recipient set --------------------------------------
  let query = supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, audience, platform, failure_count')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true);

  switch (target) {
    case 'self':
      // The operator's own devices — the safe default, and what the test button
      // uses. Nothing reaches a customer unless someone deliberately says so.
      query = query.eq('audience', 'staff').eq('app_user_id', appUser.id);
      break;
    case 'staff':
      query = query.eq('audience', 'staff');
      break;
    case 'customers':
      query = query.eq('audience', 'customer');
      if (typeof body.customerId === 'string') query = query.eq('customer_id', body.customerId);
      break;
    case 'subscription':
      if (typeof body.subscriptionId !== 'string') {
        return jsonResponse({ error: 'subscriptionId is required for this target' }, 400);
      }
      query = query.eq('id', body.subscriptionId);
      break;
    case 'all':
      break;
  }

  const { data: subscriptions, error: subsError } = await query.limit(2000);
  if (subsError) {
    console.error('[SEND-PUSH] Could not load subscriptions:', subsError.message);
    return jsonResponse({ error: 'Could not load subscriptions' }, 500);
  }

  const recipients = (subscriptions ?? []) as SubscriptionRow[];
  if (recipients.length === 0) {
    return jsonResponse({
      success: true,
      sent: 0,
      failed: 0,
      expired: 0,
      message: target === 'self'
        ? 'No devices enrolled for your account yet — enable notifications on this device first.'
        : 'No devices are enrolled for this target yet.',
    });
  }

  // ---- 4. Fan out ---------------------------------------------------------
  const payload: PushPayload = {
    title,
    body: messageBody,
    url: url ?? '/',
    icon: tenant.logo_url ?? undefined,
    // A stable tag collapses repeats of the same notification on the device
    // instead of stacking duplicates in the tray.
    tag: typeof body.tag === 'string' ? body.tag.slice(0, 50) : `${source}-${tenant.slug}`,
    data: {
      tenantSlug: tenant.slug,
      source,
      sentAt: new Date().toISOString(),
    },
  };

  const results = await mapLimit(recipients, SEND_CONCURRENCY, async (sub) => {
    const result = await sendWebPush(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      payload,
      vapid,
    );
    return { sub, result };
  });

  const nowIso = new Date().toISOString();
  const expiredIds: string[] = [];
  const succeededIds: string[] = [];
  const logRows = results.map(({ sub, result }) => {
    if (result.ok) succeededIds.push(sub.id);
    else if (result.expired) expiredIds.push(sub.id);

    return {
      tenant_id: tenant.id,
      subscription_id: sub.id,
      endpoint: sub.endpoint,
      audience: sub.audience,
      title,
      body: messageBody ?? null,
      url: url ?? null,
      status: result.ok ? 'sent' : result.expired ? 'expired' : 'failed',
      http_status: result.status || null,
      error: result.error ?? null,
      sent_by: appUser.id,
      source,
    };
  });

  // Bookkeeping is best-effort — a logging failure must not be reported to the
  // operator as a failed SEND, because the notification has already landed.
  const bookkeeping: Promise<unknown>[] = [
    supabase.from('push_notification_log').insert(logRows),
  ];

  if (succeededIds.length > 0) {
    bookkeeping.push(
      supabase
        .from('push_subscriptions')
        .update({ last_success_at: nowIso, last_seen_at: nowIso, failure_count: 0, last_error: null })
        .in('id', succeededIds),
    );
  }

  if (expiredIds.length > 0) {
    bookkeeping.push(
      supabase
        .from('push_subscriptions')
        .update({ is_active: false, revoked_at: nowIso, last_error: 'Subscription expired at push service' })
        .in('id', expiredIds),
    );
  }

  const failures = results.filter(({ result }) => !result.ok && !result.expired);
  for (const { sub, result } of failures) {
    bookkeeping.push(
      supabase
        .from('push_subscriptions')
        .update({ failure_count: sub.failure_count + 1, last_error: result.error?.slice(0, 500) ?? 'Unknown error' })
        .eq('id', sub.id),
    );
  }

  const settled = await Promise.allSettled(bookkeeping);
  const bookkeepingFailed = settled.filter((s) => s.status === 'rejected').length;
  if (bookkeepingFailed > 0) {
    console.error(`[SEND-PUSH] ${bookkeepingFailed} bookkeeping write(s) failed after a successful send`);
  }

  const sent = succeededIds.length;
  console.log(`[SEND-PUSH] ${tenant.slug} target=${target} sent=${sent} failed=${failures.length} expired=${expiredIds.length}`);

  return jsonResponse({
    success: true,
    sent,
    failed: failures.length,
    expired: expiredIds.length,
    total: recipients.length,
    // Surfaced so the portal can explain WHY a device stayed silent rather than
    // just reporting a count.
    errors: failures.slice(0, 5).map(({ result }) => result.error).filter(Boolean),
  });
});
