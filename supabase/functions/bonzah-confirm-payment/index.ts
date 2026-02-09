import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { bonzahFetchWithCredentials, getTenantBonzahCredentials } from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface ConfirmPaymentRequest {
  policy_record_id: string
  stripe_payment_intent_id: string
}

// Response from /Bonzah/payment endpoint
interface BonzahPaymentResponse {
  status: number
  txt: string
  data: {
    policy_no: string
    policy_id: string
    cdw_pdf_id?: string
    rcli_pdf_id?: string
    sli_pdf_id?: string
    pai_pdf_id?: string
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

    const body: ConfirmPaymentRequest = await req.json()

    console.log('[Bonzah Payment] Confirming payment for policy:', body.policy_record_id)

    if (!body.policy_record_id) {
      return errorResponse('Missing policy_record_id')
    }

    // Get the policy record from database
    const { data: policyRecord, error: fetchError } = await supabase
      .from('bonzah_insurance_policies')
      .select('*')
      .eq('id', body.policy_record_id)
      .single()

    if (fetchError || !policyRecord) {
      console.error('[Bonzah Payment] Policy not found:', fetchError)
      return errorResponse('Policy record not found', 404)
    }

    // Check if already processed
    if (policyRecord.status === 'active') {
      console.log('[Bonzah Payment] Policy already active:', policyRecord.policy_no)
      return jsonResponse({
        success: true,
        policy_no: policyRecord.policy_no,
        already_processed: true,
      })
    }

    // Update status to payment_pending
    await supabase
      .from('bonzah_insurance_policies')
      .update({ status: 'payment_pending' })
      .eq('id', body.policy_record_id)

    // Make payment to Bonzah using the correct /Bonzah/payment endpoint
    console.log('[Bonzah Payment] Attempting payment...')
    console.log('[Bonzah Payment] Payment ID:', policyRecord.payment_id)
    console.log('[Bonzah Payment] Amount:', policyRecord.premium_amount)

    let policyNo: string | null = null
    let policyId: string | null = null
    let policyIssued = false
    let pdfIds: Record<string, string> = {}

    if (!policyRecord.payment_id) {
      console.error('[Bonzah Payment] No payment_id found in policy record')
      return errorResponse('No payment_id found - quote may not have been finalized correctly', 400)
    }

    try {
      // Get per-tenant Bonzah credentials
      const credentials = await getTenantBonzahCredentials(supabase, policyRecord.tenant_id)

      // Call the /Bonzah/payment endpoint to complete payment and issue policy
      const paymentResponse = await bonzahFetchWithCredentials<BonzahPaymentResponse>(
        '/Bonzah/payment',
        {
          payment_id: policyRecord.payment_id,
          amount: policyRecord.premium_amount,
        },
        credentials
      )

      console.log('[Bonzah Payment] Payment response status:', paymentResponse.status)

      if (paymentResponse.status === 0 && paymentResponse.data) {
        policyNo = paymentResponse.data.policy_no
        policyId = paymentResponse.data.policy_id
        policyIssued = !!policyNo

        // Collect PDF IDs if available
        if (paymentResponse.data.cdw_pdf_id) pdfIds.cdw = paymentResponse.data.cdw_pdf_id
        if (paymentResponse.data.rcli_pdf_id) pdfIds.rcli = paymentResponse.data.rcli_pdf_id
        if (paymentResponse.data.sli_pdf_id) pdfIds.sli = paymentResponse.data.sli_pdf_id
        if (paymentResponse.data.pai_pdf_id) pdfIds.pai = paymentResponse.data.pai_pdf_id

        console.log('[Bonzah Payment] Policy issued:', policyNo)
        console.log('[Bonzah Payment] PDF IDs:', pdfIds)
      }
    } catch (bonzahError) {
      console.error('[Bonzah Payment] Error calling Bonzah API:', bonzahError)
      // Store the error message for debugging
      const errorMsg = bonzahError instanceof Error ? bonzahError.message : 'Unknown error'

      // Update with failed status and error details
      await supabase
        .from('bonzah_insurance_policies')
        .update({
          status: 'failed',
          // Store error in renter_details for debugging (could add a dedicated error field)
        })
        .eq('id', body.policy_record_id)

      return errorResponse(`Bonzah payment failed: ${errorMsg}`, 500)
    }

    // Update policy record with results
    const updateData: Record<string, unknown> = {
      status: policyIssued ? 'active' : 'payment_confirmed',
      policy_issued_at: policyIssued ? new Date().toISOString() : null,
    }

    if (policyNo) updateData.policy_no = policyNo
    if (policyId) updateData.policy_id = policyId
    if (Object.keys(pdfIds).length > 0) {
      // Store PDF IDs in coverage_types alongside existing data
      updateData.coverage_types = {
        ...policyRecord.coverage_types,
        pdf_ids: pdfIds,
      }
    }

    const { error: updateError } = await supabase
      .from('bonzah_insurance_policies')
      .update(updateData)
      .eq('id', body.policy_record_id)

    if (updateError) {
      console.error('[Bonzah Payment] Failed to update policy record:', updateError)
    }

    // Log the result
    if (policyIssued) {
      console.log('[Bonzah Payment] Policy fully issued:', policyNo)
    } else {
      console.log('[Bonzah Payment] Payment confirmed, policy pending')
    }

    return jsonResponse({
      success: true,
      policy_no: policyNo,
      policy_id: policyId,
      policy_issued: policyIssued,
      pdf_ids: pdfIds,
      status: policyIssued ? 'active' : 'payment_confirmed',
    })

  } catch (error) {
    console.error('[Bonzah Payment] Error:', error)

    // Try to update status to failed
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      const reqBody = await req.clone().json().catch(() => ({}))
      if (reqBody.policy_record_id) {
        await supabase
          .from('bonzah_insurance_policies')
          .update({ status: 'failed' })
          .eq('id', reqBody.policy_record_id)
      }
    } catch {
      // Ignore cleanup errors
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to confirm payment',
      500
    )
  }
})
