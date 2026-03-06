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

/**
 * Get current date and hour in Pacific timezone using formatToParts (locale-independent).
 */
function getPacificNow(): { date: string; hour: number } {
  const now = new Date()
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const y = dateParts.find(p => p.type === 'year')!.value
  const m = dateParts.find(p => p.type === 'month')!.value
  const d = dateParts.find(p => p.type === 'day')!.value

  const timeParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', hour12: false,
  }).formatToParts(now)
  const hour = parseInt(timeParts.find(p => p.type === 'hour')!.value, 10)

  return { date: `${y}-${m}-${d}`, hour }
}

function getPacificTomorrow(): string {
  const tomorrow = new Date(Date.now() + 86400000)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(tomorrow)
  const y = parts.find(p => p.type === 'year')!.value
  const m = parts.find(p => p.type === 'month')!.value
  const d = parts.find(p => p.type === 'day')!.value
  return `${y}-${m}-${d}`
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

interface SinglePolicyResult {
  success: boolean
  policyRecordId: string
  policyNo: string | null
  policyId: string | null
  policyIssued: boolean
  pdfIds: Record<string, string>
  error?: string
  isBalanceError?: boolean
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

  // Bonzah rejects same-day trip starts — minimum is tomorrow in Pacific timezone
  const pacific = getPacificNow()
  const pacificTomorrow = getPacificTomorrow()

  const recoveryStart = policyRecord.trip_start_date <= pacific.date ? pacificTomorrow : policyRecord.trip_start_date
  const recoveryEnd = policyRecord.trip_end_date <= recoveryStart ? recoveryStart : policyRecord.trip_end_date
  const tripTime = '15:00:00'

  const quoteRequest: Record<string, unknown> = {
    product_id: PRODUCT_ID,
    finalize: 1,
    source: 'API',
    policy_booking_time_zone: 'America/Los_Angeles',
    trip_start_date: `${formatDateForBonzah(recoveryStart)} ${tripTime}`,
    trip_end_date: `${formatDateForBonzah(recoveryEnd)} ${tripTime}`,
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
 * Process payment for a single policy record.
 * Returns result with success/failure and policy details.
 */
async function processSinglePayment(
  supabase: any,
  policyRecord: any,
  credentials: TenantBonzahCredentials,
): Promise<SinglePolicyResult> {
  const recordId = policyRecord.id

  // Skip if already active
  if (policyRecord.status === 'active') {
    console.log(`[Bonzah Payment] Policy ${recordId} already active: ${policyRecord.policy_no}`)
    return {
      success: true,
      policyRecordId: recordId,
      policyNo: policyRecord.policy_no,
      policyId: policyRecord.policy_id,
      policyIssued: true,
      pdfIds: {},
    }
  }

  // Update status to payment_pending
  await supabase
    .from('bonzah_insurance_policies')
    .update({ status: 'payment_pending' })
    .eq('id', recordId)

  // If payment_id is missing, try to recover it
  let paymentId = policyRecord.payment_id
  if (!paymentId) {
    console.warn(`[Bonzah Payment] No payment_id for ${recordId} - attempting recovery...`)
    const recovered = await recoverPaymentId(policyRecord, credentials)
    if (!recovered) {
      await supabase
        .from('bonzah_insurance_policies')
        .update({ status: 'failed' })
        .eq('id', recordId)
      return {
        success: false,
        policyRecordId: recordId,
        policyNo: null,
        policyId: null,
        policyIssued: false,
        pdfIds: {},
        error: 'No payment_id found and recovery failed',
      }
    }
    paymentId = recovered.paymentId
    await supabase
      .from('bonzah_insurance_policies')
      .update({ payment_id: paymentId, quote_id: recovered.quoteId })
      .eq('id', recordId)
    console.log(`[Bonzah Payment] payment_id recovered for ${recordId}:`, paymentId)
  }

  // Call the /Bonzah/payment endpoint
  const amount = String(policyRecord.premium_amount)
  console.log(`[Bonzah Payment] Processing payment for ${recordId}: payment_id=${paymentId}, amount=$${amount}`)

  const paymentResponse = await bonzahFetchWithCredentials<BonzahPaymentResponse>(
    '/Bonzah/payment',
    {
      payment_id: paymentId,
      amount: amount,
    },
    credentials
  )

  console.log(`[Bonzah Payment] Payment response for ${recordId}: status=${paymentResponse.status}`)

  if (paymentResponse.status === 0 && paymentResponse.data) {
    const policyNo = paymentResponse.data.policy_no
    const policyId = paymentResponse.data.policy_id
    const policyIssued = !!policyNo

    const pdfIds: Record<string, string> = {}
    if (paymentResponse.data.cdw_pdf_id) pdfIds.cdw = paymentResponse.data.cdw_pdf_id
    if (paymentResponse.data.rcli_pdf_id) pdfIds.rcli = paymentResponse.data.rcli_pdf_id
    if (paymentResponse.data.sli_pdf_id) pdfIds.sli = paymentResponse.data.sli_pdf_id
    if (paymentResponse.data.pai_pdf_id) pdfIds.pai = paymentResponse.data.pai_pdf_id

    // Update policy record with results
    const updateData: Record<string, unknown> = {
      status: policyIssued ? 'active' : 'payment_confirmed',
      policy_issued_at: policyIssued ? new Date().toISOString() : null,
    }
    if (policyNo) updateData.policy_no = policyNo
    if (policyId) updateData.policy_id = policyId
    if (Object.keys(pdfIds).length > 0) {
      updateData.coverage_types = {
        ...policyRecord.coverage_types,
        pdf_ids: pdfIds,
      }
    }

    await supabase
      .from('bonzah_insurance_policies')
      .update(updateData)
      .eq('id', recordId)

    console.log(`[Bonzah Payment] Policy ${recordId} issued: ${policyNo}`)

    return {
      success: true,
      policyRecordId: recordId,
      policyNo,
      policyId,
      policyIssued,
      pdfIds,
    }
  }

  // Payment failed
  const errorMsg = paymentResponse.txt || `Bonzah payment returned status ${paymentResponse.status}`
  const balanceKeywords = ['insufficient', 'balance', 'fund', 'credit', 'bonzah balance', 'allocat']
  const isBalanceError = balanceKeywords.some(kw => errorMsg.toLowerCase().includes(kw))
  const newStatus = isBalanceError ? 'insufficient_balance' : 'failed'

  await supabase
    .from('bonzah_insurance_policies')
    .update({ status: newStatus })
    .eq('id', recordId)

  return {
    success: false,
    policyRecordId: recordId,
    policyNo: null,
    policyId: null,
    policyIssued: false,
    pdfIds: {},
    error: errorMsg,
    isBalanceError,
  }
}

/**
 * Send notifications (in-app + email) to tenant admins when Bonzah balance is insufficient.
 */
async function sendInsufficientBalanceNotifications(
  supabase: any,
  policyRecord: any,
  cdBalance: number | null,
  totalPremium?: number,
) {
  const tenantId = policyRecord.tenant_id
  const premium = totalPremium ?? policyRecord.premium_amount

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

  // Hoist so the outer catch can update the policy status on crash
  let policyRecordId: string | undefined

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body: ConfirmPaymentRequest = await req.json()
    policyRecordId = body.policy_record_id

    console.log('[Bonzah Payment] Confirming payment for policy:', policyRecordId)

    if (!policyRecordId) {
      return errorResponse('Missing policy_record_id')
    }

    // Get the primary policy record from database
    const { data: policyRecord, error: fetchError } = await supabase
      .from('bonzah_insurance_policies')
      .select('*')
      .eq('id', policyRecordId)
      .single()

    if (fetchError || !policyRecord) {
      console.error('[Bonzah Payment] Policy not found:', fetchError)
      return errorResponse('Policy record not found', 404)
    }

    // Build the list of all policies to confirm (primary + chain siblings)
    let policiesToConfirm = [policyRecord]

    if (policyRecord.chain_id) {
      // Fetch all policies in this chain, ordered by trip_start_date
      const { data: chainPolicies, error: chainError } = await supabase
        .from('bonzah_insurance_policies')
        .select('*')
        .eq('chain_id', policyRecord.chain_id)
        .order('trip_start_date', { ascending: true })

      if (!chainError && chainPolicies && chainPolicies.length > 1) {
        policiesToConfirm = chainPolicies
        console.log(`[Bonzah Payment] Found chain with ${chainPolicies.length} policies (chain_id: ${policyRecord.chain_id})`)
      }
    }

    // Check if ALL policies in chain are already active
    const allActive = policiesToConfirm.every((p: any) => p.status === 'active')
    if (allActive) {
      console.log('[Bonzah Payment] All policies already active')
      return jsonResponse({
        success: true,
        policy_no: policyRecord.policy_no,
        already_processed: true,
        chain_confirmed: policiesToConfirm.length,
      })
    }

    // Get per-tenant Bonzah credentials (once for all policies)
    let bonzahMode: 'test' | 'live' = 'test'
    let cdBalance: number | null = null
    let credentials: TenantBonzahCredentials

    try {
      credentials = await getTenantBonzahCredentials(supabase, policyRecord.tenant_id)
      bonzahMode = credentials.mode
    } catch (credError) {
      console.error('[Bonzah Payment] Failed to get credentials:', credError)
      return errorResponse('Failed to get Bonzah credentials', 500)
    }

    // Check Bonzah balance once
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

    // Calculate total premium across all policies to confirm
    const totalPremium = policiesToConfirm
      .filter((p: any) => p.status !== 'active')
      .reduce((sum: number, p: any) => sum + (p.premium_amount || 0), 0)

    // Process each policy in the chain
    const results: SinglePolicyResult[] = []
    let firstFailure: SinglePolicyResult | null = null

    for (const policy of policiesToConfirm) {
      try {
        const result = await processSinglePayment(supabase, policy, credentials)
        results.push(result)

        if (!result.success && !firstFailure) {
          firstFailure = result
          // If it's a balance error, stop processing further policies
          if (result.isBalanceError) {
            console.error(`[Bonzah Payment] Balance error on policy ${policy.id}, stopping chain`)
            // Mark remaining policies as insufficient_balance too
            const remaining = policiesToConfirm.slice(results.length)
            for (const rem of remaining) {
              if (rem.status !== 'active') {
                await supabase
                  .from('bonzah_insurance_policies')
                  .update({ status: 'insufficient_balance' })
                  .eq('id', rem.id)
              }
            }
            break
          }
        }
      } catch (err) {
        console.error(`[Bonzah Payment] Error processing policy ${policy.id}:`, err)
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        const balanceKeywords = ['insufficient', 'balance', 'fund', 'credit', 'bonzah balance', 'allocat']
        const isBalanceError = balanceKeywords.some(kw => errorMsg.toLowerCase().includes(kw))

        const newStatus = isBalanceError ? 'insufficient_balance' : 'failed'
        await supabase
          .from('bonzah_insurance_policies')
          .update({ status: newStatus })
          .eq('id', policy.id)

        const failResult: SinglePolicyResult = {
          success: false,
          policyRecordId: policy.id,
          policyNo: null,
          policyId: null,
          policyIssued: false,
          pdfIds: {},
          error: errorMsg,
          isBalanceError,
        }
        results.push(failResult)

        if (!firstFailure) firstFailure = failResult
        if (isBalanceError) break
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length
    const firstSuccess = results.find(r => r.success)

    console.log(`[Bonzah Payment] Chain results: ${successCount} succeeded, ${failCount} failed out of ${policiesToConfirm.length}`)

    // Handle insufficient balance error (send notifications only once)
    if (firstFailure?.isBalanceError) {
      if (policyRecord.status !== 'insufficient_balance') {
        try {
          await sendInsufficientBalanceNotifications(supabase, policyRecord, cdBalance, totalPremium)
        } catch (notifyErr) {
          console.error('[Bonzah Payment] Error sending insufficient balance notifications:', notifyErr)
        }
      }

      return jsonResponse({
        success: false,
        error: 'insufficient_balance',
        cd_balance: cdBalance,
        premium: totalPremium,
        message: firstFailure.error,
        bonzah_mode: bonzahMode,
        chain_confirmed: successCount,
        chain_total: policiesToConfirm.length,
      }, 422)
    }

    // If all failed (non-balance error)
    if (successCount === 0 && firstFailure) {
      return errorResponse(`Bonzah payment failed: ${firstFailure.error}`, 500)
    }

    // Success (full or partial)
    const primaryResult = results.find(r => r.policyRecordId === body.policy_record_id)
    const effectiveResult = primaryResult || firstSuccess

    return jsonResponse({
      success: true,
      policy_no: effectiveResult?.policyNo,
      policy_id: effectiveResult?.policyId,
      policy_issued: effectiveResult?.policyIssued ?? false,
      pdf_ids: effectiveResult?.pdfIds ?? {},
      status: effectiveResult?.policyIssued ? 'active' : 'payment_confirmed',
      bonzah_mode: bonzahMode,
      chain_confirmed: successCount,
      chain_total: policiesToConfirm.length,
    })

  } catch (error) {
    console.error('[Bonzah Payment] Error:', error)

    // Try to update status to failed using the stored policyRecordId
    // (req body is already consumed so req.clone().json() would fail)
    try {
      if (policyRecordId) {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )
        await supabase
          .from('bonzah_insurance_policies')
          .update({ status: 'failed' })
          .eq('id', policyRecordId)
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
