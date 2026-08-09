// Deduct an amount from the security deposit to cover an excess mileage charge
// Processes a partial Stripe refund of the deposit, then applies that amount to the excess mileage charge
//
// STRIPE QUIRK THAT USED TO EAT THE REST OF THE DEPOSIT: a partial capture of a
// PaymentIntent automatically RELEASES the uncaptured remainder, and you cannot
// capture the difference later. This function used to fire a bare
// paymentIntents.capture({ amount_to_capture }) and then write
// deposit_hold_status='captured' with the hold amount untouched — so deducting
// $200 of a $1,500 hold on day 20 of a 90-day rental silently released $1,300
// while the rental row kept claiming $1,500 was ringfenced for the other 70
// days. capture-deposit-hold already solved this; the same rollover is applied
// here: prefer multicapture on the same PI, else re-authorise the remainder on
// the saved card, and either way write the reduced amount back.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getConnectAccountId,
  getStripeClientForRecord,
  createDepositHoldIntentWithFallback,
  resolveHoldExpiryDetailed,
  type StripeMode,
} from "../_shared/stripe-client.ts";
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
      .select("id, customer_id, vehicle_id, tenant_id, deposit_hold_status, deposit_hold_payment_intent_id, deposit_hold_amount, deposit_hold_payment_method_id, deposit_hold_stripe_customer_id, deposit_hold_connect_account_id, deposit_hold_stripe_mode, auto_extend_enabled, platform_account")
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
    const resolveForRecord = (record: { platform_account?: string | null }, modeOverride?: StripeMode) => {
      const client = getStripeClientForRecord(record, modeOverride ?? stripeMode);
      const connectAccountId = tenantData
        ? getConnectAccountId({
            ...tenantData,
            payment_model: record.platform_account === "uae" ? "own" : "managed",
          })
        : null;
      return {
        client,
        connectAccountId,
        options: connectAccountId ? { stripeAccount: connectAccountId } : undefined,
      };
    };

    // The HOLD carries its own anchor (written when it was placed). Prefer it
    // over anything re-derived from the tenant row, which may have moved since:
    // a mode or Connect-account flip mid-rental would otherwise send this
    // capture at an account that has never heard of the PaymentIntent.
    const holdMode: StripeMode =
      rental.deposit_hold_stripe_mode === "test" || rental.deposit_hold_stripe_mode === "live"
        ? (rental.deposit_hold_stripe_mode as StripeMode)
        : stripeMode;
    const holdResolved = resolveForRecord(rental, holdMode);
    const stripe = holdResolved.client;
    const holdConnectAccountId =
      (rental.deposit_hold_connect_account_id as string | null) || holdResolved.connectAccountId;
    const stripeOptions = holdConnectAccountId ? { stripeAccount: holdConnectAccountId } : undefined;

    // If there's an active deposit hold, capture from it instead of refunding
    if (rental.deposit_hold_status === 'held' && rental.deposit_hold_payment_intent_id) {
      if (amount > (rental.deposit_hold_amount || 0)) {
        return errorResponse(`Deduction amount (${amount}) exceeds hold amount (${rental.deposit_hold_amount})`);
      }

      const originalHold = Number(rental.deposit_hold_amount) || 0;
      const amountInCents = Math.round(amount * 100);
      const remainder = Math.max(0, originalHold - amount);

      try {
        // 1. Read the PI before touching it. Two jobs: prove the authorisation
        //    is still alive (the DB says 'held' but nothing ever revisits that
        //    column, so it routinely outlives the auth), and find out whether
        //    it was authorised with multicapture available.
        const preCaptureIntent = await stripe.paymentIntents.retrieve(
          rental.deposit_hold_payment_intent_id,
          stripeOptions
        );

        if (preCaptureIntent.status !== "requires_capture") {
          console.warn(
            "[DEDUCT-DEPOSIT] Hold no longer capturable. PI",
            preCaptureIntent.id,
            "status:",
            preCaptureIntent.status
          );
          // Reconcile the row to the truth so the portal stops advertising a
          // hold that Stripe already released, then refuse. Failing closed:
          // falling through to the refund path below would try to claw money
          // back from an unrelated captured payment.
          await supabase
            .from("rentals")
            .update({
              deposit_hold_status: "expired",
              deposit_hold_status_changed_at: new Date().toISOString(),
              deposit_hold_amount: 0,
            })
            .eq("id", rentalId)
            .eq("deposit_hold_payment_intent_id", rental.deposit_hold_payment_intent_id);
          return errorResponse(
            "This deposit hold is no longer active at Stripe (the authorisation expired and the funds were released). Place a fresh hold, then deduct from it.",
            409
          );
        }

        const holdCurrency = String(preCaptureIntent.currency || currencyCode || "usd").toLowerCase();
        const multicaptureStatus = (preCaptureIntent as any)?.payment_method_options?.card?.multicapture;
        const multicaptureAvailable = multicaptureStatus === "available";
        console.log(
          "[DEDUCT-DEPOSIT] PI", preCaptureIntent.id,
          "multicapture:", multicaptureStatus ?? "n/a",
          "hold:", originalHold, "deduct:", amount, "remainder:", remainder
        );

        // 2. Capture the requested amount.
        //    Multicapture path keeps the remainder authorised on the SAME PI
        //    (final_capture: false). Everything else is a plain partial capture,
        //    which Stripe follows by releasing the remainder — handled at step 3.
        let capturedIntent;
        let usedMulticapture = false;
        if (multicaptureAvailable && remainder > 0) {
          try {
            capturedIntent = await stripe.paymentIntents.capture(
              rental.deposit_hold_payment_intent_id,
              { amount_to_capture: amountInCents, final_capture: false },
              stripeOptions
            );
            usedMulticapture = true;
            console.log("[DEDUCT-DEPOSIT] Multicapture: captured", amount, "kept", remainder, "held on PI", capturedIntent.id);
          } catch (mcErr) {
            console.warn("[DEDUCT-DEPOSIT] Multicapture capture failed, falling back to rollover:", mcErr);
            capturedIntent = await stripe.paymentIntents.capture(
              rental.deposit_hold_payment_intent_id,
              { amount_to_capture: amountInCents },
              stripeOptions
            );
          }
        } else {
          capturedIntent = await stripe.paymentIntents.capture(
            rental.deposit_hold_payment_intent_id,
            { amount_to_capture: amountInCents },
            stripeOptions
          );
          console.log("[DEDUCT-DEPOSIT] Single-capture: captured", amount, "on PI", capturedIntent.id);
        }

        // 3. Keep the remainder held. Without this the other 70 days of a
        //    90-day rental run uncovered while the row says otherwise.
        //    Skipped for auto-extend rentals, which never carry a deposit
        //    (renewal pricing replaces it) — matching capture-deposit-hold.
        let newHoldPiId: string | null = null;
        let newHoldExpiry: Awaited<ReturnType<typeof resolveHoldExpiryDetailed>> | null = null;
        const isAutoExtend = (rental as any).auto_extend_enabled === true;
        if (
          !usedMulticapture &&
          remainder > 0 &&
          !isAutoExtend &&
          rental.deposit_hold_payment_method_id &&
          rental.deposit_hold_stripe_customer_id
        ) {
          try {
            const newHold = await createDepositHoldIntentWithFallback(
              stripe,
              {
                amount: Math.round(remainder * 100),
                currency: holdCurrency,
                customer: rental.deposit_hold_stripe_customer_id,
                payment_method: rental.deposit_hold_payment_method_id,
                capture_method: "manual",
                confirm: true,
                off_session: true,
                description: `Security deposit hold (rollover after excess-mileage deduction) for rental ${String(rentalId).substring(0, 8).toUpperCase()}`,
                expand: ["latest_charge"],
                metadata: {
                  rental_id: rentalId,
                  tenant_id: effectiveTenantId,
                  type: "deposit_hold_rollover",
                  previous_hold_pi: rental.deposit_hold_payment_intent_id,
                },
              },
              {
                ...(stripeOptions ?? {}),
                idempotencyKey: `deposit-deduct-rollover-${rentalId}-${rental.deposit_hold_payment_intent_id}`,
              }
            );
            if (newHold.status === "requires_capture") {
              newHoldPiId = newHold.id;
              newHoldExpiry = await resolveHoldExpiryDetailed(stripe, newHold, stripeOptions);
              console.log("[DEDUCT-DEPOSIT] Rolled remainder", remainder, "into new hold", newHoldPiId);
            } else {
              console.warn("[DEDUCT-DEPOSIT] Rollover hold landed in unexpected status", newHold.status);
            }
          } catch (rolloverErr) {
            // Non-fatal: the deduction itself succeeded. The remainder is
            // genuinely gone, and the row below records that honestly rather
            // than claiming coverage that no longer exists.
            console.error("[DEDUCT-DEPOSIT] Rollover hold failed; remainder released:", rolloverErr);
          }
        } else if (!usedMulticapture && remainder > 0) {
          console.warn(
            `[DEDUCT-DEPOSIT] Remainder ${remainder} released by Stripe and NOT re-held on rental ${rentalId} ` +
              `(autoExtend=${isAutoExtend}, pm=${rental.deposit_hold_payment_method_id ? "yes" : "no"}, ` +
              `customer=${rental.deposit_hold_stripe_customer_id ? "yes" : "no"})`
          );
        }

        // 4. Write the hold state back. The old code wrote 'captured' with the
        //    hold amount untouched in every case, which is the leak.
        const nowIso = new Date().toISOString();
        const rentalUpdate: Record<string, unknown> = { deposit_hold_status_changed_at: nowIso };
        if (usedMulticapture) {
          rentalUpdate.deposit_hold_status = "held";
          rentalUpdate.deposit_hold_amount = remainder;
          // Same PI, same placed_at, same expires_at — nothing else moved.
        } else if (newHoldPiId) {
          rentalUpdate.deposit_hold_status = "held";
          rentalUpdate.deposit_hold_payment_intent_id = newHoldPiId;
          rentalUpdate.deposit_hold_amount = remainder;
          rentalUpdate.deposit_hold_placed_at = nowIso;
          rentalUpdate.deposit_hold_expires_at = newHoldExpiry?.expiresAt ?? null;
          rentalUpdate.deposit_hold_expiry_source = newHoldExpiry?.source ?? null;
          rentalUpdate.deposit_hold_extended_auth = newHoldExpiry?.extendedAuth ?? null;
          rentalUpdate.deposit_hold_window_seconds = newHoldExpiry?.windowSeconds ?? null;
          // Anchor the replacement to where it actually lives.
          rentalUpdate.deposit_hold_connect_account_id = holdConnectAccountId;
          rentalUpdate.deposit_hold_stripe_mode = holdMode;
          rentalUpdate.deposit_hold_currency = holdCurrency;
        } else {
          rentalUpdate.deposit_hold_status = "captured";
          rentalUpdate.deposit_hold_amount = 0;
        }
        const { error: rentalUpdateError } = await supabase
          .from("rentals")
          .update(rentalUpdate)
          .eq("id", rentalId);
        if (rentalUpdateError) {
          // Loud: the money moved at Stripe but the row may still claim the old
          // hold. Surfacing this is what makes the mismatch findable.
          console.error("[DEDUCT-DEPOSIT] Failed to update rental deposit hold state:", rentalUpdateError);
        }

        // 5. Ledger: unchanged behaviour — record the captured amount against
        //    the excess mileage charge.
        const today = new Date().toISOString().split("T")[0];

        await supabase.from("ledger_entries").insert({
          rental_id: rentalId, customer_id: rental.customer_id, vehicle_id: rental.vehicle_id,
          tenant_id: effectiveTenantId, entry_date: today, due_date: today,
          type: "Payment", category: "Security Deposit", amount: amount, remaining_amount: 0,
          reference: `Deposit captured for excess mileage`,
        });

        const newRemaining = Math.max(0, excessCharge.remaining_amount - amount);
        await supabase.from("ledger_entries").update({ remaining_amount: newRemaining }).eq("id", excessCharge.id);

        const remainingHeld = usedMulticapture || newHoldPiId ? remainder : 0;
        return jsonResponse({
          success: true,
          method: "hold_capture",
          deductedAmount: amount,
          excessMileageRemaining: newRemaining,
          holdAmount: originalHold,
          // What is ACTUALLY still authorised. Previously this reported
          // originalHold - amount unconditionally, which was a fiction whenever
          // Stripe had released the remainder.
          remainingHeldAmount: remainingHeld,
          depositAvailableAfter: remainingHeld,
          newHoldPiId,
          usedMulticapture,
          remainderReleased: !usedMulticapture && !newHoldPiId && remainder > 0,
        });
      } catch (captureErr: any) {
        console.error("[DEDUCT-DEPOSIT] Hold capture failed:", captureErr?.message ?? captureErr);
        return errorResponse(`Failed to capture from deposit hold: ${captureErr?.message ?? captureErr}`);
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
