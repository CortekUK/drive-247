// Capture full or partial deposit from an active hold.
//
// Stripe quirk: partial capture of a PaymentIntent RELEASES the uncaptured
// remainder — it does NOT stay on hold. To match product behaviour ("charge $1,
// keep $2 on hold"), we:
//   1. Partial-capture the original PI for the requested amount.
//   2. If remainder > 0, create a NEW manual-capture PI for the remainder on
//      the same saved payment method and swap it into rentals.deposit_hold_*.
//   3. Record the captured amount as a real payment + ledger charge +
//      application so Collected reflects the money received.

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

    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(
        "deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_amount, deposit_hold_payment_method_id, deposit_hold_stripe_customer_id, tenant_id, customer_id, vehicle_id"
      )
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) return errorResponse("Rental not found", 404);
    if (!rental.deposit_hold_payment_intent_id) return errorResponse("No deposit hold exists for this rental", 400);
    if (rental.deposit_hold_status !== "held") {
      return errorResponse(`Cannot capture: deposit hold is ${rental.deposit_hold_status}`, 400);
    }
    const originalHold = Number(rental.deposit_hold_amount) || 0;
    if (amount > originalHold) {
      return errorResponse(`Capture amount ($${amount}) exceeds hold amount ($${originalHold})`, 400);
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    const { data: tenant } = await supabase
      .from("tenants")
      .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, currency_code")
      .eq("id", effectiveTenantId)
      .single();

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || "test";
    const stripe = getStripeClient(stripeMode);
    const connectAccountId = tenant ? getConnectAccountId(tenant) : null;
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    const capturedInCents = Math.round(amount * 100);
    const remainder = Math.max(0, originalHold - amount);
    const currency = (tenant?.currency_code || "usd").toLowerCase();

    // 1. Capture the requested amount from the original PI.
    const capturedIntent = await stripe.paymentIntents.capture(
      rental.deposit_hold_payment_intent_id,
      { amount_to_capture: capturedInCents },
      stripeOptions
    );
    console.log("[DEPOSIT-CAPTURE] Captured", amount, "on PI", capturedIntent.id);

    // 2. If remainder > 0, create a fresh hold so the customer still has money
    //    on the card. Stripe has released the uncaptured portion of the original
    //    PI the moment we partial-captured.
    let newHoldPiId: string | null = null;
    let newHoldExpiresAt: string | null = null;
    if (remainder > 0 && rental.deposit_hold_payment_method_id && rental.deposit_hold_stripe_customer_id) {
      try {
        const newHold = await stripe.paymentIntents.create(
          {
            amount: Math.round(remainder * 100),
            currency,
            customer: rental.deposit_hold_stripe_customer_id,
            payment_method: rental.deposit_hold_payment_method_id,
            capture_method: "manual",
            confirm: true,
            off_session: true,
            description: `Security deposit hold (rollover after partial capture) for rental ${rentalId.substring(0, 8).toUpperCase()}`,
            metadata: {
              rental_id: rentalId,
              tenant_id: effectiveTenantId,
              type: "deposit_hold_rollover",
              previous_hold_pi: rental.deposit_hold_payment_intent_id,
            },
          },
          stripeOptions
        );
        if (newHold.status === "requires_capture") {
          newHoldPiId = newHold.id;
          const exp = new Date();
          exp.setDate(exp.getDate() + 31);
          newHoldExpiresAt = exp.toISOString();
          console.log("[DEPOSIT-CAPTURE] Rolled remainder", remainder, "into new hold", newHoldPiId);
        } else {
          console.warn("[DEPOSIT-CAPTURE] Rollover hold landed in unexpected status", newHold.status);
        }
      } catch (err) {
        console.warn("[DEPOSIT-CAPTURE] Rollover hold failed:", err);
        // Non-fatal: capture still succeeded; the remainder is simply released.
      }
    }

    // 3. Record the captured amount as revenue: payment + Charge + allocation.
    const today = new Date().toISOString().split("T")[0];
    const { data: paymentRow, error: paymentError } = await supabase
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
        status: "Applied",
        remaining_amount: 0,
        verification_status: "auto_approved",
        stripe_payment_intent_id: rental.deposit_hold_payment_intent_id,
        capture_status: "captured",
        booking_source: "admin",
      })
      .select()
      .single();
    if (paymentError) {
      console.error("[DEPOSIT-CAPTURE] Failed to create payment:", paymentError);
    }

    // Use an existing Security Deposit Charge for today if one already exists
    // (the ux_rental_charge_unique index blocks a second insert with the same
    // rental/due_date/type/category). This matters when an admin captures the
    // hold in multiple small chunks on the same day.
    const { data: existingCharge } = await supabase
      .from("ledger_entries")
      .select("id, amount, remaining_amount, reference")
      .eq("rental_id", rentalId)
      .eq("type", "Charge")
      .eq("category", "Security Deposit")
      .eq("due_date", today)
      .is("extension_id", null)
      .maybeSingle();

    let chargeRow: { id: string } | null = null;
    if (existingCharge) {
      const newAmount = Number(existingCharge.amount || 0) + amount;
      const { data: updated, error: updateChargeError } = await supabase
        .from("ledger_entries")
        .update({
          amount: newAmount,
          remaining_amount: 0,
          reference: `${existingCharge.reference || "Deposit captured"} | ${reason || "Deposit captured"}`,
        })
        .eq("id", existingCharge.id)
        .select()
        .single();
      if (updateChargeError) {
        console.error("[DEPOSIT-CAPTURE] Failed to update existing charge:", updateChargeError);
      } else {
        chargeRow = updated;
      }
    } else {
      const { data: inserted, error: chargeError } = await supabase
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
          remaining_amount: 0,
          reference: reason || "Deposit captured",
        })
        .select()
        .single();
      if (chargeError) {
        console.error("[DEPOSIT-CAPTURE] Failed to create ledger charge:", chargeError);
      } else {
        chargeRow = inserted;
      }
    }

    if (paymentRow && chargeRow) {
      const { error: appError } = await supabase.from("payment_applications").insert({
        payment_id: paymentRow.id,
        charge_entry_id: chargeRow.id,
        amount_applied: amount,
        tenant_id: effectiveTenantId,
      });
      if (appError) {
        console.error("[DEPOSIT-CAPTURE] Failed to create payment_application:", appError);
      }
    }

    // 4. Update rental's deposit hold state. When the capture consumed the
    //    entire hold (remainder = 0), zero out deposit_hold_amount so the UI
    //    shows $0 for the Security Deposit row and hides Release/Charge buttons.
    const rentalUpdate: Record<string, unknown> = {};
    if (newHoldPiId) {
      rentalUpdate.deposit_hold_status = "held";
      rentalUpdate.deposit_hold_payment_intent_id = newHoldPiId;
      rentalUpdate.deposit_hold_amount = remainder;
      rentalUpdate.deposit_hold_placed_at = new Date().toISOString();
      rentalUpdate.deposit_hold_expires_at = newHoldExpiresAt;
    } else {
      rentalUpdate.deposit_hold_status = "captured";
      rentalUpdate.deposit_hold_amount = 0;
    }
    const { error: updateError } = await supabase.from("rentals").update(rentalUpdate).eq("id", rentalId);
    if (updateError) {
      console.error("[DEPOSIT-CAPTURE] Failed to update rental:", updateError);
    }

    return jsonResponse({
      success: true,
      capturedAmount: amount,
      holdAmount: originalHold,
      remainingHeldAmount: newHoldPiId ? remainder : 0,
      newHoldPiId,
      reason,
    });
  } catch (error: any) {
    console.error("[DEPOSIT-CAPTURE] Error:", error);
    return errorResponse(error.message, 500);
  }
});
