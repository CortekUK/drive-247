import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  bonzahFetch,
  formatDateForBonzah,
  type CoverageTypes,
  type RenterDetails,
} from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

// Bonzah Auto Rental Insurance product ID
const PRODUCT_ID = 'M000000000006'

// Insurance rates per 24 hours
const RATES = {
  CDW: 26.95,
  RCLI: 20.18,
  SLI: 11.20,
  PAI: 6.90,
}

interface CreateQuoteRequest {
  rental_id: string
  customer_id: string
  tenant_id: string
  trip_dates: {
    start: string  // YYYY-MM-DD
    end: string    // YYYY-MM-DD
  }
  pickup_state: string
  coverage: CoverageTypes
  renter: RenterDetails
}

interface BonzahQuoteApiResponse {
  status: number
  txt: string
  data: Array<{
    quote_id: string
    policy_id: string
    quote: {
      quote_id: string
      data: {
        total_premium: number
        coverage_information: Array<{
          optional_addon_cover_name: string
          opted: string
          optional_addon_premium: string | number
        }>
      }
    }
  }>
}

function calculateDays(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end.getTime() - start.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return Math.max(diffDays, 1)
}

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: CreateQuoteRequest = await req.json()

    console.log('[Bonzah Quote] Creating quote for rental:', body.rental_id)

    // Validate required fields
    if (!body.rental_id || !body.customer_id || !body.tenant_id) {
      return errorResponse('Missing required IDs: rental_id, customer_id, tenant_id')
    }

    if (!body.trip_dates?.start || !body.trip_dates?.end) {
      return errorResponse('Missing trip dates')
    }

    if (!body.pickup_state) {
      return errorResponse('Missing pickup state')
    }

    if (!body.renter) {
      return errorResponse('Missing renter details')
    }

    // Check if any coverage is selected
    const hasCoverage = body.coverage.cdw || body.coverage.rcli ||
                        body.coverage.sli || body.coverage.pai
    if (!hasCoverage) {
      return errorResponse('No coverage selected')
    }

    // Step 1: Create initial quote with product_id and trip dates
    const createQuoteRequest = {
      product_id: PRODUCT_ID,
      trip_start_date: formatDateForBonzah(body.trip_dates.start),
      trip_end_date: formatDateForBonzah(body.trip_dates.end),
      pickup_state: body.pickup_state,
    }

    console.log('[Bonzah Quote] Creating initial quote:', createQuoteRequest)

    const createResponse = await bonzahFetch<BonzahQuoteApiResponse>('/quote', createQuoteRequest)

    if (createResponse.status !== 0 || !createResponse.data?.[0]?.quote_id) {
      console.error('[Bonzah Quote] Failed to create quote:', createResponse)
      return errorResponse('Failed to create Bonzah quote', 500)
    }

    const quoteId = createResponse.data[0].quote_id
    const policyId = createResponse.data[0].policy_id
    console.log('[Bonzah Quote] Initial quote created:', quoteId)

    // Step 2: Update quote with coverage selections and renter details
    const coverageInfo = [
      {
        optional_addon_cover_name: 'Collision Damage Waiver (CDW)',
        opted: body.coverage.cdw ? 'Yes' : 'No'
      },
      {
        optional_addon_cover_name: "Renter's Contingent Liability Insurance (RCLI)",
        opted: body.coverage.rcli ? 'Yes' : 'No'
      },
      {
        optional_addon_cover_name: 'Supplemental Liability Insurance (SLI)',
        opted: body.coverage.sli ? 'Yes' : 'No'
      },
      {
        optional_addon_cover_name: 'Personal Accident Insurance (PAI)',
        opted: body.coverage.pai ? 'Yes' : 'No'
      }
    ]

    const updateQuoteRequest = {
      // Coverage selections
      coverage_information: coverageInfo,
      // Trip dates
      policy_start_date: formatDateForBonzah(body.trip_dates.start),
      policy_end_date: formatDateForBonzah(body.trip_dates.end),
      // Renter details
      first_name: body.renter.first_name,
      last_name: body.renter.last_name,
      date_of_birth: formatDateForBonzah(body.renter.dob),
      email: body.renter.email,
      phone_no: body.renter.phone,
      // Address
      address_line_1: body.renter.address.street,
      city: body.renter.address.city,
      state: body.renter.address.state,
      zip_code: body.renter.address.zip,
      country: 'United States',
      // Residence (same as address)
      residence_country: 'United States',
      residence_state: body.renter.address.state,
      // License
      license_no: body.renter.license.number,
      license_state: body.renter.license.state,
      // Required state field
      select_state: body.pickup_state,
    }

    console.log('[Bonzah Quote] Updating quote with details')

    const updateResponse = await bonzahFetch<BonzahQuoteApiResponse>(`/quote/${quoteId}`, updateQuoteRequest)

    if (updateResponse.status !== 0) {
      console.error('[Bonzah Quote] Failed to update quote:', updateResponse)
      // Don't fail completely - we can still calculate premium locally
    }

    // Calculate premium locally (more reliable than API calculation)
    const days = calculateDays(body.trip_dates.start, body.trip_dates.end)
    const premium =
      (body.coverage.cdw ? RATES.CDW * days : 0) +
      (body.coverage.rcli ? RATES.RCLI * days : 0) +
      (body.coverage.sli ? RATES.SLI * days : 0) +
      (body.coverage.pai ? RATES.PAI * days : 0)

    const roundedPremium = Math.round(premium * 100) / 100

    console.log('[Bonzah Quote] Calculated premium:', roundedPremium, 'for', days, 'days')

    // Store quote in database
    const { data: policyRecord, error: dbError } = await supabase
      .from('bonzah_insurance_policies')
      .insert({
        rental_id: body.rental_id,
        tenant_id: body.tenant_id,
        customer_id: body.customer_id,
        quote_id: quoteId,
        quote_no: null,
        payment_id: null,
        policy_id: policyId,
        coverage_types: body.coverage,
        trip_start_date: body.trip_dates.start,
        trip_end_date: body.trip_dates.end,
        pickup_state: body.pickup_state,
        premium_amount: roundedPremium,
        renter_details: body.renter,
        status: 'quoted',
      })
      .select('id')
      .single()

    if (dbError) {
      console.error('[Bonzah Quote] Database error:', dbError)
      return errorResponse('Failed to store quote in database', 500)
    }

    console.log('[Bonzah Quote] Quote stored with ID:', policyRecord.id)

    // Update rental with insurance premium
    const { error: rentalError } = await supabase
      .from('rentals')
      .update({
        insurance_premium: roundedPremium,
        bonzah_policy_id: policyRecord.id,
      })
      .eq('id', body.rental_id)

    if (rentalError) {
      console.error('[Bonzah Quote] Error updating rental:', rentalError)
      // Non-fatal - the quote is still created
    }

    return jsonResponse({
      policy_record_id: policyRecord.id,
      quote_id: quoteId,
      policy_id: policyId,
      total_premium: roundedPremium,
    })

  } catch (error) {
    console.error('[Bonzah Quote] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create quote',
      500
    )
  }
})
