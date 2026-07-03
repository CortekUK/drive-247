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
import { getConnectAccountId, getStripeClientForRecord, resolveHoldExpiry, createDepositHoldIntentWithFallback, type StripeMode } from "../_shared/stripe-client.ts";

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
        "deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_amount, deposit_hold_payment_method_id, deposit_hold_stripe_customer_id, tenant_id, customer_id, vehicle_id, auto_extend_enabled, platform_account"
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
      .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id, currency_code")
      .eq("id", effectiveTenantId)
      .single();

    const stripeMode: StripeMode = (tenant?.stripe_mode as StripeMode) || "test";
    // The hold lives on the platform account it was CREATED on
    // (rentals.platform_account) — capture with those keys + that platform's
    // connected account, even if the tenant has since flipped payment model.
    const stripe = getStripeClientForRecord(rental, stripeMode);
    const connectAccountId = tenant
      ? getConnectAccountId({
          ...tenant,
          payment_model: rental.platform_account === "uae" ? "own" : "managed",
        })
      : null;
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    const capturedInCents = Math.round(amount * 100);
    const remainder = Math.max(0, originalHold - amount);
    const currency = (tenant?.currency_code || "usd").toLowerCase();

    // 1. Detect whether the PI was authorised with multicapture available. If
    //    it was, we can capture partial amounts on the SAME PI without losing
    //    the remainder (no rollover-PI needed). New holds (placed after the
    //    multicapture rollout) qualify; older holds fall back to rollover.
    const preCaptureIntent = await stripe.paymentIntents.retrieve(
      rental.deposit_hold_payment_intent_id,
      stripeOptions
    );

    // SELF-HEAL: the DB said "held", but the auth may have expired (Stripe
    // auto-cancels card holds after ~7 days). Capturing a dead PI throws and
    // surfaces to the operator as a useless "Edge Function returned a non-2xx
    // status code". Detect it, reconcile the DB to the truth, and return an
    // honest, actionable message instead.
    if (preCaptureIntent.status !== "requires_capture") {
      console.warn(
        "[DEPOSIT-CAPTURE] Hold no longer capturable. PI",
        preCaptureIntent.id,
        "status:",
        preCaptureIntent.status
      );
      await supabase
        .from("rentals")
        .update({ deposit_hold_status: "expired" })
        .eq("id", rentalId);
      // Structured signal (HTTP 200 so supabase-js doesn't swallow the body):
      // the UI uses this to switch to the two-step "Refresh hold → Charge" flow
      // instead of showing a raw error. The expired auth is dead and can't be
      // captured — a fresh hold must be placed first.
      return jsonResponse(
        {
          success: false,
          code: "hold_expired",
          error:
            "This deposit hold expired (Stripe card holds last ~7 days) and the funds were released back to the customer. Refresh the hold to place a new one, then charge it.",
        },
        200
      );
    }

    const multicaptureStatus = (preCaptureIntent as any)?.payment_method_options?.card?.multicapture;
    const multicaptureAvailable = multicaptureStatus === "available";
    console.log("[DEPOSIT-CAPTURE] PI", preCaptureIntent.id, "multicapture:", multicaptureStatus ?? "n/a");

    // 2. Capture the requested amount.
    //    - Multicapture path: pass final_capture=false when there's a remainder
    //      so Stripe keeps the rest authorised on the same PI. Pass true (or
    //      omit) when this capture consumes the whole hold.
    //    - Single-capture path: a normal partial capture releases the remainder
    //      automatically — we fall back to creating a fresh rollover PI below.
    let capturedIntent;
    let usedMulticapture = false;
    if (multicaptureAvailable && remainder > 0) {
      try {
        capturedIntent = await stripe.paymentIntents.capture(
          rental.deposit_hold_payment_intent_id,
          { amount_to_capture: capturedInCents, final_capture: false },
          stripeOptions
        );
        usedMulticapture = true;
        console.log("[DEPOSIT-CAPTURE] Multicapture: captured", amount, "kept", remainder, "held on PI", capturedIntent.id);
      } catch (mcErr) {
        // If Stripe rejects the multicapture call for any reason (e.g. card
        // network limits), fall through to a normal partial capture + rollover
        // so the operator still gets the requested amount.
        console.warn("[DEPOSIT-CAPTURE] Multicapture capture failed, falling back to rollover:", mcErr);
        capturedIntent = await stripe.paymentIntents.capture(
          rental.deposit_hold_payment_intent_id,
          { amount_to_capture: capturedInCents },
          stripeOptions
        );
      }
    } else {
      capturedIntent = await stripe.paymentIntents.capture(
        rental.deposit_hold_payment_intent_id,
        { amount_to_capture: capturedInCents },
        stripeOptions
      );
      console.log("[DEPOSIT-CAPTURE] Single-capture: captured", amount, "on PI", capturedIntent.id);
    }

    // 3. Decide how to keep the remainder held:
    //    - Multicapture: same PI is still active for `remainder` — no new PI.
    //    - Single-capture with remainder > 0: original PI's uncaptured portion
    //      was released by Stripe, so spin up a fresh manual-capture PI for the
    //      remainder on the saved card.
    let newHoldPiId: string | null = null;
    let newHoldExpiresAt: string | null = null;
    // Belt-and-braces: never RE-HOLD the remainder on a long-running rental
    // (auto-extend or extended). The operator's capture above still completes —
    // we just don't spin up a fresh hold for the uncaptured remainder, keeping the
    // invariant "no deposit hold ever lives on an auto-extend/extended rental".
    let isLongRunning = (rental as any).auto_extend_enabled === true;
    if (!isLongRunning) {
      const { count } = await supabase
        .from("rental_extensions")
        .select("id", { count: "exact", head: true })
        .eq("rental_id", rentalId);
      isLongRunning = (count ?? 0) > 0;
    }
    if (!usedMulticapture && remainder > 0 && !isLongRunning && rental.deposit_hold_payment_method_id && rental.deposit_hold_stripe_customer_id) {
      try {
        // Ask for extended authorization + multicapture on the rollover PI so it
        // lasts as long as the card allows and future captures can stay on this
        // one PI. The shared helper downgrades these features for accounts not
        // approved for them (e.g. GMT) so the rollover never 500s.
        const newHold = await createDepositHoldIntentWithFallback(
          stripe,
          {
            amount: Math.round(remainder * 100),
            currency,
            customer: rental.deposit_hold_stripe_customer_id,
            payment_method: rental.deposit_hold_payment_method_id,
            capture_method: "manual",
            confirm: true,
            off_session: true,
            description: `Security deposit hold (rollover after partial capture) for rental ${rentalId.substring(0, 8).toUpperCase()}`,
            expand: ["latest_charge"],
            metadata: {
              rental_id: rentalId,
              tenant_id: effectiveTenantId,
              type: "deposit_hold_rollover",
              previous_hold_pi: rental.deposit_hold_payment_intent_id,
            },
          },
          { ...(stripeOptions ?? {}), idempotencyKey: `deposit-rollover-${rentalId}-${rental.deposit_hold_payment_intent_id ?? "x"}` }
        );
        if (newHold.status === "requires_capture") {
          newHoldPiId = newHold.id;
          newHoldExpiresAt = await resolveHoldExpiry(stripe, newHold, stripeOptions);
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
        platform_account: rental.platform_account === "uae" ? "uae" : "uk",
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

    // 4. Update rental's deposit hold state. Three cases:
    //    a. Multicapture: same PI is still active for `remainder` — only
    //       decrement deposit_hold_amount, keep status='held' and the same PI id.
    //    b. Single-capture with a successful rollover PI: swap in the new PI id
    //       and set hold amount to remainder.
    //    c. Otherwise (full capture, or single-capture with no rollover): hold
    //       is gone, mark captured and zero the amount.
    const rentalUpdate: Record<string, unknown> = {};
    if (usedMulticapture) {
      rentalUpdate.deposit_hold_status = "held";
      rentalUpdate.deposit_hold_amount = remainder;
      // Same PI, same placed_at, same expires_at — nothing to update there.
    } else if (newHoldPiId) {
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
      remainingHeldAmount: usedMulticapture || newHoldPiId ? remainder : 0,
      newHoldPiId,
      usedMulticapture,
      reason,
    });
  } catch (error: any) {
    console.error("[DEPOSIT-CAPTURE] Error:", error);
    return errorResponse(error.message, 500);
  }
});
