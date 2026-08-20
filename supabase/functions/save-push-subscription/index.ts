// save-push-subscription
//
// Records (or retires) the Web Push subscription a browser just handed us.
//
// verify_jwt = false ON PURPOSE. The whole point of device-scoped push is that a
// visitor who has NEVER logged in can still be reached — an abandoned booking,
// a vehicle back in stock. Requiring a JWT here would make that impossible, so
// the function does its own graded auth instead:
//
//   * customer audience — anonymous is allowed. If a Bearer token happens to be
//     present we resolve it and back-link the row to the customer, so the same
//     device silently gains identity the moment they sign in.
//   * staff audience — a valid portal JWT is REQUIRED and must belong to the
//     tenant being subscribed. Operator devices receive internal notifications;
//     anonymous enrolment there would be a broadcast channel into the business.
//
// Being unauthenticated, the customer path is hardened by shape rather than by
// identity: the endpoint must belong to a real push service, the tenant must
// exist AND have the feature flag on, and `endpoint` is UNIQUE so a replay
// updates one row rather than growing the table.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

/**
 * A subscription endpoint is minted by the browser's own push service, so its
 * host is not attacker-chosen in any legitimate flow. Pinning the set stops the
 * table being used to store arbitrary URLs, and stops `send-push` being turned
 * into a request forwarder aimed at a host of someone else's choosing.
 */
const ALLOWED_ENDPOINT_HOSTS = [
  'android.googleapis.com',
  'fcm.googleapis.com',
  'web.push.apple.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'push.services.mozilla.com',
];

const VALID_PLATFORMS = new Set(['ios', 'android', 'desktop', 'unknown']);
const VALID_AUDIENCES = new Set(['customer', 'staff']);

function endpointHostAllowed(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return ALLOWED_ENDPOINT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
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
    console.error('[PUSH-SUB] Missing Supabase environment configuration');
    return jsonResponse({ error: 'Server is not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const action = body.action === 'unsubscribe' ? 'unsubscribe' : 'subscribe';
  const audience = String(body.audience ?? 'customer');
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint : body?.subscription?.endpoint;

  if (!VALID_AUDIENCES.has(audience)) {
    return jsonResponse({ error: 'audience must be "customer" or "staff"' }, 400);
  }
  if (typeof endpoint !== 'string' || !endpointHostAllowed(endpoint)) {
    return jsonResponse({ error: 'Unrecognised push endpoint' }, 400);
  }

  // -------------------------------------------------------------------------
  // Unsubscribe is identity-free by design: the caller proves possession of the
  // endpoint, which is a per-device secret. Anyone holding it already controls
  // the device it points at, so nothing extra is protected by demanding a JWT —
  // and a signed-out browser must still be able to turn notifications off.
  // -------------------------------------------------------------------------
  if (action === 'unsubscribe') {
    const { error } = await supabase
      .from('push_subscriptions')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('endpoint', endpoint);

    if (error) {
      console.error('[PUSH-SUB] Unsubscribe failed:', error.message);
      return jsonResponse({ error: 'Could not remove subscription' }, 500);
    }
    return jsonResponse({ success: true, action: 'unsubscribed' });
  }

  // ---- Subscribe ----------------------------------------------------------
  const p256dh = body?.keys?.p256dh ?? body?.subscription?.keys?.p256dh;
  const auth = body?.keys?.auth ?? body?.subscription?.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth) {
    return jsonResponse({ error: 'Subscription keys (p256dh, auth) are required' }, 400);
  }

  const deviceId = typeof body.deviceId === 'string' && body.deviceId.length <= 100
    ? body.deviceId
    : crypto.randomUUID();
  const platform = VALID_PLATFORMS.has(String(body.platform)) ? String(body.platform) : 'unknown';
  const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : null;
  const isStandalone = body.isStandalone === true;

  // ---- Resolve the tenant -------------------------------------------------
  const tenantSlug = typeof body.tenantSlug === 'string' ? body.tenantSlug : null;
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : null;
  if (!tenantSlug && !tenantId) {
    return jsonResponse({ error: 'tenantSlug or tenantId is required' }, 400);
  }

  const tenantQuery = supabase
    .from('tenants')
    .select('id, slug, push_notifications_enabled');
  const { data: tenant } = tenantId
    ? await tenantQuery.eq('id', tenantId).maybeSingle()
    : await tenantQuery.eq('slug', tenantSlug!).maybeSingle();

  if (!tenant) {
    return jsonResponse({ error: 'Unknown tenant' }, 404);
  }

  // The feature flag is enforced HERE, not only in the UI. A hidden button is
  // not an access control, and this endpoint is reachable without a session.
  if (!tenant.push_notifications_enabled) {
    return jsonResponse({ error: 'Push notifications are not enabled for this account', code: 'push_disabled' }, 403);
  }

  // ---- Graded auth --------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  let customerId: string | null = null;
  let appUserId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData } = await callerClient.auth.getUser();
    const authUser = authData?.user;

    if (authUser) {
      if (audience === 'staff') {
        const { data: appUser } = await supabase
          .from('app_users')
          .select('id, tenant_id, is_active, is_super_admin')
          .eq('auth_user_id', authUser.id)
          .maybeSingle();
        // A super admin has tenant_id NULL by design, so they are matched on
        // the flag rather than on tenant equality.
        const belongs = appUser?.is_super_admin === true || appUser?.tenant_id === tenant.id;
        if (appUser?.is_active && belongs) appUserId = appUser.id;
      } else {
        const { data: customerUser } = await supabase
          .from('customer_users')
          .select('customer_id, tenant_id')
          .eq('auth_user_id', authUser.id)
          .eq('tenant_id', tenant.id)
          .maybeSingle();
        if (customerUser) customerId = customerUser.customer_id;
      }
    }
  }

  if (audience === 'staff' && !appUserId) {
    return jsonResponse({ error: 'Sign in to the portal to enable notifications on this device' }, 401);
  }

  // ---- Upsert on endpoint -------------------------------------------------
  // `endpoint` is the unique key, so a browser that re-subscribes (key rotation,
  // permission re-grant) updates its row instead of creating a duplicate that
  // would deliver every notification twice.
  const now = new Date().toISOString();
  const row = {
    tenant_id: tenant.id,
    audience,
    endpoint,
    p256dh,
    auth,
    device_id: deviceId,
    platform,
    user_agent: userAgent,
    is_standalone: isStandalone,
    is_active: true,
    failure_count: 0,
    last_error: null,
    revoked_at: null,
    last_seen_at: now,
    // Only ever ADD identity — a logged-out re-subscribe must not wipe the link
    // established while the user was signed in on this same device.
    ...(customerId ? { customer_id: customerId } : {}),
    ...(appUserId ? { app_user_id: appUserId } : {}),
  };

  const { data: saved, error } = await supabase
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' })
    .select('id, tenant_id, audience, customer_id, app_user_id')
    .single();

  if (error) {
    console.error('[PUSH-SUB] Upsert failed:', error.message);
    return jsonResponse({ error: 'Could not save subscription' }, 500);
  }

  console.log(`[PUSH-SUB] ${audience} device registered for ${tenant.slug} (platform=${platform}, standalone=${isStandalone}, linked=${Boolean(customerId || appUserId)})`);

  return jsonResponse({
    success: true,
    action: 'subscribed',
    subscriptionId: saved.id,
    linked: Boolean(saved.customer_id || saved.app_user_id),
  });
});
