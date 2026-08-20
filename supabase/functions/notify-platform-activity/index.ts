// notify-platform-activity
//
// Turns one `audit_logs` row into a push notification on every super admin's
// phone that asked for that action.
//
// Called by the `trg_audit_log_platform_push` trigger via pg_net, which passes
// ONLY the row id — this function re-reads the row and never trusts caller
// content. Same discipline as notify_operator_email_dispatch.
//
// verify_jwt = false because pg_net carries no user JWT. It is NOT anonymously
// callable: the caller must present `x-platform-secret`, validated by the
// platform_verify_secret() RPC, exactly like the other DB-driven functions in
// this project. A super-admin JWT is also accepted so the same endpoint can be
// driven by hand for testing.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getVapidKeys, sendWebPush, type PushPayload } from '../_shared/web-push.ts';

const SEND_CONCURRENCY = 10;

/**
 * Human wording for the actions worth waking a phone for. Anything not listed
 * still sends — falling back to a de-slugged action name — because audit
 * actions are added by feature work all the time and a new one going out as
 * "Rental extension approved" beats it going out as nothing.
 */
const ACTION_LABELS: Record<string, string> = {
  rental_created: 'New rental',
  rental_extended: 'Rental extended',
  rental_cancelled: 'Rental cancelled',
  rental_vehicle_swapped: 'Vehicle swapped',
  rental_extension_approved: 'Extension approved',
  rental_created_without_id_verification: 'Rental created WITHOUT ID check',
  payment_created: 'Payment received',
  payment_refunded: 'Refund issued',
  payment_charged_saved_card: 'Saved card charged',
  payment_collected_as_credit: 'Payment collected as credit',
  installment_payment_processed: 'Installment paid',
  customer_created: 'New customer',
  customer_blocked: 'Customer blocked',
  vehicle_created: 'Vehicle added',
  fine_created: 'Fine raised',
  subscription_activated: 'Subscription activated',
  subscription_invoice_paid: 'Subscription invoice paid',
  subscription_checkout_created: 'Subscription checkout started',
  insurance_payment_confirmed: 'Insurance confirmed',
  insurance_payment_failed: 'Insurance payment FAILED',
  insurance_payment_insufficient_balance: 'Bonzah balance too low',
  stripe_account_created: 'Stripe account connected',
  credit_wallet_gifted: 'Credits gifted',
  credit_wallet_purchased: 'Credits purchased',
  login_failed: 'Failed login attempt',
  identity_blocked: 'Identity blocked',
};

function labelFor(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server is not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- Auth: platform secret (pg_net) or a super-admin JWT (manual) --------
  let authorised = false;
  const platformSecret = req.headers.get('x-platform-secret');
  if (platformSecret) {
    const { data: valid } = await supabase.rpc('platform_verify_secret', { p_secret: platformSecret });
    authorised = valid === true;
  }

  if (!authorised) {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ') && anonKey) {
      const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: authData } = await callerClient.auth.getUser();
      if (authData?.user) {
        const { data: admin } = await supabase
          .from('app_users')
          .select('is_super_admin, is_active')
          .eq('auth_user_id', authData.user.id)
          .maybeSingle();
        authorised = admin?.is_super_admin === true && admin.is_active === true;
      }
    }
  }

  if (!authorised) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const auditLogId = typeof body.audit_log_id === 'string' ? body.audit_log_id : null;
  if (!auditLogId) return jsonResponse({ error: 'audit_log_id is required' }, 400);

  // ---- Re-read the event ---------------------------------------------------
  const { data: entry } = await supabase
    .from('audit_logs')
    .select('id, action, entity_type, entity_id, tenant_id, actor_id, details, created_at')
    .eq('id', auditLogId)
    .maybeSingle();

  if (!entry) return jsonResponse({ error: 'Unknown audit log entry' }, 404);

  // ---- Who wants it? -------------------------------------------------------
  const { data: prefs } = await supabase
    .from('platform_activity_prefs')
    .select('app_user_id, actions, is_enabled, include_test_tenants')
    .eq('is_enabled', true);

  let interested = (prefs ?? []).filter((p) => (p.actions ?? []).includes(entry.action));
  if (interested.length === 0) {
    return jsonResponse({ success: true, sent: 0, reason: 'no_subscriber_wants_action' });
  }

  // ---- Context for a message that reads like a sentence --------------------
  let tenantName = 'Platform';
  let isTestTenant = false;
  if (entry.tenant_id) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('company_name, slug')
      .eq('id', entry.tenant_id)
      .maybeSingle();
    if (tenant) {
      tenantName = tenant.company_name || tenant.slug;
      isTestTenant = tenant.slug === 'test';
    }
  }

  if (isTestTenant) {
    interested = interested.filter((p) => p.include_test_tenants);
    if (interested.length === 0) {
      return jsonResponse({ success: true, sent: 0, reason: 'test_tenant_excluded' });
    }
  }

  let actorName = '';
  if (entry.actor_id) {
    const { data: actor } = await supabase
      .from('app_users')
      .select('name, email')
      .eq('id', entry.actor_id)
      .maybeSingle();
    actorName = actor?.name || actor?.email || '';
  }

  // Tenant leads the TITLE because the first question on seeing one of these is
  // always "which operator?" — and on a lock screen the title is the only part
  // guaranteed not to be truncated.
  const title = `${tenantName} · ${labelFor(entry.action)}`;
  const details = (entry.details ?? {}) as Record<string, unknown>;
  const descriptor = [
    typeof details.reference === 'string' ? details.reference : null,
    typeof details.amount === 'number' ? `${details.amount}` : null,
    entry.entity_type,
  ].filter(Boolean).join(' · ');
  const messageBody = [actorName && `by ${actorName}`, descriptor].filter(Boolean).join(' — ') || undefined;

  // ---- Devices -------------------------------------------------------------
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, failure_count, app_user_id')
    .eq('audience', 'platform')
    .eq('is_active', true)
    .in('app_user_id', interested.map((p) => p.app_user_id));

  const recipients = subscriptions ?? [];
  if (recipients.length === 0) {
    return jsonResponse({ success: true, sent: 0, reason: 'no_devices' });
  }

  let vapid;
  try {
    vapid = getVapidKeys();
  } catch (error) {
    console.error('[PLATFORM-ACTIVITY]', error);
    return jsonResponse({ error: 'Push is not configured' }, 500);
  }

  const payload: PushPayload = {
    title,
    body: messageBody,
    // Deep-link into the audit log rather than the dashboard, so tapping the
    // notification lands on the event it was about.
    url: '/admin/audit-logs',
    // Distinct per action so a burst of different events stacks, while repeats
    // of the SAME event collapse instead of filling the tray.
    tag: `platform-${entry.action}`,
    data: { auditLogId: entry.id, action: entry.action, tenantId: entry.tenant_id },
  };

  const results = await mapLimit(recipients, SEND_CONCURRENCY, async (sub) => ({
    sub,
    result: await sendWebPush({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload, vapid),
  }));

  const nowIso = new Date().toISOString();
  const succeeded = results.filter((r) => r.result.ok).map((r) => r.sub.id);
  const expired = results.filter((r) => r.result.expired).map((r) => r.sub.id);

  const bookkeeping: Promise<unknown>[] = [
    supabase.from('push_notification_log').insert(
      results.map(({ sub, result }) => ({
        tenant_id: entry.tenant_id,
        subscription_id: sub.id,
        endpoint: sub.endpoint,
        audience: 'platform',
        title,
        body: messageBody ?? null,
        url: payload.url ?? null,
        status: result.ok ? 'sent' : result.expired ? 'expired' : 'failed',
        http_status: result.status || null,
        error: result.error ?? null,
        source: `activity:${entry.action}`,
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

  console.log(`[PLATFORM-ACTIVITY] ${entry.action} (${tenantName}) -> sent=${succeeded.length}/${recipients.length}`);
  return jsonResponse({
    success: true,
    sent: succeeded.length,
    total: recipients.length,
    expired: expired.length,
  });
});
