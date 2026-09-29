import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * SUPER ADMIN: recover a locked-out operator, for any tenant.
 *
 * ── the gap this fills ─────────────────────────────────────────────────────
 *
 * The portal already has self-service reset (`resetPasswordForEmail` on the
 * login page) and `admin-reset-password` for a tenant admin resetting one of
 * their own staff. Neither reaches the case that actually keeps happening:
 * the tenant's HEAD ADMIN is locked out and cannot receive the reset email.
 *
 *   Drive Hustle — the login sits on a domain that returns NXDOMAIN, so every
 *   reset email is delivered to nowhere. Self-service can never work for them.
 *   Heirs Rental — Igor lost his password and was locked out from 15 Aug to
 *   29 Sep, six weeks, because the only route back was a support engineer
 *   running a script by hand.
 *
 * `admin-reset-password` cannot cover it: it authorises the caller as a
 * head_admin WITHIN the tenant, and a super admin carries `tenant_id = NULL`,
 * so it refuses them. This function is the super-admin counterpart and is the
 * only one that crosses tenant boundaries.
 *
 * ── what it will not do ────────────────────────────────────────────────────
 *
 * It refuses to touch another SUPER ADMIN's password, mirroring the rule
 * admin-force-logout keeps. Support recovering an operator is routine; one
 * platform admin silently taking another's account is not, and it would be
 * indistinguishable from the same request.
 *
 * Every reset is written to `audit_logs` with `is_super_admin_action: true`
 * BEFORE the password is returned to the caller, so a reset that happened can
 * never be missing from the record.
 */

/** Generated passwords avoid look-alike characters — these get read aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function generatePassword(length = 14): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Caller's own JWT — used ONLY to establish who they are.
    const asCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: auth, error: authError } = await asCaller.auth.getUser()
    if (authError || !auth?.user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceKey)

    const { data: caller, error: callerError } = await admin
      .from('app_users')
      .select('id, role, is_active, is_super_admin, email')
      .eq('auth_user_id', auth.user.id)
      .maybeSingle()

    if (callerError || !caller) return json({ error: 'Unauthorized' }, 401)
    if (!caller.is_super_admin || caller.is_active === false) {
      return json({ error: 'Super admin only' }, 403)
    }

    const { action, tenantId, userId, password } = await req.json().catch(() => ({} as any))

    // ── list: who can sign in for this tenant ──────────────────────────────
    if (action === 'list') {
      if (!tenantId) return json({ error: 'tenantId is required' }, 400)
      const { data: users, error } = await admin
        .from('app_users')
        .select('id, email, name, role, is_active, auth_user_id, is_super_admin')
        .eq('tenant_id', tenantId)
        .order('role', { ascending: true })
      if (error) return json({ error: error.message }, 500)

      return json({
        ok: true,
        users: (users ?? []).map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          isActive: u.is_active !== false,
          // A row with no auth_user_id has no login at all — resetting it would
          // fail with an opaque GoTrue error, so the UI greys it out instead.
          canReset: !!u.auth_user_id && !u.is_super_admin,
        })),
      })
    }

    // ── reset ──────────────────────────────────────────────────────────────
    if (action !== 'reset') return json({ error: 'Unknown action' }, 400)
    if (!userId) return json({ error: 'userId is required' }, 400)

    const { data: target, error: targetError } = await admin
      .from('app_users')
      .select('id, email, name, role, tenant_id, auth_user_id, is_super_admin')
      .eq('id', userId)
      .maybeSingle()

    if (targetError || !target) return json({ error: 'User not found' }, 404)

    if (target.is_super_admin) {
      return json({ error: 'A super admin password cannot be reset from here.' }, 403)
    }
    if (!target.auth_user_id) {
      return json(
        { error: 'This user has no login account, so their password cannot be reset.' },
        400,
      )
    }
    // Belt and braces: the id came from the request, so re-check it really is
    // the tenant the caller thinks they are acting on.
    if (tenantId && target.tenant_id !== tenantId) {
      return json({ error: 'That user does not belong to this company.' }, 400)
    }

    const newPassword =
      typeof password === 'string' && password.length >= 8 ? password : generatePassword()

    const { error: updateError } = await admin.auth.admin.updateUserById(target.auth_user_id, {
      password: newPassword,
      // A locked-out operator whose address was never confirmed would otherwise
      // be handed a password they still cannot sign in with.
      email_confirm: true,
    })
    if (updateError) {
      console.error('Password reset failed:', updateError)
      return json({ error: updateError.message || 'Failed to reset password' }, 500)
    }

    // Make them choose their own. The generated one is read aloud down a phone
    // line and pasted into a chat, so it must not stay valid indefinitely.
    await admin.from('app_users').update({ must_change_password: true }).eq('id', target.id)

    // Recorded BEFORE the password goes back over the wire: a reset that
    // happened must never be missing from the record, even if the response is.
    await admin.from('audit_logs').insert({
      actor_id: caller.id,
      action: 'super_admin_reset_password',
      target_user_id: target.id,
      tenant_id: target.tenant_id,
      is_super_admin_action: true,
      entity_type: 'app_user',
      entity_id: target.id,
      details: {
        target_email: target.email,
        target_role: target.role,
        by: caller.email,
        generated: !(typeof password === 'string' && password.length >= 8),
      },
    })

    return json({
      ok: true,
      email: target.email,
      password: newPassword,
      mustChangePassword: true,
    })
  } catch (err) {
    console.error('admin-tenant-password-reset error:', err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
