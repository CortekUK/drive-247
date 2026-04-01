// Capture full or partial deposit from an active hold
// Used when admin needs to deduct for damages, fines, or excess mileage
// Partial capture: Stripe auto-releases the uncaptured remainder

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

    const { rentalId, tenantId, amount, reason } = await req.json();

    if (!rentalId || !amount) {
      return errorResponse("Missing required fields: rentalId, amount");
    }

    if (amount <= 0) {
      return errorResponse("Amount must be greater than 0");
    }

    console.log("[DEPOSIT-CAPTURE] Capturing", amount, "from hold for rental:", rentalId);

    // Fetch rental deposit hold info
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_amount, tenant_id, customer_id, vehicle_id")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    if (!rental.deposit_hold_payment_intent_id) {
      return errorResponse("No deposit hold exists for this rental", 400);
    }

    if (rental.deposit_hold_status !== "held") {
      return errorResponse(`Cannot capture: deposit hold is ${rental.deposit_hold_status}`, 400);
    }

    if (amount > (rental.deposit_hold_amount || 0)) {
      return errorResponse(
        `Capture amount ($${amount}) exceeds hold amount ($${rental.deposit_hold_amount})`,
        400
      );
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    // Fetch tenant Stripe config
    const { data: tenant } = await supabase
      .from("tenants")
      .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code")
      .eq("id", effectiveTenantId)
      .single();

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || "test";
    const stripe = getStripeClient(stripeMode);
    const connectAccountId = tenant ? getConnectAccountId(tenant) : null;
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    const amountInCents = Math.round(amount * 100);

    // Capture the PaymentIntent (partial or full)
    const capturedIntent = await stripe.paymentIntents.capture(
      rental.deposit_hold_payment_intent_id,
      { amount_to_capture: amountInCents },
      stripeOptions
    );

    console.log("[DEPOSIT-CAPTURE] Captured:", capturedIntent.id, "amount:", amount, "status:", capturedIntent.status);

    // Create a payment record for the captured amount
    const today = new Date().toISOString().split("T")[0];
    const { error: paymentError } = await supabase
      .from("payments")
      .insert({
        rental_id: rentalId,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        tenant_id: effectiveTenantId,
        amount: amount,
        payment_date: today,
        method: "Card",
        payment_type: "Payment",
        status: "Completed",
        remaining_amount: amount,
        verification_status: "auto_approved",
        stripe_payment_intent_id: rental.deposit_hold_payment_intent_id,
        capture_status: "captured",
        booking_source: "admin",
      });

    if (paymentError) {
      console.error("[DEPOSIT-CAPTURE] Failed to create payment record:", paymentError);
    }

    // Create ledger entry for the captured deposit
    const { error: ledgerError } = await supabase
      .from("ledger_entries")
      .insert({
        rental_id: rentalId,
        customer_id: rental.customer_id,
        vehicle_id: rental.vehicle_id,
        tenant_id: effectiveTenantId,
        entry_date: today,
        due_date: today,
        type: "Charge",
        category: "Security Deposit",
        amount: amount,
        remaining_amount: 0, // Immediately paid via capture
        reference: reason || "Deposit captured",
      });

    if (ledgerError) {
      console.error("[DEPOSIT-CAPTURE] Failed to create ledger entry:", ledgerError);
    }

    // Update rental
    const { error: updateError } = await supabase
      .from("rentals")
      .update({ deposit_hold_status: "captured" })
      .eq("id", rentalId);

    if (updateError) {
      console.error("[DEPOSIT-CAPTURE] Failed to update rental:", updateError);
    }

    console.log("[DEPOSIT-CAPTURE] Complete. Captured:", amount, "of", rental.deposit_hold_amount, "Reason:", reason);

    return jsonResponse({
      success: true,
      capturedAmount: amount,
      holdAmount: rental.deposit_hold_amount,
      releasedAmount: (rental.deposit_hold_amount || 0) - amount,
      reason,
    });
  } catch (error: any) {
    console.error("[DEPOSIT-CAPTURE] Error:", error);
    return errorResponse(error.message, 500);
  }
});
