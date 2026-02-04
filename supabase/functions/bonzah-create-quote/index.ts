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

// Insurance rates per 24 hours (fallback calculation)
const RATES = {
  CDW: 26.95,
  RCLI: 20.18,
  SLI: 11.20,
  PAI: 6.90,
}

// State name mapping (Bonzah requires full state names)
const STATE_NAMES: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
  'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
  'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
  'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
  'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
  'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
  'DC': 'District of Columbia',
}

function getStateName(stateCode: string): string {
  return STATE_NAMES[stateCode.toUpperCase()] || stateCode
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

// Response from /Bonzah/quote endpoint with finalize=1
interface BonzahQuoteApiResponse {
  status: number
  txt: string
  data: {
    quote_id: string
    payment_id: string
    total_amount: number
    cdw_pdf_id?: string
    rcli_pdf_id?: string
    sli_pdf_id?: string
    pai_pdf_id?: string
  }
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

    // Get full state names for Bonzah API
    const pickupStateFull = getStateName(body.pickup_state)
    const residenceStateFull = getStateName(body.renter.address.state)
    const licenseStateFull = getStateName(body.renter.license.state)

    // Use the correct /Bonzah/quote endpoint with finalize=1
    // This creates a complete quote and returns payment_id in one call
    const createQuoteRequest: Record<string, unknown> = {
      product_id: PRODUCT_ID,
      finalize: 1,  // Important: finalize=1 generates payment_id
      // Trip details
      policy_start_date: formatDateForBonzah(body.trip_dates.start),
      policy_end_date: formatDateForBonzah(body.trip_dates.end),
      pickup_state: pickupStateFull,
      pickup_country: 'United States',
      pickup_time: '10:00',
      dropoff_time: '10:00',
      dropoff_option: 'Same',
      // Coverage selections
      cdw_cover: body.coverage.cdw ? 'Yes' : 'No',
      rcli_cover: body.coverage.rcli ? 'Yes' : 'No',
      sli_cover: body.coverage.sli ? 'Yes' : 'No',
      pai_cover: body.coverage.pai ? 'Yes' : 'No',
      // Renter details
      first_name: body.renter.first_name,
      last_name: body.renter.last_name,
      date_of_birth: formatDateForBonzah(body.renter.dob),
      email: body.renter.email,
      phone_no: `1${body.renter.phone.replace(/\D/g, '')}`,  // Add country code
      // Address
      address_line_1: body.renter.address.street,
      city: body.renter.address.city,
      state: residenceStateFull,
      zip_code: body.renter.address.zip,
      country: 'United States',
      // Residence
      residence_country: 'United States',
      residence_state: residenceStateFull,
      // License
      license_no: body.renter.license.number,
      license_state: licenseStateFull,
    }

    // CDW requires inspection_done field
    if (body.coverage.cdw) {
      createQuoteRequest.inspection_done = 'Rental Agency'
    }

    console.log('[Bonzah Quote] Creating finalized quote via /Bonzah/quote')

    const createResponse = await bonzahFetch<BonzahQuoteApiResponse>('/Bonzah/quote', createQuoteRequest)

    if (createResponse.status !== 0 || !createResponse.data?.quote_id) {
      console.error('[Bonzah Quote] Failed to create quote:', createResponse)
      return errorResponse(`Failed to create Bonzah quote: ${createResponse.txt || 'Unknown error'}`, 500)
    }

    const quoteId = createResponse.data.quote_id
    const paymentId = createResponse.data.payment_id
    const apiPremium = createResponse.data.total_amount

    console.log('[Bonzah Quote] Quote created:', quoteId)
    console.log('[Bonzah Quote] Payment ID:', paymentId)
    console.log('[Bonzah Quote] API Premium:', apiPremium)

    // Use API premium if available, otherwise calculate locally
    let roundedPremium: number
    if (apiPremium && apiPremium > 0) {
      roundedPremium = Math.round(apiPremium * 100) / 100
    } else {
      // Fallback: Calculate premium locally
      const days = calculateDays(body.trip_dates.start, body.trip_dates.end)
      const premium =
        (body.coverage.cdw ? RATES.CDW * days : 0) +
        (body.coverage.rcli ? RATES.RCLI * days : 0) +
        (body.coverage.sli ? RATES.SLI * days : 0) +
        (body.coverage.pai ? RATES.PAI * days : 0)
      roundedPremium = Math.round(premium * 100) / 100
      console.log('[Bonzah Quote] Calculated premium locally:', roundedPremium, 'for', days, 'days')
    }

    // Store quote in database
    const { data: policyRecord, error: dbError } = await supabase
      .from('bonzah_insurance_policies')
      .insert({
        rental_id: body.rental_id,
        tenant_id: body.tenant_id,
        customer_id: body.customer_id,
        quote_id: quoteId,
        quote_no: null,
        payment_id: paymentId,  // Store the payment_id from Bonzah
        policy_id: null,  // Will be set after payment
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
      payment_id: paymentId,
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
