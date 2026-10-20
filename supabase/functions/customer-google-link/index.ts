// customer-google-link — "Continue with Google" on a customer site (the
// customer portal v2's sign-in and sign-up pages).
//
// Google sign-in leaves the browser with a Supabase session for an auth user,
// but being signed in is not being a CUSTOMER of this operator: that is the
// `customer_users` link (auth user → customer, one per tenant). Email sign-up
// creates the link through `customer-signup`; a Google account has no password
// to hand that function, so this one does the same for the user the caller
// already IS:
//
//   1. the caller is the verified auth user behind the JWT (verify_jwt stays
//      ON, and `auth.getUser(token)` is what actually identifies them: the
//      gateway also admits the anon key, which is a JWT but no user). Never a
//      user id or email from the body;
//   2. their email must be confirmed (Google confirms it), because an existing
//      customer record is claimed by matching it;
//   3. the tenant must exist; it comes from the body, which is fine: all the
//      caller can choose is which operator they become a customer of, which a
//      sign-up form lets anyone do;
//   4. a blocked address is refused before anything is written: the global
//      blacklist (unless whitelisted) and this operator's blocked identities,
//      the checks the customer sign-in and sign-up run;
//   5. already linked for this tenant → nothing to do. Otherwise an existing
//      customer of this operator with the same email is claimed (a guest
//      booking, or one staff created), unless another login already holds it;
//      failing that a customer is created as `customer-signup` creates one
//      (Individual, Active), with the welcome notification.
//
// Replies: 200 { ok, customer_id, created } · 400 bad request · 401 no user ·
// 403 { ok:false, code:'blocked'|'unverified'|'taken', error } · 500.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOCKED = 'This account has been blocked. Please contact support if you think that is a mistake.';

const respond = (body: Record<string, unknown>, status = 200) => {
  const response = jsonResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

const bearer = (value: string | null) => {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
  return match ? match[1].trim() : null;
};

/** `ilike` treats `_` and `%` as wildcards; an email may hold `_`. */
const likeExact = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

Deno.serve(async (req: Request) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== 'POST') return respond({ ok: false, error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return respond({ ok: false, error: 'Sign-in is not set up yet.' }, 503);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { tenant_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: 'The request could not be read.' }, 400);
  }
  const tenantId = typeof body?.tenant_id === 'string' ? body.tenant_id : '';
  if (!UUID_RE.test(tenantId)) return respond({ ok: false, error: 'The request could not be read.' }, 400);

  // 1. Who is calling.
  const token = bearer(req.headers.get('authorization'));
  if (!token) return respond({ ok: false, error: 'Sign in to continue.' }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return respond({ ok: false, error: 'Your session has expired. Sign in again.' }, 401);

  // 2. A confirmed email, the thing an existing customer record is matched on.
  const email = (user.email ?? '').trim().toLowerCase();
  if (!email || !user.email_confirmed_at) {
    return respond({ ok: false, code: 'unverified', error: 'Your Google account has no confirmed email address.' }, 403);
  }

  try {
    // 3. The operator.
    const { data: tenant, error: tenantError } = await admin.from('tenants').select('id').eq('id', tenantId).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return respond({ ok: false, error: 'The request could not be read.' }, 400);

    // 4. Blocked addresses, before anything is written.
    const [{ data: globally }, { data: locally }] = await Promise.all([
      admin.from('global_blacklist').select('id, is_whitelisted').eq('email', email).maybeSingle(),
      admin
        .from('blocked_identities')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('identity_number', email)
        .eq('is_active', true)
        .in('identity_type', ['license', 'id_card', 'passport', 'email'])
        .limit(1)
        .maybeSingle(),
    ]);
    if ((globally && !globally.is_whitelisted) || locally) {
      return respond({ ok: false, code: 'blocked', error: BLOCKED }, 403);
    }

    // 5a. Already a customer here.
    const { data: link, error: linkReadError } = await admin
      .from('customer_users')
      .select('id, customer_id')
      .eq('auth_user_id', user.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (linkReadError) throw linkReadError;
    if (link) return respond({ ok: true, customer_id: link.customer_id, created: false });

    // 5b. An existing customer of this operator with this email.
    const { data: candidates, error: lookupError } = await admin
      .from('customers')
      .select('id, email')
      .eq('tenant_id', tenantId)
      .ilike('email', likeExact(email))
      .order('created_at', { ascending: true })
      .limit(5);
    if (lookupError) throw lookupError;
    const existing = (candidates ?? []).find((c) => (c.email ?? '').trim().toLowerCase() === email) ?? null;

    let customerId: string;
    let created = false;
    if (existing) {
      // Another login already holds this customer: that person signs in with
      // their own method, and Google must not take the record over.
      const { data: held, error: heldError } = await admin
        .from('customer_users')
        .select('id')
        .eq('customer_id', existing.id)
        .eq('tenant_id', tenantId)
        .neq('auth_user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (heldError) throw heldError;
      if (held) {
        return respond({
          ok: false,
          code: 'taken',
          error: 'An account with this email already exists here. Sign in with your email and password instead.',
        }, 403);
      }
      customerId = existing.id;
    } else {
      // 5c. A new customer, as customer-signup creates one.
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const name = [meta.full_name, meta.name].find((v): v is string => typeof v === 'string' && v.trim() !== '')?.trim() ?? email.split('@')[0];
      const { data: customer, error: insertError } = await admin
        .from('customers')
        .insert({ email, name, phone: null, tenant_id: tenantId, type: 'Individual', status: 'Active' })
        .select('id')
        .single();
      if (insertError || !customer) throw insertError ?? new Error('no customer');
      customerId = customer.id;
      created = true;
    }

    const { data: customerUser, error: linkError } = await admin
      .from('customer_users')
      .insert({ auth_user_id: user.id, customer_id: customerId, tenant_id: tenantId })
      .select('id')
      .single();
    if (linkError) {
      // 23505: a second tab linked them first, which is the outcome wanted.
      if (linkError.code === '23505') return respond({ ok: true, customer_id: customerId, created: false });
      if (created) await admin.from('customers').delete().eq('id', customerId);
      throw linkError;
    }

    if (created) {
      await admin.from('customer_notifications').insert({
        customer_user_id: customerUser.id,
        tenant_id: tenantId,
        title: 'Welcome to Drive247!',
        message: 'Your account has been created successfully. You can now view your bookings and manage your profile.',
        type: 'welcome',
      });
    }

    return respond({ ok: true, customer_id: customerId, created });
  } catch (e) {
    console.error('[customer-google-link] failed:', e);
    return respond({ ok: false, error: 'We could not finish signing you in. Try again.' }, 500);
  }
});
