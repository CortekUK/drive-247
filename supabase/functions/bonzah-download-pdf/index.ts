import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getTenantBonzahCredentials,
  getBonzahTokenForCredentials,
  getBonzahApiUrl,
} from '../_shared/bonzah-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface DownloadPdfRequest {
  tenant_id: string
  pdf_id: string
  policy_id?: string
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: DownloadPdfRequest = await req.json()

    if (!body.tenant_id || !body.pdf_id) {
      return errorResponse('Missing tenant_id or pdf_id')
    }

    if (!body.policy_id) {
      return errorResponse('Missing policy_id')
    }

    console.log('[Bonzah PDF] Downloading PDF:', body.pdf_id, 'policy:', body.policy_id, 'tenant:', body.tenant_id)

    // Get tenant credentials and auth token
    const credentials = await getTenantBonzahCredentials(supabase, body.tenant_id)
    const apiUrl = getBonzahApiUrl(credentials.mode)
    const token = await getBonzahTokenForCredentials(credentials.username, credentials.password, apiUrl)

    // Insillion platform endpoint: GET /policy/data/{policy_id}?data_id={pdf_id}&download=1&token={token}
    // Note: Uses generic Insillion path (no /Bonzah/ prefix), token as URL-encoded query param
    const downloadUrl = `${apiUrl}/policy/data/${encodeURIComponent(body.policy_id)}?data_id=${encodeURIComponent(body.pdf_id)}&download=1&token=${encodeURIComponent(token)}`

    console.log('[Bonzah PDF] Fetching:', downloadUrl.replace(/token=[^&]+/, 'token=***'))

    const resp = await fetch(downloadUrl)

    if (!resp.ok) {
      const errorText = await resp.text()
      console.error('[Bonzah PDF] Download failed:', resp.status, errorText.substring(0, 300))
      return errorResponse(`Failed to download PDF: ${resp.status}`, resp.status)
    }

    const contentType = resp.headers.get('content-type') || ''
    console.log('[Bonzah PDF] Response content-type:', contentType, 'status:', resp.status)

    // If response is a direct PDF binary
    if (contentType.includes('application/pdf')) {
      const pdfBuffer = await resp.arrayBuffer()
      const uint8Array = new Uint8Array(pdfBuffer)
      let binary = ''
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i])
      }
      const base64 = btoa(binary)

      console.log('[Bonzah PDF] PDF downloaded, size:', pdfBuffer.byteLength, 'bytes')

      return jsonResponse({
        documentBase64: base64,
        contentType: 'application/pdf',
      })
    }

    // If response is JSON (shouldn't happen with this endpoint, but handle gracefully)
    const responseText = await resp.text()

    // Check if it starts with %PDF (binary PDF without proper content-type)
    if (responseText.startsWith('%PDF')) {
      const encoder = new TextEncoder()
      const uint8Array = encoder.encode(responseText)
      let binary = ''
      for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i])
      }
      console.log('[Bonzah PDF] PDF detected from content, size:', uint8Array.length)
      return jsonResponse({
        documentBase64: btoa(binary),
        contentType: 'application/pdf',
      })
    }

    // Try parsing as JSON
    try {
      const jsonData = JSON.parse(responseText)
      if (jsonData.status !== 0) {
        return errorResponse(`Bonzah API error: ${jsonData.txt || 'Unknown error'}`, 400)
      }
      // If JSON contains base64 content
      if (jsonData.data?.content) {
        return jsonResponse({
          documentBase64: jsonData.data.content,
          contentType: jsonData.data.content_type || 'application/pdf',
        })
      }
      if (typeof jsonData.data === 'string') {
        return jsonResponse({
          documentBase64: jsonData.data,
          contentType: 'application/pdf',
        })
      }
    } catch {
      // Not JSON
    }

    console.error('[Bonzah PDF] Unexpected response:', responseText.substring(0, 500))
    return errorResponse('Unexpected response format from Bonzah', 500)
  } catch (error) {
    console.error('[Bonzah PDF] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to download PDF',
      500
    )
  }
})
