import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { getBonzahTokenForCredentials, getBonzahApiUrl } from '../_shared/bonzah-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface VerifyCredentialsRequest {
  username: string
  password: string
  mode: 'test' | 'live'
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const body: VerifyCredentialsRequest = await req.json()

    if (!body.username || !body.password) {
      return errorResponse('Missing username or password')
    }

    if (!body.mode || !['test', 'live'].includes(body.mode)) {
      return errorResponse('Invalid mode. Must be "test" or "live"')
    }

    const apiUrl = getBonzahApiUrl(body.mode)

    console.log('[Bonzah Verify] Verifying credentials against', body.mode, 'API for:', body.username)

    try {
      const token = await getBonzahTokenForCredentials(body.username, body.password, apiUrl)

      return jsonResponse({
        valid: true,
        email: body.username,
      })
    } catch (authError) {
      console.log('[Bonzah Verify] Credentials invalid:', authError)
      return jsonResponse({
        valid: false,
        error: authError instanceof Error ? authError.message : 'Authentication failed',
      })
    }
  } catch (error) {
    console.error('[Bonzah Verify] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to verify credentials',
      500
    )
  }
})
