// Process a pending Stripe payment — polls Stripe to check if checkout session is paid
// Uses service role to bypass RLS

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getStripeClient, getTenantStripeMode, getConnectAccountId } from "../_shared/stripe-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { checkoutSessionId } = await req.json();

    if (!checkoutSessionId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing checkoutSessionId" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log("[PROCESS-PENDING] Looking for payment with session:", checkoutSessionId);

    // Find the payment by checkout session ID
    const { data: payment, error: findError } = await supabase
      .from('payments')
      .select('id, status, rental_id, tenant_id, amount, target_categories, extension_id')
      .eq('stripe_checkout_session_id', checkoutSessionId)
      .maybeSingle();

    if (findError || !payment) {
      return new Response(JSON.stringify({ ok: false, error: "Payment not found" }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payment.status === 'Applied' || payment.status === 'Completed' || payment.status === 'Partial') {
      // Even though the payment row is already settled, the installment side
      // may not be — if this payment was processed before installment self-heal
      // landed, the slot is still 'open'. Run the same lookup-and-settle here
      // so revisiting the success page (or the rental detail polling) will
      // retroactively settle. The RPC is idempotent: a second call on an
      // already-paid slot is a no-op.
      //
      // CRITICAL GUARD (mirrors apply-payment + stripe-webhook-test/live):
      // skip this retroactive self-heal when the payment is category-targeted
      // to fees only (Tax, Service Fee, etc.). Settling an installment slot
      // with a Tax payment corrupts the plan and is the root cause of the
      // "Tax: Not Paid but Collected = Tax amount" symptom on installment
      // rentals.
      const targets: string[] | null = (payment as any)?.target_categories ?? null;
      const isCategoryTargeted = Array.isArray(targets) && targets.length > 0;
      const targetsIncludeRental = isCategoryTargeted && targets!.includes('Rental');
      const allowRetroactiveSelfHeal = !isCategoryTargeted || targetsIncludeRental;
      if (payment.rental_id && !payment.extension_id && allowRetroactiveSelfHeal) {
        try {
          const todayStr = new Date().toISOString().split('T')[0];
          const { data: targetSlot } = await supabase
            .from('scheduled_installments')
            .select('id, installment_plan_id, installment_number')
            .eq('rental_id', payment.rental_id)
            .eq('invoice_status', 'open')
            .lte('due_date', todayStr)
            .order('installment_number', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (targetSlot) {
            const { error: settleErr } = await supabase.rpc('installment_settle_invoice', {
              p_payment_id: payment.id,
              p_installment_id: targetSlot.id,
            });
            if (settleErr) {
              console.error('[PROCESS-PENDING] retroactive settle error:', settleErr);
            } else {
              console.log('[PROCESS-PENDING] Retroactively settled installment:', targetSlot.id, 'slot', targetSlot.installment_number, 'for payment', payment.id);
              await supabase
                .from('installment_plans')
                .update({ status: 'active', upfront_paid: true, upfront_payment_id: payment.id })
                .eq('id', targetSlot.installment_plan_id)
                .neq('status', 'active');
            }
          }
        } catch (instErr) {
          console.error('[PROCESS-PENDING] retroactive self-heal error:', instErr);
        }
      } else if (payment.rental_id && isCategoryTargeted && !targetsIncludeRental) {
        console.log(`[PROCESS-PENDING] Skipping retroactive installment self-heal: payment ${payment.id} is targeted to non-Rental categories (${targets!.join(', ')}). Installment plan untouched.`);
      }
      return new Response(JSON.stringify({ ok: true, status: payment.status, alreadyProcessed: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check with Stripe if the session is actually paid
    const tenantId = payment.tenant_id;
    let stripeMode: 'test' | 'live' = 'test';
    let connectAccountId: string | null = null;

    if (tenantId) {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('stripe_mode, stripe_account_id, stripe_onboarding_complete')
        .eq('id', tenantId)
        .single();

      if (tenantData) {
        stripeMode = (tenantData.stripe_mode as 'test' | 'live') || 'test';
        connectAccountId = getConnectAccountId(tenantData);
      }
    }

    const stripe = getStripeClient(stripeMode);
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    let sessionPaid = false;
    let paymentIntentId: string | null = null;
    try {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, stripeOptions);
      sessionPaid = session.payment_status === 'paid';
      paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;
      console.log("[PROCESS-PENDING] Stripe session status:", session.payment_status, "paid:", sessionPaid);
    } catch (stripeErr: any) {
      console.error("[PROCESS-PENDING] Stripe session check failed:", stripeErr.message);
      // If we can't check Stripe, don't process — return "not paid yet"
      return new Response(JSON.stringify({ ok: false, notPaidYet: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!sessionPaid) {
      return new Response(JSON.stringify({ ok: false, notPaidYet: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log("[PROCESS-PENDING] Session is paid! Processing payment:", payment.id);

    // Update to Completed. CHECK the error — historically we didn't, which
    // masked a long-standing bug where this UPDATE silently failed (the
    // payments.paid_at column didn't exist for a while, the chk_pnl_category_valid
    // constraint didn't allow Extension* categories, and payment_apply_fifo_v2
    // didn't honor target_categories — all three triggered constraint errors
    // that rolled back this UPDATE without ever surfacing). Now if the UPDATE
    // fails, we return an explicit error so the caller (booking-success page,
    // rental-detail polling) doesn't show "Payment Received" while the row
    // is stuck in Pending.
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'Completed',
        capture_status: 'captured',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
      })
      .eq('id', payment.id);

    if (updateError) {
      console.error("[PROCESS-PENDING] CRITICAL: failed to update payment to Completed:", updateError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'Stripe captured the payment but our DB update failed',
          detail: updateError.message,
          paymentId: payment.id,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Apply payment to ledger. Pass target_categories explicitly when present
    // (defense in depth — apply-payment also reads from the payment record, but
    // an explicit pass guards against any path where the read might miss). This
    // is critical for "Add Payment on Tax row" flows: without target_categories
    // apply-payment runs universal FIFO and lands the money on Rental first.
    const targets: string[] | null = (payment as any)?.target_categories ?? null;
    const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
      body: {
        paymentId: payment.id,
        ...(Array.isArray(targets) && targets.length > 0 ? { targetCategories: targets } : {}),
      },
    });

    if (applyError) {
      console.error("[PROCESS-PENDING] apply-payment error:", applyError);
    } else {
      console.log("[PROCESS-PENDING] apply-payment result:", applyResult?.status, "allocated:", applyResult?.allocated);
    }

    // Phase 3: if this payment funded a rental extension, finalize it atomically.
    // The RPC updates rental_extensions.status, extends rentals.end_date
    // (guarded so we never shrink), clears the legacy pending-extension flags,
    // and back-stamps payments.extension_id if missing. Idempotent.
    // Bonzah is confirmed at approval time (matches original-rental flow).
    if (payment.extension_id) {
      const { data: finalizeResult, error: finalizeError } = await supabase.rpc('finalize_rental_extension', {
        p_extension_id: payment.extension_id,
        p_payment_id: payment.id,
      });
      if (finalizeError) {
        console.error("[PROCESS-PENDING] finalize_rental_extension error:", finalizeError);
      } else {
        console.log("[PROCESS-PENDING] Extension finalized:", finalizeResult);
      }
    }

    // Installment settlement (mirrors stripe-webhook-test/live).
    // Stripe webhooks don't always reach our endpoint reliably (and in dev
    // sometimes never fire), so this polling path also needs to settle the
    // matching installment when the payment is for a rental with an
    // installment plan. We use only DB signals — no metadata required —
    // so it works regardless of what create-checkout-session stamped.
    // Skips when the payment is for a different concern (extension or
    // bonzah) so we don't accidentally settle installments on those.
    //
    // CRITICAL GUARD: also skip for category-targeted payments that don't
    // include 'Rental'. A Tax payment must never settle an installment slot.
    // The DB-level installment_settle_invoice RPC also enforces this, but
    // gating at the call site avoids an extra round trip + audit-log noise.
    const targetsForSelfHeal: string[] | null = (payment as any)?.target_categories ?? null;
    const isCatTargeted = Array.isArray(targetsForSelfHeal) && targetsForSelfHeal.length > 0;
    const targetsHaveRental = isCatTargeted && targetsForSelfHeal!.includes('Rental');
    const allowSelfHealHere = !isCatTargeted || targetsHaveRental;
    if (payment.rental_id && !payment.extension_id && allowSelfHealHere) {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        // Latest overdue or due-today open slot for this rental.
        // installment_settle_invoice cumulatively supersedes earlier
        // open slots, so picking the latest gives PAYG-style behavior.
        const { data: targetSlot } = await supabase
          .from('scheduled_installments')
          .select('id, installment_plan_id, installment_number')
          .eq('rental_id', payment.rental_id)
          .eq('invoice_status', 'open')
          .lte('due_date', todayStr)
          .order('installment_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (targetSlot) {
          const { error: settleErr } = await supabase.rpc('installment_settle_invoice', {
            p_payment_id: payment.id,
            p_installment_id: targetSlot.id,
          });
          if (settleErr) {
            console.error('[PROCESS-PENDING] installment_settle_invoice error:', settleErr);
          } else {
            console.log('[PROCESS-PENDING] Installment settled (poll-fallback):', targetSlot.id, 'slot', targetSlot.installment_number);
            // Activate the plan + capture saved card, mirroring the webhook path
            try {
              const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
              const paymentMethodId = typeof pi.payment_method === 'string'
                ? pi.payment_method
                : pi.payment_method?.id;
              await supabase
                .from('installment_plans')
                .update({
                  status: 'active',
                  upfront_paid: true,
                  upfront_payment_id: payment.id,
                  stripe_payment_method_id: paymentMethodId ?? null,
                  collection_mode: paymentMethodId ? 'auto' : 'manual',
                })
                .eq('id', targetSlot.installment_plan_id);
            } catch (planErr) {
              console.error('[PROCESS-PENDING] plan activation error (non-fatal):', planErr);
            }
          }
        }
      } catch (instErr) {
        console.error('[PROCESS-PENDING] installment self-heal error:', instErr);
      }
    }

    // Update invoice status
    if (payment.rental_id) {
      await supabase.from('invoices').update({ status: 'paid' }).eq('rental_id', payment.rental_id);

      // Legacy fallback: if extension_id wasn't stamped (pre-Phase-3 payments),
      // still clear the extension scratch fields based on target_categories.
      // Phase 3+ payments are handled by the RPC above.
      if (!payment.extension_id) {
        const hasExtensionTargets = payment.target_categories &&
          Array.isArray(payment.target_categories) &&
          payment.target_categories.some((c: string) => c.startsWith('Extension'));
        if (hasExtensionTargets) {
          await supabase.from('rentals').update({
            extension_checkout_url: null,
            extension_amount: null
          }).eq('id', payment.rental_id);
          console.log("[PROCESS-PENDING] Legacy: cleared extension checkout fields for rental:", payment.rental_id);
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      status: applyResult?.status || 'Completed',
      allocated: applyResult?.allocated || 0,
      rentalId: payment.rental_id || null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("[PROCESS-PENDING] Error:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
