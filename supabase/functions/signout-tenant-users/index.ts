import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
}

/**
 * Force-logout every user of a tenant by REVOKING their sessions.
 *
 * NOTE: the previous implementation called `auth.admin.signOut(auth_user_id, 'global')`,
 * but that admin method expects the user's ACCESS-TOKEN JWT, not their user-id — so it
 * failed on every user ("invalid JWT: token contains an invalid number of segments")
 * and never actually signed anyone out. GoTrue exposes no admin "logout by user-id"
 * endpoint, so the correct way to revoke sessions server-side is to delete the user's
 * rows from `auth.sessions` (refresh_tokens cascade via session_id FK). We do that over
 * the direct Postgres connection that the edge runtime injects as SUPABASE_DB_URL.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders, status: 200 })
  }

  let sql: ReturnType<typeof postgres> | null = null
  try {
    const { tenantId } = await req.json()
    if (!tenantId) {
      return new Response(JSON.stringify({ error: 'tenantId is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      })
    }

    console.log(`Force-logout: revoking sessions for tenant ${tenantId}`)

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1) Collect the tenant's auth user ids
    const { data: appUsers, error: fetchError } = await supabaseAdmin
      .from('app_users')
      .select('auth_user_id, email')
      .eq('tenant_id', tenantId)

    if (fetchError) {
      console.error('Error fetching app users:', fetchError)
      return new Response(JSON.stringify({ error: 'Failed to fetch tenant users' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
      })
    }

    const userIds = (appUsers ?? []).map((u) => u.auth_user_id).filter(Boolean) as string[]
    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No users found for this tenant', signedOutCount: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // 2) Revoke every session for those users (refresh_tokens cascade on session delete)
    const dbUrl = Deno.env.get('SUPABASE_DB_URL')
    if (!dbUrl) {
      return new Response(JSON.stringify({ error: 'SUPABASE_DB_URL not available in runtime' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
      })
    }
    sql = postgres(dbUrl, { prepare: false })

    const deletedSessions = await sql`
      DELETE FROM auth.sessions
      WHERE user_id IN ${sql(userIds)}
      RETURNING id
    `
    // Belt-and-suspenders: clear any orphaned refresh tokens not covered by the cascade
    await sql`DELETE FROM auth.refresh_tokens WHERE user_id::text = ANY(${userIds})`

    const signedOutCount = deletedSessions.length
    console.log(`Revoked ${signedOutCount} session(s) across ${userIds.length} user(s)`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Revoked ${signedOutCount} session(s) for ${userIds.length} user(s)`,
        signedOutCount,
        userCount: userIds.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error in signout-tenant-users:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
    })
  } finally {
    if (sql) { try { await sql.end() } catch (_) { /* ignore */ } }
  }
})
