import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeClient,
  getSubscriptionStripeMode,
} from "../_shared/subscription-stripe.ts";
import { CREDIT_CONFIG } from "../_shared/credit-config.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization", 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify the user
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
    } = await supabaseUser.auth.getUser();
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await req.json();
    const { action } = body;

    switch (action) {
      // ─── Tenant: Update auto-refill settings ───
      case "update_auto_refill": {
        const { tenantId, enabled, threshold, amount } = body;
        if (!tenantId) return errorResponse("tenantId required");

        const updates: Record<string, any> = {};
        if (typeof enabled === "boolean")
          updates.auto_refill_enabled = enabled;
        if (typeof threshold === "number")
          updates.auto_refill_threshold = threshold;
        if (typeof amount === "number") updates.auto_refill_amount = amount;

        const { error } = await supabaseAdmin
          .from("tenant_credit_wallets")
          .update(updates)
          .eq("tenant_id", tenantId);

        if (error) return errorResponse(error.message, 500);
        return jsonResponse({ success: true });
      }

      // ─── Super Admin: Gift credits ───
      case "gift": {
        const { tenantId, amount, note, performedBy, isTestMode } = body;
        if (!tenantId || !amount || !note)
          return errorResponse("tenantId, amount, and note are required");

        const { data, error } = await supabaseAdmin.rpc("add_credits", {
          p_tenant_id: tenantId,
          p_amount: amount,
          p_type: "gift",
          p_description: note,
          p_performed_by: performedBy || null,
          p_is_test_mode: isTestMode || false,
        });

        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      // ─── Super Admin: Refund credits ───
      case "refund": {
        const {
          tenantId,
          amount: refundAmount,
          note: refundNote,
          category: refundCategory,
          performedBy: refundBy,
          isTestMode: refundTestMode,
        } = body;
        if (!tenantId || !refundAmount || !refundNote)
          return errorResponse("tenantId, amount, and note are required");

        const { data, error } = await supabaseAdmin.rpc("add_credits", {
          p_tenant_id: tenantId,
          p_amount: refundAmount,
          p_type: "refund",
          p_description: refundNote,
          p_category: refundCategory || null,
          p_performed_by: refundBy || null,
          p_is_test_mode: refundTestMode || false,
        });

        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      // ─── Super Admin: Adjust balance ───
      case "adjust": {
        const {
          tenantId,
          amount: adjustAmount,
          note: adjustNote,
          performedBy: adjustBy,
          isTestMode: adjustTestMode,
        } = body;
        if (!tenantId || adjustAmount === undefined || !adjustNote)
          return errorResponse("tenantId, amount, and note are required");

        const { data, error } = await supabaseAdmin.rpc("add_credits", {
          p_tenant_id: tenantId,
          p_amount: adjustAmount,
          p_type: "adjustment",
          p_description: adjustNote,
          p_performed_by: adjustBy || null,
          p_is_test_mode: adjustTestMode || false,
        });

        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      // ─── Auto-refill trigger (called after deduction) ───
      case "auto_refill": {
        const { tenantId } = body;
        if (!tenantId) return errorResponse("tenantId required");

        // Get wallet settings
        const { data: wallet } = await supabaseAdmin
          .from("tenant_credit_wallets")
          .select("*")
          .eq("tenant_id", tenantId)
          .single();

        if (!wallet || !wallet.auto_refill_enabled)
          return jsonResponse({ skipped: true, reason: "auto_refill not enabled" });

        if (wallet.balance > wallet.auto_refill_threshold)
          return jsonResponse({ skipped: true, reason: "balance above threshold" });

        // Get Stripe mode and client
        const mode = await getSubscriptionStripeMode(supabaseAdmin, tenantId);
        const stripe = getSubscriptionStripeClient(mode);

        // Need a saved payment method
        const { data: tenant } = await supabaseAdmin
          .from("tenants")
          .select("stripe_subscription_customer_id")
          .eq("id", tenantId)
          .single();

        if (!tenant?.stripe_subscription_customer_id)
          return errorResponse("No Stripe customer for auto-refill");

        const customerId = tenant.stripe_subscription_customer_id;

        // Get default payment method
        const customer = await stripe.customers.retrieve(customerId) as any;
        const paymentMethodId =
          wallet.stripe_payment_method_id ||
          customer.invoice_settings?.default_payment_method ||
          customer.default_source;

        if (!paymentMethodId)
          return errorResponse("No saved payment method for auto-refill");

        // Calculate charge using configured exchange rate
        const chargeAmountCents = Math.round(wallet.auto_refill_amount * CREDIT_CONFIG.CREDIT_PRICE_USD * 100);

        // Create PaymentIntent for auto-refill
        const paymentIntent = await stripe.paymentIntents.create({
          amount: chargeAmountCents,
          currency: "usd",
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: {
            type: "credit_auto_refill",
            tenant_id: tenantId,
            credits: String(wallet.auto_refill_amount),
          },
        });

        if (paymentIntent.status === "succeeded") {
          // Add credits immediately
          const { data: result } = await supabaseAdmin.rpc("add_credits", {
            p_tenant_id: tenantId,
            p_amount: wallet.auto_refill_amount,
            p_type: "auto_refill",
            p_description: `Auto-refill: +${wallet.auto_refill_amount} credits (balance was ${wallet.balance})`,
            p_stripe_payment_id: paymentIntent.id,
          });

          return jsonResponse({ success: true, ...result });
        }

        return errorResponse(
          `Payment failed: ${paymentIntent.status}`,
          402
        );
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    console.error("manage-credit-wallet error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
