// Deduct an amount from the security deposit to cover an excess mileage charge
// Processes a partial Stripe refund of the deposit, then applies that amount to the excess mileage charge

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getConnectAccountId, getStripeClientForRecord, type StripeMode } from "../_shared/stripe-client.ts";
import { formatCurrency } from "../_shared/format-utils.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId, amount, tenantId } = await req.json();

    if (!rentalId || !amount || amount <= 0) {
      return errorResponse("Missing required fields: rentalId, amount (positive)");
    }

    console.log("[DEDUCT-DEPOSIT] Processing deduction for rental:", rentalId, "amount:", amount);

    // Fetch the excess mileage charge
    const { data: excessCharge, error: chargeError } = await supabase
      .from("ledger_entries")
      .select("id, amount, remaining_amount")
      .eq("rental_id", rentalId)
      .eq("type", "Charge")
      .eq("category", "Excess Mileage")
      .single();

    if (chargeError || !excessCharge) {
      return errorResponse("No excess mileage charge found for this rental");
    }

    if (excessCharge.remaining_amount <= 0) {
      return errorResponse("Excess mileage charge is already fully paid");
    }

    if (amount > excessCharge.remaining_amount) {
      return errorResponse(`Deduction amount (${amount}) exceeds remaining charge (${excessCharge.remaining_amount})`);
    }

    // Fetch rental details
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("id, customer_id, vehicle_id, tenant_id, deposit_hold_status, deposit_hold_payment_intent_id, deposit_hold_amount, platform_account")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    // Check the Security Deposit ledger — how much was charged and how much was already refunded
    const { data: depositCharges } = await supabase
      .from("ledger_entries")
      .select("amount, remaining_amount")
      .eq("rental_id", rentalId)
      .eq("type", "Charge")
      .eq("category", "Security Deposit");

    const { data: depositRefunds } = await supabase
      .from("ledger_entries")
      .select("amount")
      .eq("rental_id", rentalId)
      .eq("type", "Refund")
      .eq("category", "Security Deposit");

    const totalDepositCharged = depositCharges?.reduce((sum: number, c: any) => sum + (c.amount || 0), 0) || 0;
    const totalDepositRemaining = depositCharges?.reduce((sum: number, c: any) => sum + (c.remaining_amount || 0), 0) || 0;
    const totalDepositPaid = totalDepositCharged - totalDepositRemaining;
    const totalDepositRefunded = Math.abs(depositRefunds?.reduce((sum: number, r: any) => sum + (r.amount || 0), 0) || 0);
    const availableDeposit = totalDepositPaid - totalDepositRefunded;

    console.log("[DEDUCT-DEPOSIT] Deposit analysis:", {
      totalDepositCharged,
      totalDepositPaid,
      totalDepositRefunded,
      availableDeposit,
      requestedDeduction: amount,
    });

    if (availableDeposit <= 0) {
      return errorResponse("No deposit available to deduct from");
    }

    if (amount > availableDeposit) {
      return errorResponse(`Deduction amount (${amount}) exceeds available deposit (${availableDeposit})`);
    }

    // Get tenant's Stripe configuration
    const { data: tenantData } = await supabase
      .from("tenants")
      .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
      .eq("id", effectiveTenantId)
      .single();

    const currencyCode = tenantData?.currency_code || "USD";
    const stripeMode = (tenantData?.stripe_mode as StripeMode) || "test";
    // Resolve Stripe client + connected account from the platform the RECORD
    // (hold rental / payment) was created on — never the tenant's current
    // model, which may have flipped since the money object was created.
    const resolveForRecord = (record: { platform_account?: string | null }) => {
      const client = getStripeClientForRecord(record, stripeMode);
      const connectAccountId = tenantData
        ? getConnectAccountId({
            ...tenantData,
            payment_model: record.platform_account === "uae" ? "own" : "managed",
          })
        : null;
      return { client, options: connectAccountId ? { stripeAccount: connectAccountId } : undefined };
    };
    const { client: stripe, options: stripeOptions } = resolveForRecord(rental);

    // If there's an active deposit hold, capture from it instead of refunding
    if (rental.deposit_hold_status === 'held' && rental.deposit_hold_payment_intent_id) {
      if (amount > (rental.deposit_hold_amount || 0)) {
        return errorResponse(`Deduction amount (${amount}) exceeds hold amount (${rental.deposit_hold_amount})`);
      }

      try {
        const amountInCents = Math.round(amount * 100);
        const capturedIntent = await stripe.paymentIntents.capture(
          rental.deposit_hold_payment_intent_id,
          { amount_to_capture: amountInCents },
          stripeOptions
        );
        console.log("[DEDUCT-DEPOSIT] Captured from hold:", capturedIntent.id, "amount:", amount);

        // Update rental deposit hold status
        await supabase.from("rentals").update({ deposit_hold_status: "captured" }).eq("id", rentalId);

        // Create ledger entries
        const today = new Date().toISOString().split("T")[0];

        // Deposit capture ledger entry
        await supabase.from("ledger_entries").insert({
          rental_id: rentalId, customer_id: rental.customer_id, vehicle_id: rental.vehicle_id,
          tenant_id: effectiveTenantId, entry_date: today, due_date: today,
          type: "Payment", category: "Security Deposit", amount: amount, remaining_amount: 0,
          reference: `Deposit captured for excess mileage`,
        });

        // Update excess mileage charge remaining
        const newRemaining = Math.max(0, excessCharge.remaining_amount - amount);
        await supabase.from("ledger_entries").update({ remaining_amount: newRemaining }).eq("id", excessCharge.id);

        return jsonResponse({
          success: true,
          method: "hold_capture",
          deductedAmount: amount,
          excessMileageRemaining: newRemaining,
          depositAvailableAfter: (rental.deposit_hold_amount || 0) - amount,
        });
      } catch (captureErr: any) {
        console.error("[DEDUCT-DEPOSIT] Hold capture failed:", captureErr.message);
        return errorResponse(`Failed to capture from deposit hold: ${captureErr.message}`);
      }
    }

    // Fallback: Find the payment with a Stripe payment intent for this rental (legacy flow — deposit was charged)
    const { data: payment } = await supabase
      .from("payments")
      .select("*")
      .eq("rental_id", rentalId)
      .not("stripe_payment_intent_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let stripeRefundId: string | null = null;

    if (payment?.stripe_payment_intent_id) {
      try {
        // Refund on the platform the PAYMENT was created on (may differ from the rental's).
        const { client: paymentStripe, options: paymentStripeOptions } = resolveForRecord(payment);
        const paymentIntent = await paymentStripe.paymentIntents.retrieve(payment.stripe_payment_intent_id, paymentStripeOptions);

        if (paymentIntent.status === "succeeded") {
          const refund = await paymentStripe.refunds.create(
            {
              payment_intent: payment.stripe_payment_intent_id,
              amount: Math.round(amount * 100),
              reason: "requested_by_customer",
              metadata: {
                category: "Security Deposit",
                rental_id: rentalId,
                refund_reason: "Deducted for excess mileage charge",
              },
            },
            paymentStripeOptions
          );
          stripeRefundId = refund.id;
          console.log("[DEDUCT-DEPOSIT] Stripe refund created:", refund.id);

          // Update payment record with refund info
          const currentRefundAmount = payment.refund_amount || 0;
          const newTotalRefund = currentRefundAmount + amount;
          await supabase
            .from("payments")
            .update({
              refund_amount: newTotalRefund,
              refund_reason: payment.refund_reason
                ? `${payment.refund_reason}; Security Deposit: Deducted for excess mileage`
                : "Security Deposit: Deducted for excess mileage",
              status: newTotalRefund >= payment.amount ? "Refunded" : "Partial Refund",
              capture_status: newTotalRefund >= payment.amount ? "refunded" : "partial_refund",
              stripe_refund_id: payment.stripe_refund_id
                ? `${payment.stripe_refund_id},${stripeRefundId}`
                : stripeRefundId,
              refund_processed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", payment.id);
        } else {
          console.log("[DEDUCT-DEPOSIT] Payment intent not refundable, recording as manual:", paymentIntent.status);
        }
      } catch (stripeError: any) {
        console.error("[DEDUCT-DEPOSIT] Stripe refund error:", stripeError.message);
        return errorResponse(`Stripe refund failed: ${stripeError.message}`);
      }
    } else {
      console.log("[DEDUCT-DEPOSIT] No Stripe payment found, recording as manual deduction");
    }

    const today = new Date().toISOString().split("T")[0];

    // Create a Refund ledger entry for the Security Deposit (reduces deposit)
    await supabase.from("ledger_entries").insert({
      rental_id: rentalId,
      customer_id: rental.customer_id,
      vehicle_id: rental.vehicle_id,
      tenant_id: effectiveTenantId,
      entry_date: today,
      due_date: today,
      type: "Refund",
      category: "Security Deposit",
      amount: -Math.abs(amount),
      remaining_amount: 0,
      reference: `Deposit deducted for excess mileage${stripeRefundId ? ` (Stripe: ${stripeRefundId})` : ""}`,
    });

    // Update the excess mileage charge's remaining_amount
    const newRemaining = Math.max(0, excessCharge.remaining_amount - amount);
    await supabase
      .from("ledger_entries")
      .update({ remaining_amount: newRemaining })
      .eq("id", excessCharge.id);

    console.log("[DEDUCT-DEPOSIT] Excess mileage charge remaining updated:", excessCharge.remaining_amount, "->", newRemaining);

    return jsonResponse({
      success: true,
      deductedAmount: amount,
      excessMileageRemaining: newRemaining,
      depositAvailableAfter: availableDeposit - amount,
      stripeRefundId,
    });
  } catch (error: any) {
    console.error("[DEDUCT-DEPOSIT] Error:", error);
    return errorResponse(error.message, 500);
  }
});
