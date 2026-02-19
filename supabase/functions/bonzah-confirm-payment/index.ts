import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { bonzahFetchWithCredentials, getTenantBonzahCredentials, formatDateForBonzah, type TenantBonzahCredentials } from '../_shared/bonzah-client.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { sendResendEmail, getTenantBranding, wrapWithBrandedTemplate } from '../_shared/resend-service.ts'

// Bonzah Auto Rental Insurance product ID
const PRODUCT_ID = 'M000000000006'

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

interface ConfirmPaymentRequest {
  policy_record_id: string
  stripe_payment_intent_id: string
}

// Response from /Bonzah/quote endpoint with finalize=1
interface BonzahQuoteApiResponse {
  status: number
  txt: string
  data: {
    quote_id: string
    payment_id: string
    total_amount: number
  }
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

/**
 * Re-create a finalized Bonzah quote to recover a missing payment_id.
 * Uses the renter_details, coverage_types, and trip dates stored in the policy record.
 */
async function recoverPaymentId(
  policyRecord: any,
  credentials: TenantBonzahCredentials
): Promise<{ paymentId: string; quoteId: string } | null> {
  const renter = policyRecord.renter_details
  const coverage = policyRecord.coverage_types

  if (!renter || !coverage) {
    console.error('[Bonzah Payment] Cannot recover payment_id: missing renter_details or coverage_types')
    return null
  }

  // Use pickup_state as fallback for empty address/license state fields
  const defaultState = policyRecord.pickup_state || 'FL'
  const pickupStateFull = getStateName(defaultState)
  const residenceStateFull = getStateName(renter.address?.state || defaultState)
  const licenseStateFull = getStateName(renter.license?.state || defaultState)

  // Default empty address fields (Bonzah requires non-empty address for finalization)
  const street = renter.address?.street || '123 Main St'
  const zip = renter.address?.zip || '33101'

  // Format phone
  const phoneDigits = (renter.phone || '').replace(/\D/g, '')
  const formattedPhone = (() => {
    if (phoneDigits.startsWith('1') && phoneDigits.length === 11) return phoneDigits
    if (phoneDigits.length === 10) return `1${phoneDigits}`
    return phoneDigits || '10000000000'
  })()

  console.log('[Bonzah Payment] Recovery using state:', residenceStateFull, 'zip:', zip, 'street:', street)

  const quoteRequest: Record<string, unknown> = {
    product_id: PRODUCT_ID,
    finalize: 1,
    source: 'API',
    policy_booking_time_zone: 'America/Los_Angeles',
    trip_start_date: `${formatDateForBonzah(policyRecord.trip_start_date)} 10:00:00`,
    trip_end_date: `${formatDateForBonzah(policyRecord.trip_end_date)} 10:00:00`,
    pickup_state: pickupStateFull,
    pickup_country: 'United States',
    drop_off_time: 'Same',
    cdw_cover: !!coverage.cdw,
    rcli_cover: !!coverage.rcli,
    sli_cover: !!coverage.sli,
    pai_cover: !!coverage.pai,
    first_name: renter.first_name,
    last_name: renter.last_name,
    dob: formatDateForBonzah(renter.dob),
    pri_email_address: renter.email,
    phone_no: formattedPhone,
    address_line_1: street,
    zip_code: zip,
    residence_country: 'United States',
    residence_state: residenceStateFull,
    license_no: renter.license?.number || 'N/A',
    drivers_license_state: licenseStateFull,
  }

  if (coverage.cdw) {
    quoteRequest.inspection_done = 'Rental Agency'
  }

  console.log('[Bonzah Payment] Re-creating quote to recover payment_id...')

  const quoteResponse = await bonzahFetchWithCredentials<BonzahQuoteApiResponse>(
    '/Bonzah/quote',
    quoteRequest,
    credentials
  )

  if (quoteResponse.status !== 0 || !quoteResponse.data?.payment_id) {
    console.error('[Bonzah Payment] Failed to recover payment_id:', quoteResponse)
    return null
  }

  console.log('[Bonzah Payment] Recovered payment_id:', quoteResponse.data.payment_id)
  return {
    paymentId: quoteResponse.data.payment_id,
    quoteId: quoteResponse.data.quote_id,
  }
}

/**
 * Send notifications (in-app + email) to tenant admins when Bonzah balance is insufficient.
 */
async function sendInsufficientBalanceNotifications(
  supabase: any,
  policyRecord: any,
  cdBalance: number | null,
) {
  const tenantId = policyRecord.tenant_id
  const premium = policyRecord.premium_amount

  // Get rental info for context
  const { data: rental } = await supabase
    .from('rentals')
    .select('rental_number, customers(name), vehicles(reg, make, model)')
    .eq('id', policyRecord.rental_id)
    .single()

  const customerName = rental?.customers?.name || 'Unknown Customer'
  const vehicleInfo = rental?.vehicles ? `${rental.vehicles.make} ${rental.vehicles.model} (${rental.vehicles.reg})` : 'Unknown Vehicle'
  const rentalRef = rental?.rental_number || policyRecord.rental_id?.substring(0, 8).toUpperCase()

  // 1. Create in-app notifications for admin users
  const { data: adminUsers } = await supabase
    .from('app_users')
    .select('id, email')
    .eq('tenant_id', tenantId)
    .in('role', ['admin', 'head_admin'])

  if (adminUsers && adminUsers.length > 0) {
    const notifications = adminUsers.map((user: any) => ({
      user_id: user.id,
      tenant_id: tenantId,
      title: 'Insurance Pending — Insufficient Allocated Balance',
      message: `Insurance for ${customerName} (${rentalRef}) is quoted but could not be activated — your Bonzah allocated balance is too low. Premium: $${premium}, Bonzah Balance: $${cdBalance ?? 'unknown'}. Please allocate more funds in your Bonzah portal.`,
      type: 'bonzah_insufficient_balance',
      is_read: false,
      link: `/rentals/${policyRecord.rental_id}`,
      metadata: {
        rental_id: policyRecord.rental_id,
        policy_id: policyRecord.id,
        customer_name: customerName,
        premium_amount: premium,
        cd_balance: cdBalance,
      },
    }))

    const { error: insertError } = await supabase
      .from('notifications')
      .insert(notifications)

    if (insertError) {
      console.error('[Bonzah Payment] Error creating notifications:', insertError)
    } else {
      console.log(`[Bonzah Payment] Created ${notifications.length} in-app notifications`)
    }

    // 2. Send email to head_admin users
    const headAdminEmails = adminUsers
      .filter((u: any) => u.email)
      .map((u: any) => u.email)

    if (headAdminEmails.length > 0) {
      const branding = await getTenantBranding(tenantId, supabase)
      const emailContent = `
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="color: #CC004A; margin: 0 0 20px;">Insurance Pending — Insufficient Allocated Balance</h2>
                            <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 15px;">
                                An insurance policy has been quoted but could not be activated because your Bonzah <strong>allocated balance</strong> is too low.
                            </p>
                            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                                <tr>
                                    <td style="padding: 10px 15px; background: #f8f9fa; border: 1px solid #eee; font-weight: 600; width: 40%;">Rental</td>
                                    <td style="padding: 10px 15px; border: 1px solid #eee;">${rentalRef}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 15px; background: #f8f9fa; border: 1px solid #eee; font-weight: 600;">Customer</td>
                                    <td style="padding: 10px 15px; border: 1px solid #eee;">${customerName}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 15px; background: #f8f9fa; border: 1px solid #eee; font-weight: 600;">Vehicle</td>
                                    <td style="padding: 10px 15px; border: 1px solid #eee;">${vehicleInfo}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 15px; background: #f8f9fa; border: 1px solid #eee; font-weight: 600;">Premium Required</td>
                                    <td style="padding: 10px 15px; border: 1px solid #eee; color: #CC004A; font-weight: 600;">$${premium}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 15px; background: #f8f9fa; border: 1px solid #eee; font-weight: 600;">Bonzah Balance (Broker Total)</td>
                                    <td style="padding: 10px 15px; border: 1px solid #eee;">$${cdBalance ?? 'Unknown'}</td>
                                </tr>
                            </table>
                            <p style="color: #333; font-size: 14px; line-height: 1.6; margin: 15px 0;">
                                <strong>What to do:</strong> Log in to your Bonzah portal and allocate more funds from your Bonzah balance. Once allocated, you can retry the purchase from the rental detail page. The customer's booking is not affected — it has been processed normally.
                            </p>
                        </td>
                    </tr>`

      const html = wrapWithBrandedTemplate(emailContent, branding)

      await sendResendEmail({
        to: headAdminEmails,
        subject: `Action Required: Insurance Pending — Allocate Bonzah Funds — ${rentalRef}`,
        html,
        tenantId,
      }, supabase)

      console.log(`[Bonzah Payment] Sent insufficient balance email to ${headAdminEmails.length} admin(s)`)
    }
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
    let cdBalance: number | null = null
    let bonzahMode: 'test' | 'live' = 'test'

    try {
      // Get per-tenant Bonzah credentials
      const credentials = await getTenantBonzahCredentials(supabase, policyRecord.tenant_id)
      bonzahMode = credentials.mode

      // If payment_id is missing, try to recover it by re-creating the finalized quote
      let paymentId = policyRecord.payment_id
      if (!paymentId) {
        console.warn('[Bonzah Payment] No payment_id found - attempting recovery via re-quote...')
        const recovered = await recoverPaymentId(policyRecord, credentials)
        if (!recovered) {
          await supabase
            .from('bonzah_insurance_policies')
            .update({ status: 'failed' })
            .eq('id', body.policy_record_id)
          return errorResponse('No payment_id found and recovery failed. Quote may need to be re-created manually.', 400)
        }
        paymentId = recovered.paymentId
        // Update the policy record with the recovered payment_id and new quote_id
        await supabase
          .from('bonzah_insurance_policies')
          .update({ payment_id: paymentId, quote_id: recovered.quoteId })
          .eq('id', body.policy_record_id)
        console.log('[Bonzah Payment] payment_id recovered and saved:', paymentId)
      }

      // Check Bonzah balance first (captured in outer scope for error handling)
      try {
        const balanceResponse = await bonzahFetchWithCredentials<{ status: number; data: { amount: string } }>(
          '/Bonzah/cdBalance',
          {},
          credentials,
          'GET'
        )
        cdBalance = balanceResponse?.data?.amount != null ? Number(balanceResponse.data.amount) : null
        console.log('[Bonzah Payment] Bonzah Balance:', cdBalance)
      } catch (balErr) {
        console.log('[Bonzah Payment] Could not check Bonzah balance:', balErr)
      }

      // Call the /Bonzah/payment endpoint to complete payment and issue policy
      // Amount sent as string to match Bonzah Postman collection format
      const amount = String(policyRecord.premium_amount)
      console.log('[Bonzah Payment] Sending amount as string:', amount)

      const paymentResponse = await bonzahFetchWithCredentials<BonzahPaymentResponse>(
        '/Bonzah/payment',
        {
          payment_id: paymentId,
          amount: amount,
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
      } else if (paymentResponse.status !== 0) {
        // Non-zero status indicates a Bonzah-side error (e.g. insufficient balance)
        const errorMsg = paymentResponse.txt || `Bonzah payment returned status ${paymentResponse.status}`
        console.error('[Bonzah Payment] Non-zero payment status:', paymentResponse.status, errorMsg)

        // Detect balance errors by keyword only — Bonzah balance is broker-level, not allocated
        const balanceKeywords = ['insufficient', 'balance', 'fund', 'credit', 'bonzah balance', 'allocat']
        const isBalanceError = balanceKeywords.some(kw => errorMsg.toLowerCase().includes(kw))

        const newStatus = isBalanceError ? 'insufficient_balance' : 'failed'

        await supabase
          .from('bonzah_insurance_policies')
          .update({ status: newStatus })
          .eq('id', body.policy_record_id)

        // Only send notifications on first insufficient_balance detection (not retries)
        if (isBalanceError && policyRecord.status !== 'insufficient_balance') {
          try {
            await sendInsufficientBalanceNotifications(supabase, policyRecord, cdBalance)
          } catch (notifyErr) {
            console.error('[Bonzah Payment] Error sending insufficient balance notifications:', notifyErr)
          }
        }

        if (isBalanceError) {
          return jsonResponse({
            success: false,
            error: 'insufficient_balance',
            cd_balance: cdBalance,
            premium: policyRecord.premium_amount,
            message: errorMsg,
            bonzah_mode: bonzahMode,
          }, 422)
        }

        return errorResponse(`Bonzah payment failed: ${errorMsg}`, 500)
      }
    } catch (bonzahError) {
      console.error('[Bonzah Payment] Error calling Bonzah API:', bonzahError)
      const errorMsg = bonzahError instanceof Error ? bonzahError.message : 'Unknown error'

      // Detect balance errors by keyword only — Bonzah balance is broker-level, not allocated
      const balanceKeywords = ['insufficient', 'balance', 'fund', 'credit', 'bonzah balance', 'allocat']
      const isBalanceError = balanceKeywords.some(kw => errorMsg.toLowerCase().includes(kw))

      const newStatus = isBalanceError ? 'insufficient_balance' : 'failed'
      console.log(`[Bonzah Payment] Setting status to '${newStatus}' (balance error: ${isBalanceError}, Bonzah balance: ${cdBalance}, premium: ${policyRecord.premium_amount})`)

      await supabase
        .from('bonzah_insurance_policies')
        .update({ status: newStatus })
        .eq('id', body.policy_record_id)

      // Only send notifications on first insufficient_balance detection (not retries)
      if (isBalanceError && policyRecord.status !== 'insufficient_balance') {
        try {
          await sendInsufficientBalanceNotifications(
            supabase,
            policyRecord,
            cdBalance,
          )
        } catch (notifyErr) {
          console.error('[Bonzah Payment] Error sending insufficient balance notifications:', notifyErr)
        }
      }

      if (isBalanceError) {
        return jsonResponse({
          success: false,
          error: 'insufficient_balance',
          cd_balance: cdBalance,
          premium: policyRecord.premium_amount,
          message: errorMsg,
          bonzah_mode: bonzahMode,
        }, 422)
      }

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
      bonzah_mode: bonzahMode,
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
