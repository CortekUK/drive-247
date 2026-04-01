// Release a deposit hold — cancels the Stripe PaymentIntent to free the held funds
// Called at key handover (receiving) or manually by admin

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getStripeClient, getConnectAccountId, type StripeMode } from "../_shared/stripe-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId, tenantId } = await req.json();

    if (!rentalId) {
      return errorResponse("Missing required field: rentalId");
    }

    console.log("[DEPOSIT-RELEASE] Releasing hold for rental:", rentalId);

    // Fetch rental deposit hold info
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_amount, tenant_id")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    if (!rental.deposit_hold_payment_intent_id) {
      return jsonResponse({ success: true, skipped: true, message: "No deposit hold to release" });
    }

    if (rental.deposit_hold_status !== "held" && rental.deposit_hold_status !== "refreshing") {
      return jsonResponse({
        success: true,
        skipped: true,
        message: `Deposit hold is already ${rental.deposit_hold_status}`,
      });
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    // Fetch tenant Stripe config
    const { data: tenant } = await supabase
      .from("tenants")
      .select("stripe_mode, stripe_account_id, stripe_onboarding_complete")
      .eq("id", effectiveTenantId)
      .single();

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || "test";
    const stripe = getStripeClient(stripeMode);
    const connectAccountId = tenant ? getConnectAccountId(tenant) : null;
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    // Cancel the PaymentIntent to release the hold
    try {
      await stripe.paymentIntents.cancel(
        rental.deposit_hold_payment_intent_id,
        stripeOptions
      );
      console.log("[DEPOSIT-RELEASE] PaymentIntent cancelled:", rental.deposit_hold_payment_intent_id);
    } catch (stripeErr: any) {
      // If already cancelled or captured, that's fine
      if (stripeErr.code === "payment_intent_unexpected_state") {
        console.warn("[DEPOSIT-RELEASE] PaymentIntent already in final state:", stripeErr.message);
      } else {
        throw stripeErr;
      }
    }

    // Update rental
    const { error: updateError } = await supabase
      .from("rentals")
      .update({ deposit_hold_status: "released" })
      .eq("id", rentalId);

    if (updateError) {
      console.error("[DEPOSIT-RELEASE] Failed to update rental:", updateError);
      return errorResponse("Failed to update deposit hold status", 500);
    }

    console.log("[DEPOSIT-RELEASE] Hold released. Amount was:", rental.deposit_hold_amount);

    return jsonResponse({
      success: true,
      releasedAmount: rental.deposit_hold_amount,
    });
  } catch (error: any) {
    console.error("[DEPOSIT-RELEASE] Error:", error);
    return errorResponse(error.message, 500);
  }
});
