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

    console.log('[Bonzah PDF] Downloading PDF:', body.pdf_id, 'for tenant:', body.tenant_id)

    // Get tenant credentials
    const credentials = await getTenantBonzahCredentials(supabase, body.tenant_id)
    const apiUrl = getBonzahApiUrl(credentials.mode)
    const token = await getBonzahTokenForCredentials(credentials.username, credentials.password, apiUrl)

    // Download the PDF from Bonzah
    const pdfUrl = `${apiUrl}/policy/data?data_id=${encodeURIComponent(body.pdf_id)}&download=1`

    console.log('[Bonzah PDF] Fetching from:', pdfUrl)

    const pdfResponse = await fetch(pdfUrl, {
      method: 'GET',
      headers: {
        'in-auth-token': token,
      },
    })

    if (!pdfResponse.ok) {
      console.error('[Bonzah PDF] Failed to download:', pdfResponse.status, pdfResponse.statusText)
      return errorResponse(`Failed to download PDF: ${pdfResponse.statusText}`, pdfResponse.status)
    }

    // Convert to base64
    const pdfBuffer = await pdfResponse.arrayBuffer()
    const uint8Array = new Uint8Array(pdfBuffer)
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64 = btoa(binary)

    const contentType = pdfResponse.headers.get('content-type') || 'application/pdf'

    console.log('[Bonzah PDF] PDF downloaded, size:', pdfBuffer.byteLength, 'bytes')

    return jsonResponse({
      documentBase64: base64,
      contentType,
    })
  } catch (error) {
    console.error('[Bonzah PDF] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to download PDF',
      500
    )
  }
})
