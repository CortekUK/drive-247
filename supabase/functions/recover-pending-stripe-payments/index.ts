// Cron-driven safety net for Stripe payments.
//
// Why this exists: in some configurations the Stripe webhook isn't routed to the
// matching test/live URL (e.g., test mode events arrive at stripe-webhook-live
// and fail signature verification with a 400). When the webhook misses, the only
// path that commits the payment is the booking-success page's client-side
// sync-payment-intent + apply-payment chain — which only runs if the customer
// redirects to a working app. Production app down or stale -> payment stays
// Pending forever.
//
// This function scans recent Pending Stripe-attached payments, retrieves each
// session from Stripe, and commits anything that paid. Triggers do the rest
// (auto_fifo_on_payment_completed -> ledger drain -> auto_settle_payg_on_ledger_drain).
// Designed to run every minute via pg_cron.
//
// SECOND PASS (added 2026-06-03): heal CAPTURED payments that committed but
// stranded as status='Credit' with $0 allocated even though their rental still
// has an open balance. Root cause was payment_apply_fifo_v2 refusing to let an
// untagged generic payment settle Extension* charges (fixed in migration
// 20260603120000), which left real Stripe money sitting as account credit while
// Balance Due never dropped — the "Stripe payment not recording on the website"
// report from globalmotiontransport (rental R-63b168). Re-running FIFO v2 (now
// fixed, and idempotent) re-allocates these against the open charges. Scoped to
// rentals that genuinely still owe money, so legitimate overpayment credits are
// never disturbed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getConnectAccountId, getStripeClientForRecord } from "../_shared/stripe-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const startedAt = Date.now();

  try {
    // ----------------------------------------------------------------------
    // PASS 1 — commit Pending Stripe payments that actually paid.
    // ----------------------------------------------------------------------
    // Pending payments with a Stripe session, < 24h old.
    // Includes Pending payments that were created by create-checkout-session
    // but never advanced (webhook missed + booking-success didn't run).
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: pending, error: pendingErr } = await supabase
      .from('payments')
      .select('id, rental_id, tenant_id, amount, stripe_checkout_session_id, target_categories, extension_id, platform_account')
      .eq('status', 'Pending')
      .not('stripe_checkout_session_id', 'is', null)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(100);

    if (pendingErr) throw pendingErr;

    // Cache tenant rows to avoid N tenant lookups. Client + connected account
    // are resolved PER PAYMENT from payments.platform_account (the platform the
    // money object was created on), not the tenant's current payment model.
    const tenantRows = new Map<string, any>();
    async function tenantFor(tenantId: string | null) {
      if (!tenantId) return null;
      if (tenantRows.has(tenantId)) return tenantRows.get(tenantId);
      const { data: t } = await supabase
        .from('tenants')
        .select('stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id')
        .eq('id', tenantId)
        .single();
      tenantRows.set(tenantId, t ?? null);
      return t ?? null;
    }

    let scanned = 0;
    let paid = 0;
    let unchanged = 0;
    let errors = 0;

    for (const p of pending ?? []) {
      scanned++;
      try {
        const t = await tenantFor(p.tenant_id);
        const stripeMode = (t?.stripe_mode as 'test' | 'live') || 'test';
        let stripe: Stripe | null = null;
        try { stripe = getStripeClientForRecord(p, stripeMode); } catch { stripe = null; }
        if (!stripe) { errors++; continue; }
        const connectAccountId = t
          ? getConnectAccountId({ ...t, payment_model: p.platform_account === 'uae' ? 'own' : 'managed' })
          : null;
        const opts = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

        const session = await stripe.checkout.sessions.retrieve(p.stripe_checkout_session_id, opts);
        if (session.payment_status !== 'paid') { unchanged++; continue; }

        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

        // Mark Completed. The auto_fifo_on_payment_completed trigger fires on this
        // status transition and runs payment_apply_fifo_v2, which drains the ledger.
        // auto_settle_payg_on_ledger_drain then flips the matching PAYG accrual to paid.
        await supabase.from('payments').update({
          status: 'Completed',
          capture_status: 'captured',
          stripe_payment_intent_id: paymentIntentId,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', p.id);

        // Belt-and-braces FIFO call (idempotent — payment_apply_fifo_v2 skips if already allocated)
        await supabase.rpc('payment_apply_fifo_v2', { p_id: p.id });

        paid++;
        console.log(`[recover] Committed payment ${p.id} (session ${p.stripe_checkout_session_id})`);
      } catch (err: any) {
        errors++;
        console.error(`[recover] Failed to process ${p.id}:`, err?.message);
      }
    }

    // ----------------------------------------------------------------------
    // PASS 2 — re-allocate captured 'Credit' payments stranded on a rental
    // that still owes money. These are real Stripe money that committed but
    // FIFO left unallocated (pre-fix extension exclusion, or any allocation
    // race). Re-running FIFO v2 is idempotent and only touches open charges,
    // so genuine overpayment credit (rental fully settled) is left alone.
    // ----------------------------------------------------------------------
    let creditScanned = 0;
    let creditHealed = 0;
    let creditErrors = 0;

    const { data: stranded, error: strandedErr } = await supabase
      .from('payments')
      .select('id, rental_id, customer_id, amount, remaining_amount')
      .eq('status', 'Credit')
      .eq('capture_status', 'captured')
      .not('rental_id', 'is', null)
      .not('stripe_checkout_session_id', 'is', null)
      .gt('remaining_amount', 0)
      .gte('created_at', cutoffIso)
      .order('created_at', { ascending: false })
      .limit(100);

    if (strandedErr) {
      console.error('[recover] Pass-2 query error:', strandedErr.message);
    } else {
      for (const p of stranded ?? []) {
        creditScanned++;
        try {
          // Only heal when the rental genuinely still has an open charge balance.
          const { data: openCharges } = await supabase
            .from('ledger_entries')
            .select('remaining_amount')
            .eq('rental_id', p.rental_id)
            .eq('type', 'Charge')
            .gt('remaining_amount', 0);

          const openBalance = (openCharges ?? []).reduce(
            (sum: number, r: any) => sum + Number(r.remaining_amount), 0,
          );
          if (openBalance <= 0) continue; // legitimate credit — leave it

          await supabase.rpc('payment_apply_fifo_v2', { p_id: p.id });

          // Confirm it actually moved off Credit before counting it healed.
          const { data: after } = await supabase
            .from('payments')
            .select('status')
            .eq('id', p.id)
            .maybeSingle();
          if (after && after.status !== 'Credit') {
            creditHealed++;
            console.log(`[recover] Healed stranded credit payment ${p.id} -> ${after.status} (rental ${p.rental_id} owed ${openBalance})`);
          }
        } catch (err: any) {
          creditErrors++;
          console.error(`[recover] Pass-2 failed for ${p.id}:`, err?.message);
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      scanned,
      paid,
      unchanged,
      errors,
      creditScanned,
      creditHealed,
      creditErrors,
      elapsedMs: Date.now() - startedAt,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[recover] Fatal error:', error);
    return new Response(JSON.stringify({ ok: false, error: error?.message ?? 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
