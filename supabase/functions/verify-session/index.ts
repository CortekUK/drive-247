import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'

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
 * Decode a JWT payload WITHOUT verifying its signature. This function runs with
 * verify_jwt = true (the default), so the platform has already verified the
 * token's signature and expiry before we get here — we only need to read the
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
 * This exists because `admin-force-logout` revokes a session by DELETING its
 * `auth.sessions` row, but the access JWT already in the browser stays valid
 * until it expires (~1h) and `getSession()` reads it straight from localStorage
 * with no server round-trip — so a tenant who reopens the portal after being
 * force-logged-out would otherwise be let straight back in. The portal's
 * `useSessionGuard` calls this on mount and on tab focus; a `{ valid: false }`
 * answer means "your session was revoked" and it signs the operator out.
 *
 * Fail-open contract: we return `{ valid: true }` for EVERY ambiguous case
 * (missing/malformed token, no DB URL, a query error). Only a successful query
 * that finds no matching session row returns `{ valid: false }`. Combined with
 * useSessionGuard acting solely on an explicit `valid === false`, a transient
 * fault can never log out a working operator.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let sql: ReturnType<typeof postgres> | null = null
  try {
    const authHeader = req.headers.get('authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return json({ valid: true }) // fail open

    const claims = decodeJwtPayload(jwt)
    const userId = typeof claims?.sub === 'string' ? claims.sub : undefined
    const rawSession = claims?.session_id ?? claims?.sid
    const sessionId = typeof rawSession === 'string' ? rawSession : undefined
    if (!userId && !sessionId) return json({ valid: true }) // fail open

    const dbUrl = Deno.env.get('SUPABASE_DB_URL')
    if (!dbUrl) return json({ valid: true }) // fail open

    sql = postgres(dbUrl, { prepare: false })

    // Prefer the exact session id from the token; fall back to "does this user
    // have ANY live session" for older tokens that lack a session_id claim.
    // Text-cast comparison avoids any uuid-vs-text operator error.
    const rows = sessionId
      ? await sql`SELECT 1 FROM auth.sessions WHERE id::text = ${sessionId} LIMIT 1`
      : await sql`SELECT 1 FROM auth.sessions WHERE user_id::text = ${userId} LIMIT 1`

    return json({ valid: rows.length > 0 })
  } catch (error) {
    console.error('verify-session error (failing open):', error)
    return json({ valid: true }) // fail open on ANY error
  } finally {
    if (sql) {
      try {
        await sql.end()
      } catch (_) {
        /* ignore */
      }
    }
  }
})
