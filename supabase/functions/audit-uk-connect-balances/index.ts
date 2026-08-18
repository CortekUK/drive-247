// audit-uk-connect-balances (one-off ops tool)
//
// Reads the LIVE balance + latest payout for every tenant's UK (Cortek US)
// connected account, using the legacy UK platform key with the correct
// Stripe-Account (on-behalf-of) header. Answers: "how much operator money is
// still sitting on the UK platform, un-paid-out?" — the exposure before UK is
// frozen. Balances are NOT portable to the UAE platform; they can only be paid
// out to the operator's bank from UK.
//
// Auth: service-role key OR super-admin JWT (same gate as sync-connect-status).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getStripeClientForAccount } from '../_shared/stripe-client.ts'

function sumByCurrency(entries: unknown) {
  const out: Record<string, number> = {}
  if (!Array.isArray(entries)) return out
  for (const e of entries) out[e.currency] = (out[e.currency] || 0) + (e.amount || 0)
  return out
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing authorization header', 401)
    const token = authHeader.replace('Bearer ', '').trim()
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey)
    if (token !== serviceKey) return errorResponse('Unauthorized', 401)

    const stripe = getStripeClientForAccount('uk', 'live') // Cortek US platform key

    const { data: tenants } = await supabase
      .from('tenants')
      .select('company_name, slug, stripe_account_id, payment_model, subscription_account')
      .not('stripe_account_id', 'is', null)
      .order('company_name')

    const results: any[] = []
    const totals: Record<string, number> = {}
    for (const t of tenants || []) {
      const acct = t.stripe_account_id as string
      try {
        const bal: any = await stripe.balance.retrieve({ stripeAccount: acct } as any)
        const available = sumByCurrency(bal.available)
        const pending = sumByCurrency(bal.pending)
        const instant = sumByCurrency(bal.instant_available)
        // "owed to operator, not yet in their bank" = available + pending
        const owed: Record<string, number> = {}
        for (const c of new Set([...Object.keys(available), ...Object.keys(pending)])) {
          owed[c] = (available[c] || 0) + (pending[c] || 0)
        }
        for (const [c, v] of Object.entries(owed)) totals[c] = (totals[c] || 0) + v

        // latest payout state
        let lastPayout: any = null
        try {
          const po: any = await stripe.payouts.list({ limit: 1 } as any, { stripeAccount: acct })
          if (po.data?.[0]) lastPayout = { amount: po.data[0].amount, currency: po.data[0].currency, status: po.data[0].status, arrival: po.data[0].arrival_date }
        } catch (_) { /* payouts may be unavailable */ }

        results.push({ company: t.company_name, acct, model: t.payment_model, available, pending, instant, owed, lastPayout })
      } catch (e) {
        results.push({ company: t.company_name, acct, model: t.payment_model, error: (e as any)?.message || String(e) })
      }
    }

    // sort by owed (any currency) desc
    results.sort((a, b) => {
      const av = Object.values(a.owed || {}).reduce((s: number, v: any) => s + v, 0)
      const bv = Object.values(b.owed || {}).reduce((s: number, v: any) => s + v, 0)
      return bv - av
    })

    return jsonResponse({ count: results.length, totalsOwedByCurrency: totals, results })
  } catch (err) {
    console.error('[audit-uk-connect-balances] error:', err)
    return errorResponse(err instanceof Error ? err.message : 'failed', 500)
  }
})
