import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  bonzahFetchWithCredentials,
  getTenantBonzahCredentials,
  formatDateForBonzah,
  type CoverageTypes,
  type RenterDetails,
  type TenantBonzahCredentials,
} from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

// Bonzah Auto Rental Insurance product ID
const PRODUCT_ID = 'M000000000006'

// Bonzah max policy duration in days
const MAX_POLICY_DAYS = 30

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
  policy_type?: 'original' | 'extension'
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

interface DateChunk {
  start: string  // YYYY-MM-DD
  end: string    // YYYY-MM-DD
}

function calculateDays(startDate: string, endDate: string): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end.getTime() - start.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return Math.max(diffDays, 1)
}

/**
 * Split a date range into chunks of MAX_POLICY_DAYS (30 days) each.
 * E.g. 2026-03-06 to 2026-05-15 (70 days) → [Mar6-Apr5, Apr5-May5, May5-May15]
 */
function splitDateRange(start: string, end: string): DateChunk[] {
  const chunks: DateChunk[] = []
  let chunkStart = new Date(start + 'T00:00:00')
  const finalEnd = new Date(end + 'T00:00:00')

  while (chunkStart < finalEnd) {
    const chunkEnd = new Date(chunkStart)
    chunkEnd.setDate(chunkEnd.getDate() + MAX_POLICY_DAYS)

    // If chunk end exceeds the final end, clamp it
    const effectiveEnd = chunkEnd > finalEnd ? finalEnd : chunkEnd

    chunks.push({
      start: chunkStart.toISOString().split('T')[0],
      end: effectiveEnd.toISOString().split('T')[0],
    })

    chunkStart = effectiveEnd
  }

  return chunks
}

/**
 * Create a single Bonzah quote for one date chunk.
 */
async function createSingleQuote(
  chunk: DateChunk,
  body: CreateQuoteRequest,
  credentials: TenantBonzahCredentials,
  commonFields: Record<string, unknown>,
): Promise<{
  quoteId: string
  paymentId: string
  premium: number
  pdfIds: Record<string, string>
}> {
  // Use 23:59 for start time so "today" is never considered "in the past" by Bonzah
  // (Bonzah checks the full datetime against America/Los_Angeles timezone)
  const today = new Date().toISOString().split('T')[0]
  const startTime = chunk.start === today ? '23:59:00' : '10:00:00'

  const quoteRequest: Record<string, unknown> = {
    ...commonFields,
    trip_start_date: `${formatDateForBonzah(chunk.start)} ${startTime}`,
    trip_end_date: `${formatDateForBonzah(chunk.end)} 10:00:00`,
  }

  console.log(`[Bonzah Quote] Creating quote for chunk ${chunk.start} → ${chunk.end}`)

  const response = await bonzahFetchWithCredentials<BonzahQuoteApiResponse>(
    '/Bonzah/quote',
    quoteRequest,
    credentials
  )

  if (response.status !== 0 || !response.data?.quote_id) {
    throw new Error(`Failed to create Bonzah quote for ${chunk.start}-${chunk.end}: ${response.txt || 'Unknown error'}`)
  }

  const pdfIds: Record<string, string> = {}
  if (response.data.cdw_pdf_id) pdfIds.cdw = response.data.cdw_pdf_id
  if (response.data.rcli_pdf_id) pdfIds.rcli = response.data.rcli_pdf_id
  if (response.data.sli_pdf_id) pdfIds.sli = response.data.sli_pdf_id
  if (response.data.pai_pdf_id) pdfIds.pai = response.data.pai_pdf_id

  // Use API premium if available, otherwise calculate locally
  let premium: number
  if (response.data.total_amount && response.data.total_amount > 0) {
    premium = Math.round(response.data.total_amount * 100) / 100
  } else {
    const days = calculateDays(chunk.start, chunk.end)
    premium =
      (body.coverage.cdw ? RATES.CDW * days : 0) +
      (body.coverage.rcli ? RATES.RCLI * days : 0) +
      (body.coverage.sli ? RATES.SLI * days : 0) +
      (body.coverage.pai ? RATES.PAI * days : 0)
    premium = Math.round(premium * 100) / 100
  }

  console.log(`[Bonzah Quote] Chunk ${chunk.start}-${chunk.end}: quote=${response.data.quote_id}, premium=$${premium}`)

  return {
    quoteId: response.data.quote_id,
    paymentId: response.data.payment_id,
    premium,
    pdfIds,
  }
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
    // Default empty state fields to pickup_state (Bonzah requires valid state for finalization)
    const defaultState = body.pickup_state || 'FL'
    const pickupStateFull = getStateName(defaultState)
    const residenceStateFull = getStateName(body.renter.address.state || defaultState)
    const licenseStateFull = getStateName(body.renter.license.state || defaultState)

    // Default empty address fields (Bonzah requires non-empty address to generate payment_id)
    const street = body.renter.address.street || '123 Main St'
    const zip = body.renter.address.zip || '33101'

    // Format phone number for Bonzah (must be digits, with country code 1)
    const phoneDigits = body.renter.phone.replace(/\D/g, '')
    const formattedPhone = (() => {
      if (phoneDigits.startsWith('1') && phoneDigits.length === 11) return phoneDigits
      if (phoneDigits.length === 10) return `1${phoneDigits}`
      return phoneDigits || '10000000000'
    })()

    // Clamp trip start to today if it's in the past (Bonzah rejects past start dates)
    const today = new Date().toISOString().split('T')[0]
    const tripStart = body.trip_dates.start < today ? today : body.trip_dates.start
    const tripEnd = body.trip_dates.end

    // Split into 30-day chunks (Bonzah max policy duration)
    const chunks = splitDateRange(tripStart, tripEnd)
    console.log(`[Bonzah Quote] Date range ${tripStart} → ${tripEnd}: ${chunks.length} chunk(s)`)

    // Common fields for all quotes (everything except trip dates)
    const commonFields: Record<string, unknown> = {
      product_id: PRODUCT_ID,
      finalize: 1,
      source: 'API',
      policy_booking_time_zone: 'America/Los_Angeles',
      pickup_state: pickupStateFull,
      pickup_country: 'United States',
      drop_off_time: 'Same',
      cdw_cover: body.coverage.cdw,
      rcli_cover: body.coverage.rcli,
      sli_cover: body.coverage.sli,
      pai_cover: body.coverage.pai,
      first_name: body.renter.first_name,
      last_name: body.renter.last_name,
      dob: formatDateForBonzah(body.renter.dob),
      pri_email_address: body.renter.email,
      phone_no: formattedPhone,
      address_line_1: street,
      zip_code: zip,
      residence_country: 'United States',
      residence_state: residenceStateFull,
      license_no: body.renter.license.number || 'N/A',
      drivers_license_state: licenseStateFull,
    }

    // CDW requires inspection_done field
    if (body.coverage.cdw) {
      commonFields.inspection_done = 'Rental Agency'
    }

    // Get per-tenant Bonzah credentials
    const credentials = await getTenantBonzahCredentials(supabase, body.tenant_id)

    // Generate a chain_id if we have multiple chunks
    const chainId = chunks.length > 1 ? crypto.randomUUID() : null

    // Create quotes for each chunk sequentially
    const policyType = body.policy_type || 'original'
    let firstPolicyRecordId: string | null = null
    let firstQuoteId: string | null = null
    let firstPaymentId: string | null = null
    let totalPremium = 0

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]

      let quoteResult
      try {
        quoteResult = await createSingleQuote(chunk, body, credentials, commonFields)
      } catch (apiError) {
        console.error(`[Bonzah Quote] API call failed for chunk ${i + 1}/${chunks.length}:`, apiError)
        // If the first chunk fails, abort everything
        if (i === 0) {
          // Don't double-wrap "Bonzah API error:" — the shared client already adds that prefix
          const errMsg = apiError instanceof Error ? apiError.message : 'Unknown API error'
          return errorResponse(errMsg, 500)
        }
        // If a subsequent chunk fails, we still have earlier quotes — log and break
        console.error(`[Bonzah Quote] Chunk ${i + 1} failed, ${i} policies created successfully`)
        break
      }

      // Build coverage_types with pdf_ids included
      const coverageTypesWithPdfs = {
        ...body.coverage,
        ...(Object.keys(quoteResult.pdfIds).length > 0 ? { pdf_ids: quoteResult.pdfIds } : {}),
      }

      // Store quote in database
      const { data: policyRecord, error: dbError } = await supabase
        .from('bonzah_insurance_policies')
        .insert({
          rental_id: body.rental_id,
          tenant_id: body.tenant_id,
          customer_id: body.customer_id,
          quote_id: quoteResult.quoteId,
          quote_no: null,
          payment_id: quoteResult.paymentId,
          policy_id: null,
          coverage_types: coverageTypesWithPdfs,
          trip_start_date: chunk.start,
          trip_end_date: chunk.end,
          pickup_state: body.pickup_state,
          premium_amount: quoteResult.premium,
          renter_details: body.renter,
          status: 'quoted',
          policy_type: policyType,
          chain_id: chainId,
        })
        .select('id')
        .single()

      if (dbError) {
        console.error('[Bonzah Quote] Database error:', dbError)
        if (i === 0) {
          return errorResponse('Failed to store quote in database', 500)
        }
        break
      }

      console.log(`[Bonzah Quote] Chunk ${i + 1}/${chunks.length} stored: ${policyRecord.id} (${chunk.start} → ${chunk.end}, $${quoteResult.premium})`)

      totalPremium += quoteResult.premium

      if (i === 0) {
        firstPolicyRecordId = policyRecord.id
        firstQuoteId = quoteResult.quoteId
        firstPaymentId = quoteResult.paymentId
      }
    }

    totalPremium = Math.round(totalPremium * 100) / 100

    console.log(`[Bonzah Quote] Total premium across ${chunks.length} policies: $${totalPremium}`)

    // Update rental with total insurance premium (only for original policies)
    // Extension policies don't update the rental FK — it stays pointing to the original
    if (policyType === 'original' && firstPolicyRecordId) {
      const { error: rentalError } = await supabase
        .from('rentals')
        .update({
          insurance_premium: totalPremium,
          bonzah_policy_id: firstPolicyRecordId,
        })
        .eq('id', body.rental_id)

      if (rentalError) {
        console.error('[Bonzah Quote] Error updating rental:', rentalError)
        // Non-fatal - the quote is still created
      }
    }

    return jsonResponse({
      policy_record_id: firstPolicyRecordId,
      quote_id: firstQuoteId,
      payment_id: firstPaymentId,
      total_premium: totalPremium,
      policy_count: chunks.length,
      chain_id: chainId,
    })

  } catch (error) {
    console.error('[Bonzah Quote] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create quote',
      500
    )
  }
})
