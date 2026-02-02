import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import {
  bonzahFetch,
  type BonzahPolicyResponse,
} from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'

interface ConfirmPaymentRequest {
  policy_record_id: string
  stripe_payment_intent_id: string
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

    // Call Bonzah API to confirm payment and issue policy
    // The payment is being confirmed AFTER Stripe has successfully charged
    console.log('[Bonzah Payment] Calling Bonzah to confirm payment...')
    console.log('[Bonzah Payment] Quote ID:', policyRecord.quote_id)
    console.log('[Bonzah Payment] Payment ID:', policyRecord.payment_id)

    const bonzahRequest = {
      quote_id: policyRecord.quote_id,
      payment_id: policyRecord.payment_id,
      payment_reference: body.stripe_payment_intent_id,
      payment_amount: policyRecord.premium_amount,
      payment_method: 'stripe',
    }

    console.log('[Bonzah Payment] API request:', JSON.stringify(bonzahRequest, null, 2))

    const policyResponse = await bonzahFetch<BonzahPolicyResponse>(
      '/payment/confirm',
      bonzahRequest
    )

    console.log('[Bonzah Payment] API response:', policyResponse)

    if (!policyResponse.policy_no) {
      console.error('[Bonzah Payment] No policy_no in response')

      // Update status to failed
      await supabase
        .from('bonzah_insurance_policies')
        .update({ status: 'failed' })
        .eq('id', body.policy_record_id)

      return errorResponse('Failed to issue policy', 500)
    }

    // Update policy record with issued policy details
    const { error: updateError } = await supabase
      .from('bonzah_insurance_policies')
      .update({
        policy_no: policyResponse.policy_no,
        policy_id: policyResponse.policy_id,
        status: 'active',
        policy_issued_at: new Date().toISOString(),
      })
      .eq('id', body.policy_record_id)

    if (updateError) {
      console.error('[Bonzah Payment] Failed to update policy record:', updateError)
      // Non-fatal - the policy is issued, just logging failed
    }

    console.log('[Bonzah Payment] Policy issued successfully:', policyResponse.policy_no)

    return jsonResponse({
      success: true,
      policy_no: policyResponse.policy_no,
      policy_id: policyResponse.policy_id,
    })

  } catch (error) {
    console.error('[Bonzah Payment] Error:', error)

    // Try to mark the policy as failed
    try {
      const body: ConfirmPaymentRequest = await new Response(
        (error as any).request?.body
      ).json().catch(() => ({}))

      if (body.policy_record_id) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        await supabase
          .from('bonzah_insurance_policies')
          .update({ status: 'failed' })
          .eq('id', body.policy_record_id)
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
