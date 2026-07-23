import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ForceLogoutRequest {
  tenantId?: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Force-logout all users of a tenant (or, globally, of every tenant) by
 * REVOKING their Supabase sessions server-side.
 *
 * Why the rewrite: the previous version called
 * `supabaseAdmin.auth.admin.signOut(auth_user_id, 'global')`. That admin method
 * expects the user's ACCESS-TOKEN JWT, not a user-id UUID, so GoTrue rejected
 * every call ("invalid JWT: token contains an invalid number of segments").
 * Worse, supabase-js RETURNS that error instead of throwing, so the old loop
 * counted each failure as a success and reported "Successfully logged out N
 * users" while revoking absolutely nothing — the "decorative button" bug.
 *
 * The correct, GoTrue-supported way to revoke sessions by user id is to delete
 * the rows from `auth.sessions` (refresh_tokens cascade / are cleared too). That
 * kills the refresh token so the session cannot be renewed. To make logout
 * *immediate* (rather than waiting up to an access-token lifetime for the next
 * refresh to fail), we also emit a realtime BROADCAST on the tenant's auth
 * channel; the portal's `useSessionGuard` listens and signs the operator out at
 * once. Broadcast — not postgres_changes — so it never depends on the
 * `supabase_realtime` publication being configured.
 */
Deno.serve(async (req) => {
  console.log('admin-force-logout function called')

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // ── AuthN: require a bearer token ──────────────────────────────────────
    const authHeader = req.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('No authorization header provided')
      return json({ error: 'Unauthorized' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Client bound to the caller's JWT — used only to identify + authorize them.
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    // Service-role client for privileged reads (bypasses RLS).
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // ── AuthZ: caller must be a super admin ────────────────────────────────
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      console.error('Failed to verify user session:', userError)
      return json({ error: 'Invalid session' }, 401)
    }

    const { data: currentUserData, error: roleError } = await supabase
      .from('app_users')
      .select('id, role, is_active, is_super_admin')
      .eq('auth_user_id', user.id)
      .single()

    if (roleError || !currentUserData) {
      console.error('Failed to get user role:', roleError)
      return json({ error: 'User not found' }, 404)
    }

    if (!currentUserData.is_super_admin) {
      console.error('User is not a super admin')
      return json({ error: 'Only super admins can force logout users' }, 403)
    }

    const { tenantId }: ForceLogoutRequest = await req.json().catch(() => ({}))
    const isGlobal = !tenantId

    console.log(isGlobal ? 'Global force logout requested' : `Force logout for tenant: ${tenantId}`)

    // ── Collect the auth user ids to revoke ────────────────────────────────
    const authUserIds: string[] = []
    // Super admins are NEVER revoked on a global logout — track them so we can
    // also exclude any that slip in via customer_users (a super admin who is
    // also a booking customer).
    const superAdminIds = new Set<string>()

    // Portal staff
    const appUsersQuery = supabaseAdmin
      .from('app_users')
      .select('auth_user_id, is_super_admin')
    if (tenantId) appUsersQuery.eq('tenant_id', tenantId)

    const { data: appUsers, error: appUsersError } = await appUsersQuery
    if (appUsersError) {
      console.error('Error fetching app_users:', appUsersError)
    } else if (appUsers) {
      for (const u of appUsers) {
        if (u.is_super_admin && u.auth_user_id) superAdminIds.add(u.auth_user_id)
        // Never revoke a super admin on a GLOBAL logout — that would lock out
        // the caller and every other platform admin.
        if (isGlobal && u.is_super_admin) continue
        if (u.auth_user_id) authUserIds.push(u.auth_user_id)
      }
    }

    // Booking customers
    const customerUsersQuery = supabaseAdmin
      .from('customer_users')
      .select('auth_user_id')
    if (tenantId) customerUsersQuery.eq('tenant_id', tenantId)

    const { data: customerUsers, error: customerUsersError } = await customerUsersQuery
    if (customerUsersError) {
      console.error('Error fetching customer_users:', customerUsersError)
    } else if (customerUsers) {
      for (const u of customerUsers) {
        if (u.auth_user_id) authUserIds.push(u.auth_user_id)
      }
    }

    // On a global logout, defensively drop any super-admin id that slipped in
    // through customer_users, so a platform admin can never be caught by it.
    const uniqueIds = [...new Set(authUserIds)].filter(
      (id) => !(isGlobal && superAdminIds.has(id)),
    )
    console.log(`Found ${uniqueIds.length} user(s) to force logout`)

    // ── Revoke sessions server-side (the ACTUAL logout) ────────────────────
    // Revoke via rpc() to a SECURITY DEFINER function over PostgREST (pure HTTP).
    // We do NOT open a direct postgres.js connection: it crashes in the current
    // Supabase Edge runtime ("Deno.core.runMicrotasks() is not supported"), which
    // made this function throw a non-2xx and revoke nothing.
    let revokedSessions = 0
    if (uniqueIds.length > 0) {
      const { data: revoked, error: revokeError } = await supabaseAdmin.rpc(
        'admin_revoke_user_sessions',
        { p_user_ids: uniqueIds },
      )
      if (revokeError) {
        // Do NOT report a false success — surface the failure.
        console.error('Failed to revoke sessions:', revokeError)
        return json(
          { error: `Failed to revoke sessions: ${revokeError.message}` },
          500,
        )
      }
      revokedSessions = typeof revoked === 'number' ? revoked : 0
      console.log(`Revoked ${revokedSessions} session(s) across ${uniqueIds.length} user(s)`)
    }

    // ── Instant client eviction via realtime broadcast (best-effort) ───────
    // The session deletion above is authoritative even if this fails; the
    // portal's mount/focus re-validation is the backstop for a missed message.
    const topic = tenantId ? `tenant:${tenantId}:auth` : 'platform:auth'
    try {
      const resp = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          messages: [
            {
              topic,
              event: 'force_logout',
              payload: { tenantId: tenantId ?? null },
              private: false,
            },
          ],
        }),
      })
      if (!resp.ok) {
        console.warn(`Force-logout broadcast returned ${resp.status} (sessions already revoked)`)
      }
    } catch (broadcastError) {
      console.warn('Force-logout broadcast failed (sessions already revoked):', broadcastError)
    }

    // ── Audit ──────────────────────────────────────────────────────────────
    try {
      await supabaseAdmin.from('audit_logs').insert({
        actor_id: currentUserData.id,
        action: isGlobal ? 'force_logout_global' : 'force_logout_tenant',
        tenant_id: tenantId || null,
        details: {
          target_tenant_id: tenantId || 'all',
          total_users: uniqueIds.length,
          revoked_sessions: revokedSessions,
        },
      })
    } catch (auditError) {
      console.warn('Failed to write audit log:', auditError)
    }

    // Response contract preserved for the admin UI: it reads successCount /
    // failCount. Every targeted user is now guaranteed to have no live session,
    // so successCount === uniqueIds.length and failCount === 0. revokedSessions
    // is the extra detail (how many sessions were actually live).
    return json({
      success: true,
      totalUsers: uniqueIds.length,
      successCount: uniqueIds.length,
      failCount: 0,
      revokedSessions,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return json({ error: 'Internal server error' }, 500)
  }
})
