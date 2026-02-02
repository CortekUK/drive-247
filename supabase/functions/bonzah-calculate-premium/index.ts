import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  bonzahFetch,
  formatDateForBonzah,
  type CoverageTypes,
  type PremiumResponse
} from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface CalculatePremiumRequest {
  trip_start_date: string    // YYYY-MM-DD
  trip_end_date: string      // YYYY-MM-DD
  pickup_state: string       // US state code, e.g., "FL"
  cdw_cover: boolean
  rcli_cover: boolean
  sli_cover: boolean
  pai_cover: boolean
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const body: CalculatePremiumRequest = await req.json()

    console.log('[Bonzah Premium] Calculating for:', {
      dates: `${body.trip_start_date} to ${body.trip_end_date}`,
      state: body.pickup_state,
      coverage: { cdw: body.cdw_cover, rcli: body.rcli_cover, sli: body.sli_cover, pai: body.pai_cover }
    })

    // Validate required fields
    if (!body.trip_start_date || !body.trip_end_date || !body.pickup_state) {
      return errorResponse('Missing required fields: trip_start_date, trip_end_date, pickup_state')
    }

    // Check if any coverage is selected
    const hasCoverage = body.cdw_cover || body.rcli_cover || body.sli_cover || body.pai_cover
    if (!hasCoverage) {
      // No coverage selected - return zero premium
      return jsonResponse({
        total_premium: 0,
        breakdown: { cdw: 0, rcli: 0, sli: 0, pai: 0 }
      })
    }

    // Build coverage array based on selections
    const coverages: string[] = []
    if (body.cdw_cover) coverages.push('CDW')
    if (body.rcli_cover) coverages.push('RCLI')
    if (body.sli_cover) coverages.push('SLI')
    if (body.pai_cover) coverages.push('PAI')

    // Call Bonzah API to get premium quote
    const bonzahRequest = {
      trip_start_date: formatDateForBonzah(body.trip_start_date),
      trip_end_date: formatDateForBonzah(body.trip_end_date),
      pickup_state: body.pickup_state,
      coverages: coverages,
    }

    console.log('[Bonzah Premium] API request:', bonzahRequest)

    const response = await bonzahFetch<{
      premium: number
      breakdown?: {
        CDW?: number
        RCLI?: number
        SLI?: number
        PAI?: number
      }
    }>('/quote/calculate-premium', bonzahRequest)

    console.log('[Bonzah Premium] API response:', response)

    // Format response
    const result: PremiumResponse = {
      total_premium: response.premium || 0,
      breakdown: {
        cdw: response.breakdown?.CDW || 0,
        rcli: response.breakdown?.RCLI || 0,
        sli: response.breakdown?.SLI || 0,
        pai: response.breakdown?.PAI || 0,
      }
    }

    return jsonResponse(result)

  } catch (error) {
    console.error('[Bonzah Premium] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to calculate premium',
      500
    )
  }
})
