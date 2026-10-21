// customer-email-login — gives a Google-only customer an email sign-in, so
// they can unlink Google (customer portal v2 → Settings → Account).
//
// Supabase will not unlink an account's last identity, and setting a password
// does NOT add an `email` identity: a customer who joined with Google keeps
// exactly one identity (google) however many passwords they set. Measured on
// production with a throwaway user on 2026-10-21: after `updateUser({
// password })` the identities were still [google], and unlinking returned
// 422 single_identity_not_deletable. An admin `updateUserById(id, { email,
// email_confirm: true })` with the account's own address is what creates the
// `email` identity.
//
// So the portal runs, in order: the six-digit code to the account's address
// and `updateUser({ password })` (the operator's password flow), then this
// function, then `unlinkIdentity(google)` from the browser.
//
//   1. the caller is the verified auth user behind the JWT (verify_jwt stays
//      ON; `auth.getUser(token)` identifies them — the anon key is a JWT but
//      no user). Never a user id or an email from the body;
//   2. the account's email must be confirmed: it becomes the sign-in;
//   3. the tenant must be on V2, and the caller must be a customer of it;
//   4. already has an email identity → nothing to do. Otherwise the account's
//      OWN address is confirmed again through the admin API, which adds the
//      identity. Nothing else about the account changes.
//
// Replies: 200 { ok, created } · 400 bad request · 401 no user ·
// 403 { ok:false, code:'unverified'|'not_v2'|'not_customer', error } · 500.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { isLeanTenant, readTenantOnV2ById } from '../_shared/lean-tenants.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const respond = (body: Record<string, unknown>, status = 200) => {
  const response = jsonResponse(body, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
};

const bearer = (value: string | null) => {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
  return match ? match[1].trim() : null;
};

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

  // 2. The address that will become the sign-in.
  const email = (user.email ?? '').trim();
  if (!email || !user.email_confirmed_at) {
    return respond({ ok: false, code: 'unverified', error: 'Your account has no confirmed email address.' }, 403);
  }

  try {
    // 3. A V2 operator, and a customer of it.
    const { data: tenant, error: tenantError } = await admin.from('tenants').select('id, slug').eq('id', tenantId).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return respond({ ok: false, error: 'The request could not be read.' }, 400);
    if (!isLeanTenant(tenant.slug, await readTenantOnV2ById(admin, tenant.id))) {
      return respond({ ok: false, code: 'not_v2', error: 'This is not available on this site.' }, 403);
    }
    const { data: link, error: linkError } = await admin
      .from('customer_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) return respond({ ok: false, code: 'not_customer', error: 'Your account is not linked to this site.' }, 403);

    // 4. The identity.
    const hasEmailIdentity = (user.identities ?? []).some((identity) => identity.provider === 'email');
    if (hasEmailIdentity) return respond({ ok: true, created: false });

    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { email, email_confirm: true });
    if (updateError) throw updateError;

    const { data: after } = await admin.auth.admin.getUserById(user.id);
    const created = (after?.user?.identities ?? []).some((identity) => identity.provider === 'email');
    if (!created) return respond({ ok: false, error: 'Your email sign-in could not be added. Please try again.' }, 500);

    console.log('customer-email-login: email identity added', { user_id: user.id, tenant_id: tenantId });
    return respond({ ok: true, created: true });
  } catch (error) {
    console.error('customer-email-login failed:', error);
    return respond({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
});
