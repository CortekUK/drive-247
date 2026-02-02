import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { type PremiumResponse } from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

// Bonzah insurance rates per 24 hours (from Bonzah API)
const RATES = {
  CDW: 26.95,   // Collision Damage Waiver
  RCLI: 20.18,  // Renter's Contingent Liability Insurance
  SLI: 11.20,   // Supplemental Liability Insurance
  PAI: 6.90,    // Personal Accident Insurance
}

interface CalculatePremiumRequest {
  trip_start_date: string    // YYYY-MM-DD
  trip_end_date: string      // YYYY-MM-DD
  pickup_state: string       // US state code, e.g., "FL"
  cdw_cover: boolean
  rcli_cover: boolean
  sli_cover: boolean
  pai_cover: boolean
}

/**
 * Calculate the number of rental days (24-hour periods)
 */
function calculateDays(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end.getTime() - start.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  // Minimum 1 day
  return Math.max(diffDays, 1)
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

    // Calculate number of rental days
    const days = calculateDays(body.trip_start_date, body.trip_end_date)
    console.log('[Bonzah Premium] Rental days:', days)

    // Calculate premiums based on selected coverages
    const cdwPremium = body.cdw_cover ? Math.round(RATES.CDW * days * 100) / 100 : 0
    const rcliPremium = body.rcli_cover ? Math.round(RATES.RCLI * days * 100) / 100 : 0
    const sliPremium = body.sli_cover ? Math.round(RATES.SLI * days * 100) / 100 : 0
    const paiPremium = body.pai_cover ? Math.round(RATES.PAI * days * 100) / 100 : 0

    const totalPremium = Math.round((cdwPremium + rcliPremium + sliPremium + paiPremium) * 100) / 100

    console.log('[Bonzah Premium] Calculated:', {
      days,
      total: totalPremium,
      breakdown: { cdw: cdwPremium, rcli: rcliPremium, sli: sliPremium, pai: paiPremium }
    })

    // Format response
    const result: PremiumResponse = {
      total_premium: totalPremium,
      breakdown: {
        cdw: cdwPremium,
        rcli: rcliPremium,
        sli: sliPremium,
        pai: paiPremium,
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
