import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  getTenantBonzahCredentials,
  getBonzahTokenForCredentials,
  getBonzahApiUrl,
} from '../_shared/bonzah-client.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface ProbePdfRequest {
  tenant_id: string
  pdf_id: string
  policy_id: string
}

interface ProbeResult {
  endpoint: string
  method: string
  status: number
  contentType: string | null
  bodyPreview: string
  couldBePdf: boolean
}

async function probeEndpoint(
  url: string,
  method: 'GET' | 'POST',
  token: string,
  body?: string
): Promise<ProbeResult> {
  try {
    const resp = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'in-auth-token': token,
      },
      body: method === 'POST' ? body : undefined,
    })

    const contentType = resp.headers.get('content-type')

    // Read response as array buffer so we can check for binary PDF marker
    const buffer = await resp.arrayBuffer()
    const uint8 = new Uint8Array(buffer)

    // Check for %PDF magic bytes at the start
    const isPdfBinary =
      uint8.length >= 4 &&
      uint8[0] === 0x25 && // %
      uint8[1] === 0x50 && // P
      uint8[2] === 0x44 && // D
      uint8[3] === 0x46    // F

    // Convert to text for preview (first 300 chars)
    let bodyText: string
    try {
      bodyText = new TextDecoder('utf-8', { fatal: false }).decode(
        uint8.slice(0, 2000)
      )
    } catch {
      bodyText = `[Binary data, ${uint8.length} bytes]`
    }

    const bodyPreview = bodyText.substring(0, 300)

    // Check if it looks like it could contain a PDF
    const isContentTypePdf = contentType?.includes('application/pdf') ?? false
    const hasBase64Pdf =
      bodyPreview.includes('JVBER') || // base64-encoded %PDF
      bodyPreview.includes('"content"') ||
      bodyPreview.includes('"documentBase64"')
    const couldBePdf = isPdfBinary || isContentTypePdf || hasBase64Pdf

    return {
      endpoint: url,
      method,
      status: resp.status,
      contentType,
      bodyPreview: isPdfBinary
        ? `[PDF binary data, ${uint8.length} bytes] ${bodyPreview.substring(0, 100)}`
        : bodyPreview,
      couldBePdf,
    }
  } catch (err) {
    return {
      endpoint: url,
      method,
      status: 0,
      contentType: null,
      bodyPreview: `[Fetch error: ${err instanceof Error ? err.message : String(err)}]`,
      couldBePdf: false,
    }
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: ProbePdfRequest = await req.json()

    if (!body.tenant_id || !body.pdf_id || !body.policy_id) {
      return errorResponse('Missing tenant_id, pdf_id, or policy_id')
    }

    const { tenant_id, pdf_id, policy_id } = body

    console.log(
      '[Bonzah Probe] Starting probe for pdf_id:',
      pdf_id,
      'policy_id:',
      policy_id,
      'tenant:',
      tenant_id
    )

    // Authenticate
    const credentials = await getTenantBonzahCredentials(supabase, tenant_id)
    const apiUrl = getBonzahApiUrl(credentials.mode)
    const token = await getBonzahTokenForCredentials(
      credentials.username,
      credentials.password,
      apiUrl
    )

    console.log('[Bonzah Probe] Authenticated. API URL:', apiUrl)

    // Define all endpoints to probe
    const endpointDefs: Array<{
      url: string
      method: 'GET' | 'POST'
      body?: string
      label: string
    }> = [
      // --- GET endpoints with query params ---
      {
        url: `${apiUrl}/Bonzah/download?pdf_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/download?pdf_id=',
      },
      {
        url: `${apiUrl}/Bonzah/download?data_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/download?data_id=',
      },
      {
        url: `${apiUrl}/Bonzah/download/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/download/{pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/document?pdf_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/document?pdf_id=',
      },
      {
        url: `${apiUrl}/Bonzah/document?data_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/document?data_id=',
      },
      {
        url: `${apiUrl}/Bonzah/document/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/document/{pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/pdf/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/pdf/{pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/pdf?pdf_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/pdf?pdf_id=',
      },
      {
        url: `${apiUrl}/Bonzah/file/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/file/{pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/file?data_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/file?data_id=',
      },

      // --- POST endpoints for /Bonzah/download ---
      {
        url: `${apiUrl}/Bonzah/download`,
        method: 'POST',
        body: JSON.stringify({ pdf_id }),
        label: 'POST /Bonzah/download {pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/download`,
        method: 'POST',
        body: JSON.stringify({ data_id: pdf_id }),
        label: 'POST /Bonzah/download {data_id}',
      },

      // --- POST endpoints for /Bonzah/document ---
      {
        url: `${apiUrl}/Bonzah/document`,
        method: 'POST',
        body: JSON.stringify({ pdf_id, policy_id }),
        label: 'POST /Bonzah/document {pdf_id, policy_id}',
      },
      {
        url: `${apiUrl}/Bonzah/document`,
        method: 'POST',
        body: JSON.stringify({ data_id: pdf_id, policy_id }),
        label: 'POST /Bonzah/document {data_id, policy_id}',
      },

      // --- GET endpoints without /Bonzah/ prefix ---
      {
        url: `${apiUrl}/download/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /download/{pdf_id}',
      },
      {
        url: `${apiUrl}/document/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /document/{pdf_id}',
      },
      {
        url: `${apiUrl}/pdf/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /pdf/{pdf_id}',
      },
      {
        url: `${apiUrl}/data/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /data/{pdf_id}',
      },

      // --- POST endpoints for /Bonzah/policy/* ---
      {
        url: `${apiUrl}/Bonzah/policy/download`,
        method: 'POST',
        body: JSON.stringify({ policy_id, pdf_id }),
        label: 'POST /Bonzah/policy/download {policy_id, pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/policy/download`,
        method: 'POST',
        body: JSON.stringify({ policy_id, data_id: pdf_id, download: 1 }),
        label: 'POST /Bonzah/policy/download {policy_id, data_id, download:1}',
      },
      {
        url: `${apiUrl}/Bonzah/policy/document`,
        method: 'POST',
        body: JSON.stringify({ policy_id, data_id: pdf_id }),
        label: 'POST /Bonzah/policy/document {policy_id, data_id}',
      },
      {
        url: `${apiUrl}/Bonzah/policy/pdf`,
        method: 'POST',
        body: JSON.stringify({ policy_id, data_id: pdf_id }),
        label: 'POST /Bonzah/policy/pdf {policy_id, data_id}',
      },

      // --- GET endpoints for /Bonzah/policy/download ---
      {
        url: `${apiUrl}/Bonzah/policy/download?policy_id=${encodeURIComponent(policy_id)}&pdf_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/policy/download?policy_id=&pdf_id=',
      },
      {
        url: `${apiUrl}/Bonzah/policy/download?policy_id=${encodeURIComponent(policy_id)}&data_id=${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/policy/download?policy_id=&data_id=',
      },

      // --- /Bonzah/data endpoints ---
      {
        url: `${apiUrl}/Bonzah/data`,
        method: 'POST',
        body: JSON.stringify({ data_id: pdf_id, download: 1 }),
        label: 'POST /Bonzah/data {data_id, download:1}',
      },
      {
        url: `${apiUrl}/Bonzah/data`,
        method: 'POST',
        body: JSON.stringify({ pdf_id }),
        label: 'POST /Bonzah/data {pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/data/${encodeURIComponent(pdf_id)}`,
        method: 'GET',
        label: 'GET /Bonzah/data/{pdf_id}',
      },
      {
        url: `${apiUrl}/Bonzah/data?data_id=${encodeURIComponent(pdf_id)}&download=1`,
        method: 'GET',
        label: 'GET /Bonzah/data?data_id=&download=1',
      },
    ]

    console.log(`[Bonzah Probe] Probing ${endpointDefs.length} endpoints in parallel...`)

    // Run all probes in parallel
    const results = await Promise.allSettled(
      endpointDefs.map((ep) => probeEndpoint(ep.url, ep.method, token, ep.body))
    )

    // Collect results
    const probeResults: Array<ProbeResult & { label: string }> = results.map(
      (result, i) => {
        if (result.status === 'fulfilled') {
          return { ...result.value, label: endpointDefs[i].label }
        }
        return {
          endpoint: endpointDefs[i].url,
          method: endpointDefs[i].method,
          label: endpointDefs[i].label,
          status: 0,
          contentType: null,
          bodyPreview: `[Promise rejected: ${result.reason}]`,
          couldBePdf: false,
        }
      }
    )

    // Separate promising results from the rest
    const promising = probeResults.filter((r) => r.couldBePdf)
    const successful = probeResults.filter(
      (r) => r.status >= 200 && r.status < 300
    )
    const errors = probeResults.filter(
      (r) => r.status === 0 || r.status >= 400
    )

    console.log(
      `[Bonzah Probe] Complete. ${promising.length} promising, ${successful.length} 2xx, ${errors.length} errors out of ${probeResults.length} total`
    )

    return jsonResponse({
      summary: {
        total: probeResults.length,
        promising: promising.length,
        successful_2xx: successful.length,
        errors: errors.length,
        apiUrl,
        pdf_id,
        policy_id,
      },
      promising,
      all_results: probeResults,
    })
  } catch (error) {
    console.error('[Bonzah Probe] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to probe PDF endpoints',
      500
    )
  }
})
