import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Decode a JWT payload WITHOUT verifying its signature. The platform already
 * verified it (verify_jwt = true) before this function runs; we only need the
 * claims. Returns null on any malformed input.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4
    if (pad) b64 += '='.repeat(4 - pad)
    return JSON.parse(atob(b64))
  } catch {
    return null
  }
}

/**
 * Is the caller's Supabase session still alive server-side?
 *
 * Detects a session that `admin-force-logout` revoked (deleted from
 * `auth.sessions`) while the caller's access JWT is still cached in the browser,
 * so the portal's `useSessionGuard` can sign them out on reopen/focus.
 *
 * Checks `auth.sessions` via rpc() to the SECURITY DEFINER `session_is_active`
 * over PostgREST (pure HTTP). We do NOT open a direct postgres.js connection: it
 * crashes in the current Supabase Edge runtime ("Deno.core.runMicrotasks() is not
 * supported"), which made this throw and (correctly) fail open on every call —
 * so a revoked session was never actually detected.
 *
 * Fail-open contract: returns { valid: true } for EVERY ambiguous case
 * (missing/malformed token, no ids, rpc error). Only a definitive rpc result of
 * "no such session" returns { valid: false }. Combined with useSessionGuard
 * acting solely on an explicit valid === false, a transient fault can never log
 * out a working operator.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ valid: true }) // fail open

    const claims = decodeJwtPayload(jwt)
    const userId = typeof claims?.sub === 'string' ? claims.sub : ''
    const rawSession = claims?.session_id ?? claims?.sid
    const sessionId = typeof rawSession === 'string' ? rawSession : ''
    if (!userId && !sessionId) return json({ valid: true }) // fail open

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: active, error } = await supabaseAdmin.rpc('session_is_active', {
      p_session_id: sessionId,
      p_user_id: userId,
    })
    if (error) {
      console.error('verify-session rpc error (failing open):', error)
      return json({ valid: true }) // fail open
    }

    return json({ valid: active === true })
  } catch (error) {
    console.error('verify-session error (failing open):', error)
    return json({ valid: true }) // fail open on ANY error
  }
})
