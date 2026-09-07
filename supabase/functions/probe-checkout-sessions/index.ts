// probe-checkout-sessions (one-off ops tool)
//
// Given a list of { id (checkout session), platform_account, connected_account },
// retrieve the LIVE Stripe checkout session on the correct connected account and
// report its real payment_status + the underlying payment_intent status. Answers
// the only question that matters for a "customer says they paid but it's not
// reflected" report: did the card actually get charged (money taken, our DB out
// of sync) or was the checkout abandoned (no money taken)?
//
// Auth: service-role key only.

import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getStripeClientForAccount } from '../_shared/stripe-client.ts'

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing authorization header', 401)
    const token = authHeader.replace('Bearer ', '').trim()
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if (token !== serviceKey) return errorResponse('Unauthorized', 401)

    const body = await req.json()

    // --- MODE 2: list succeeded charges on a connected account ---
    if (body.listCharges) {
      const { platform_account, connected_account, created_gte } = body.listCharges as { platform_account: 'uk' | 'uae'; connected_account: string; created_gte: number }
      const stripe = getStripeClientForAccount(platform_account, 'live')
      const out: any[] = []
      let starting_after: string | undefined = undefined
      for (let page = 0; page < 10; page++) {
        const pi: any = await stripe.paymentIntents.list(
          { limit: 100, created: { gte: created_gte }, ...(starting_after ? { starting_after } : {}) } as any,
          { stripeAccount: connected_account },
        )
        for (const p of pi.data) {
          out.push({ id: p.id, status: p.status, amount: p.amount, currency: p.currency, created: p.created, receipt_email: p.receipt_email, description: p.description })
        }
        if (!pi.has_more) break
        starting_after = pi.data[pi.data.length - 1]?.id
      }
      return jsonResponse({ account: platform_account, connected_account, count: out.length, payment_intents: out })
    }

    // --- MODE 3: retrieve one PI with metadata + latest charge ---
    if (body.retrievePI) {
      const { platform_account, connected_account, pi_id } = body.retrievePI as { platform_account: 'uk' | 'uae'; connected_account: string; pi_id: string }
      const stripe = getStripeClientForAccount(platform_account, 'live')
      const pi: any = await stripe.paymentIntents.retrieve(pi_id, { expand: ['latest_charge', 'invoice', 'payment_method'] }, { stripeAccount: connected_account })
      const ch = pi.latest_charge
      return jsonResponse({
        id: pi.id, status: pi.status, amount: pi.amount, currency: pi.currency, created: pi.created,
        metadata: pi.metadata, description: pi.description, receipt_email: pi.receipt_email,
        // Origin discriminators:
        application_fee_amount: pi.application_fee_amount ?? ch?.application_fee_amount ?? null,  // set => created by OUR platform via Connect
        on_behalf_of: pi.on_behalf_of ?? null,
        transfer_data: pi.transfer_data ?? null,
        invoice: pi.invoice ? (typeof pi.invoice === 'string' ? pi.invoice : pi.invoice.id) : null,   // set => Stripe invoice/subscription
        payment_link: ch?.payment_link ?? null,                                                       // set => Stripe Payment Link
        statement_descriptor: pi.statement_descriptor ?? null,
        payment_method_type: pi.payment_method?.type ?? null,
        card_last4: pi.payment_method?.card?.last4 ?? ch?.payment_method_details?.card?.last4 ?? null,
        charge_metadata: ch?.metadata ?? null,
        latest_charge: ch ? { id: ch.id, billing_email: ch.billing_details?.email, receipt_url: ch.receipt_url, paid: ch.paid } : null,
      })
    }

    // --- MODE 4: find checkout session(s) that produced a given PI ---
    if (body.sessionByPI) {
      const { platform_account, connected_account, pi_id } = body.sessionByPI as { platform_account: 'uk' | 'uae'; connected_account: string; pi_id: string }
      const stripe = getStripeClientForAccount(platform_account, 'live')
      const list: any = await stripe.checkout.sessions.list({ payment_intent: pi_id, limit: 5 } as any, { stripeAccount: connected_account })
      return jsonResponse({
        pi_id,
        session_count: list.data.length,
        came_through_checkout: list.data.length > 0,
        sessions: list.data.map((s: any) => ({ id: s.id, status: s.status, payment_status: s.payment_status, metadata: s.metadata, created: s.created })),
      })
    }

    const sessions: Array<{ id: string; platform_account: 'uk' | 'uae'; connected_account: string; payment_row_id?: string; amount?: number }> = body.sessions || []

    const results: any[] = []
    for (const s of sessions) {
      try {
        const stripe = getStripeClientForAccount(s.platform_account, 'live')
        const cs: any = await stripe.checkout.sessions.retrieve(
          s.id,
          { expand: ['payment_intent'] },
          { stripeAccount: s.connected_account },
        )
        const pi = cs.payment_intent
        results.push({
          payment_row_id: s.payment_row_id,
          db_amount: s.amount,
          session_id: s.id,
          account: s.platform_account,
          status: cs.status,                      // open | complete | expired
          payment_status: cs.payment_status,      // paid | unpaid | no_payment_required
          amount_total: cs.amount_total,
          currency: cs.currency,
          payment_intent_id: typeof pi === 'string' ? pi : pi?.id ?? null,
          pi_status: typeof pi === 'object' ? pi?.status : null,   // succeeded | requires_payment_method | ...
          charged: cs.payment_status === 'paid' || (typeof pi === 'object' && pi?.status === 'succeeded'),
          customer_email: cs.customer_details?.email ?? null,
          created: cs.created,
          expires_at: cs.expires_at,
        })
      } catch (e) {
        results.push({ payment_row_id: s.payment_row_id, session_id: s.id, account: s.platform_account, error: (e as any)?.message || String(e) })
      }
    }

    const chargedButUnreconciled = results.filter((r) => r.charged)
    return jsonResponse({
      count: results.length,
      charged_count: chargedButUnreconciled.length,
      charged_sessions: chargedButUnreconciled,
      results,
    })
  } catch (err) {
    console.error('[probe-checkout-sessions] error:', err)
    return errorResponse(err instanceof Error ? err.message : 'failed', 500)
  }
})
