// mark-installment-paid
//
// Operator-side action for manual-mode plans (cash, check, bank transfer).
// JWT-required. Records a payments row + calls installment_settle_invoice
// which marks the installment paid and supersedes earlier opens.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { corsHeaders, jsonResponse, errorResponse, handleCors } from '../_shared/cors.ts'

interface MarkPaidRequest {
  installmentId: string
  method: 'cash' | 'check' | 'bank_transfer' | 'other'
  reference?: string         // e.g., check number / wire reference
  amount?: number            // optional override; defaults to installment.amount
  paymentDate?: string       // optional override; defaults to today
}

Deno.serve(async (req) => {
  const corsResp = handleCors(req)
  if (corsResp) return corsResp

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return errorResponse('Missing Authorization header', 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const body = (await req.json()) as MarkPaidRequest
    if (!body.installmentId) return errorResponse('installmentId is required', 400)
    if (!body.method) return errorResponse('method is required', 400)

    // Look up the installment + plan
    const { data: installment, error: instErr } = await supabase
      .from('scheduled_installments')
      .select(`
        id, installment_plan_id, rental_id, customer_id, tenant_id,
        installment_number, amount, invoice_status
      `)
      .eq('id', body.installmentId)
      .single()
    if (instErr || !installment) return errorResponse('Installment not found', 404)

    if (installment.invoice_status === 'paid') {
      return jsonResponse({ success: true, alreadyPaid: true })
    }

    // Cumulative outstanding for this plan (this installment + any earlier opens)
    const { data: opens } = await supabase
      .from('scheduled_installments')
      .select('id, amount')
      .eq('installment_plan_id', installment.installment_plan_id)
      .eq('invoice_status', 'open')
      .lte('installment_number', installment.installment_number)

    const cumulative = (opens ?? []).reduce((s, i) => s + Number(i.amount || 0), 0)
    const recordedAmount = body.amount ?? cumulative
    const today = body.paymentDate || new Date().toISOString().split('T')[0]

    const methodLabel = body.method === 'cash' ? 'Cash'
                      : body.method === 'check' ? 'Check'
                      : body.method === 'bank_transfer' ? 'BankTransfer'
                      : 'Other'

    // Record payment row
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .insert({
        customer_id: installment.customer_id,
        rental_id: installment.rental_id,
        amount: recordedAmount,
        payment_date: today,
        method: methodLabel,
        payment_type: 'Payment',
        status: 'Applied',
        verification_status: 'auto_approved',
        capture_status: 'captured',
        tenant_id: installment.tenant_id,
        notes: body.reference ? `Manual payment ref: ${body.reference}` : 'Manual installment payment',
      })
      .select()
      .single()
    if (payErr || !payment) {
      console.error('payment insert error:', payErr)
      return errorResponse('Failed to record payment', 500)
    }

    // Settle (also supersedes earlier opens)
    const { error: rpcErr } = await supabase.rpc('installment_settle_invoice', {
      p_payment_id: payment.id,
      p_installment_id: installment.id,
    })
    if (rpcErr) {
      console.error('settle rpc error:', rpcErr)
      return errorResponse('Failed to settle installment', 500)
    }

    // Log timeline event
    await supabase.from('installment_notifications').insert({
      installment_id: installment.id,
      installment_plan_id: installment.installment_plan_id,
      tenant_id: installment.tenant_id,
      notification_type: 'manual_payment_recorded',
      status: 'success',
      amount: recordedAmount,
      payment_id: payment.id,
      message: `Manual payment recorded (${methodLabel}${body.reference ? ` · ${body.reference}` : ''}) for installment #${installment.installment_number}`,
      sent_at: new Date().toISOString(),
    })

    return jsonResponse({ success: true, paymentId: payment.id })
  } catch (error: any) {
    console.error('mark-installment-paid error:', error)
    return errorResponse(error?.message || 'Failed to mark installment paid', 500)
  }
})
