import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getTenantBonzahCredentials,
  getBonzahTokenForCredentials,
  getBonzahApiUrl,
} from '../_shared/bonzah-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface ViewPolicyRequest {
  tenant_id: string
  policy_id: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: ViewPolicyRequest = await req.json()

    if (!body.tenant_id || !body.policy_id) {
      return errorResponse('Missing tenant_id or policy_id')
    }

    console.log('[Bonzah Policy] Viewing policy:', body.policy_id, 'for tenant:', body.tenant_id)

    // Get tenant credentials
    const credentials = await getTenantBonzahCredentials(supabase, body.tenant_id)
    const apiUrl = getBonzahApiUrl(credentials.mode)
    const token = await getBonzahTokenForCredentials(credentials.username, credentials.password, apiUrl)

    // Fetch policy details from Bonzah
    const policyUrl = `${apiUrl}/Bonzah/policy?policy_id=${encodeURIComponent(body.policy_id)}`

    console.log('[Bonzah Policy] Fetching from:', policyUrl)

    const policyResponse = await fetch(policyUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'in-auth-token': token,
      },
    })

    const responseText = await policyResponse.text()

    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch {
      console.error('[Bonzah Policy] Failed to parse response:', responseText)
      return errorResponse('Failed to parse Bonzah API response', 500)
    }

    if (responseData.status !== 0) {
      console.error('[Bonzah Policy] API error:', responseData)
      return errorResponse(`Bonzah API error: ${responseData.txt || 'Unknown error'}`, 500)
    }

    console.log('[Bonzah Policy] Policy data retrieved successfully')

    return jsonResponse({
      policy: responseData.data,
    })
  } catch (error) {
    console.error('[Bonzah Policy] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to view policy',
      500
    )
  }
})
