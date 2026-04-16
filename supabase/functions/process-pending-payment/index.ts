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

    if (payment.status === 'Applied' || payment.status === 'Completed') {
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

    // Update to Completed
    await supabase
      .from('payments')
      .update({
        status: 'Completed',
        capture_status: 'captured',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: paymentIntentId,
      })
      .eq('id', payment.id);

    // Apply payment to ledger
    const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
      body: { paymentId: payment.id },
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
