import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { bonzahFetch } from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface ConfirmPaymentRequest {
  policy_record_id: string
  stripe_payment_intent_id: string
}

interface BonzahIssueResponse {
  status: number
  txt: string
  data: Array<{
    policy_id: string
    quote_id: string
    policy: {
      policy_no: string | null
      policy_id: string
    }
    stages: {
      quote: string
      payment: string
      policy: string
    }
    errors?: Array<{
      name: string
      msg: string
    }>
  }>
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

    // Try to issue the policy in Bonzah
    console.log('[Bonzah Payment] Attempting to issue policy...')
    console.log('[Bonzah Payment] Quote ID:', policyRecord.quote_id)

    let policyNo: string | null = null
    let policyIssued = false

    try {
      // Call the issue endpoint to try to issue the policy
      const issueResponse = await bonzahFetch<BonzahIssueResponse>(
        `/quote/${policyRecord.quote_id}/issue`,
        {}
      )

      console.log('[Bonzah Payment] Issue response status:', issueResponse.status)

      if (issueResponse.status === 0 && issueResponse.data?.[0]) {
        const policyData = issueResponse.data[0]
        policyNo = policyData.policy?.policy_no || null

        // Check if there are validation errors
        if (policyData.errors && policyData.errors.length > 0) {
          console.log('[Bonzah Payment] Quote has validation errors:', policyData.errors.length)
          // Policy not fully issued due to missing fields, but payment confirmed
        }

        // Check stages
        if (policyData.stages?.policy === 'done' || policyData.stages?.policy === 'issued') {
          policyIssued = true
          console.log('[Bonzah Payment] Policy issued successfully:', policyNo)
        }
      }
    } catch (bonzahError) {
      console.error('[Bonzah Payment] Error calling Bonzah API:', bonzahError)
      // Continue even if Bonzah API fails - we've received payment
    }

    // Update policy record
    const updateData: Record<string, any> = {
      status: policyIssued ? 'active' : 'payment_confirmed',
      policy_issued_at: policyIssued ? new Date().toISOString() : null,
    }

    if (policyNo) {
      updateData.policy_no = policyNo
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
      console.log('[Bonzah Payment] Payment confirmed, policy pending full issuance')
    }

    return jsonResponse({
      success: true,
      policy_no: policyNo,
      policy_issued: policyIssued,
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
