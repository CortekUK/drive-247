import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  bonzahFetch,
  formatDateForBonzah,
  type CoverageTypes,
  type RenterDetails,
  type BonzahQuoteResponse,
} from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

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

    // Build coverage array
    const coverages: string[] = []
    if (body.coverage.cdw) coverages.push('CDW')
    if (body.coverage.rcli) coverages.push('RCLI')
    if (body.coverage.sli) coverages.push('SLI')
    if (body.coverage.pai) coverages.push('PAI')

    // Build Bonzah API request
    const bonzahRequest = {
      trip_start_date: formatDateForBonzah(body.trip_dates.start),
      trip_end_date: formatDateForBonzah(body.trip_dates.end),
      pickup_state: body.pickup_state,
      coverages: coverages,
      renter: {
        first_name: body.renter.first_name,
        last_name: body.renter.last_name,
        date_of_birth: formatDateForBonzah(body.renter.dob),
        email: body.renter.email,
        phone: body.renter.phone,
        address: {
          street: body.renter.address.street,
          city: body.renter.address.city,
          state: body.renter.address.state,
          zip: body.renter.address.zip,
        },
        driver_license: {
          number: body.renter.license.number,
          state: body.renter.license.state,
        },
      },
    }

    console.log('[Bonzah Quote] API request:', JSON.stringify(bonzahRequest, null, 2))

    // Call Bonzah API to create quote
    const quoteResponse = await bonzahFetch<BonzahQuoteResponse>(
      '/quote/create',
      bonzahRequest
    )

    console.log('[Bonzah Quote] API response:', quoteResponse)

    if (!quoteResponse.quote_id) {
      console.error('[Bonzah Quote] No quote_id in response')
      return errorResponse('Failed to create quote with Bonzah', 500)
    }

    // Store quote in database
    const { data: policyRecord, error: dbError } = await supabase
      .from('bonzah_insurance_policies')
      .insert({
        rental_id: body.rental_id,
        tenant_id: body.tenant_id,
        customer_id: body.customer_id,
        quote_id: quoteResponse.quote_id,
        quote_no: quoteResponse.quote_no || null,
        payment_id: quoteResponse.payment_id || null,
        coverage_types: body.coverage,
        trip_start_date: body.trip_dates.start,
        trip_end_date: body.trip_dates.end,
        pickup_state: body.pickup_state,
        premium_amount: quoteResponse.premium,
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
        insurance_premium: quoteResponse.premium,
        bonzah_policy_id: policyRecord.id,
      })
      .eq('id', body.rental_id)

    if (rentalError) {
      console.error('[Bonzah Quote] Error updating rental:', rentalError)
      // Non-fatal - the quote is still created
    }

    return jsonResponse({
      policy_record_id: policyRecord.id,
      quote_id: quoteResponse.quote_id,
      quote_no: quoteResponse.quote_no,
      payment_id: quoteResponse.payment_id,
      total_premium: quoteResponse.premium,
    })

  } catch (error) {
    console.error('[Bonzah Quote] Error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create quote',
      500
    )
  }
})
