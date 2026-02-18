import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { getBonzahTokenForCredentials, getBonzahApiUrl } from '../_shared/bonzah-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface VerifyCredentialsRequest {
  username: string
  password: string
  tenantId: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const body: VerifyCredentialsRequest = await req.json()

    if (!body.username || !body.password) {
      return errorResponse('Missing username or password')
    }

    if (!body.tenantId) {
      return errorResponse('Missing tenantId')
    }

    // Fetch the tenant's bonzah_mode from the DB (source of truth)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: tenant, error: tenantError } = await serviceClient
      .from('tenants')
      .select('bonzah_mode')
      .eq('id', body.tenantId)
      .single()

    if (tenantError || !tenant) {
      return errorResponse('Could not fetch tenant settings')
    }

    const mode = tenant.bonzah_mode || 'test'
    const apiUrl = getBonzahApiUrl(mode)

    console.log('[Bonzah Verify] Verifying credentials against', mode, 'API for:', body.username)

    try {
      const token = await getBonzahTokenForCredentials(body.username, body.password, apiUrl)

      return jsonResponse({
        valid: true,
        email: body.username,
        mode,
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
