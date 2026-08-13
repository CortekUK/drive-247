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
import { getConnectAccountId, getStripeClientForRecord, resolveHoldExpiryDetailed, createDepositHoldIntentWithFallback, type StripeMode } from "../_shared/stripe-client.ts";
import { authorizeDepositHoldRequest } from "../_shared/deposit-hold-auth.ts";

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

    // ── Auth ────────────────────────────────────────────────────────────────
    // This function CAPTURES MONEY off a card authorisation and writes a payment
    // + ledger charge for it. It previously read no Authorization header at all,
    // so the gateway's `verify_jwt = true` default was the only check — and that
    // default is satisfied by the PUBLIC ANON KEY shipped in the booking app's
    // JavaScript bundle. Any session on the project, including a booking-site
    // renter of another tenant, could POST a rentalId and take that tenant's
    // deposit.
    //
    // Runs BEFORE the rental fetch and before every Stripe call, so a refusal
    // costs nothing and leaks nothing. The guard resolves the rental itself in
    // order to compare tenants. Every caller in the repo is portal staff
    // (components/shared/dialogs/charge-deposit-dialog.tsx — the "Charge"
    // button); there is no webhook or cron caller to break.
    const auth = await authorizeDepositHoldRequest(req, supabase, {
      rentalId,
      logPrefix: "[DEPOSIT-CAPTURE]",
    });
    if (!auth.ok) return errorResponse(auth.message, auth.status);

    // `tenantId` from the body is a convenience hint only — it is used below
    // solely to look up Stripe config, and the guard above has already proved
    // the caller may act on THIS rental. Never let it stand in for the rental's
    // own tenant.
    if (tenantId && auth.rental.tenant_id && tenantId !== auth.rental.tenant_id) {
      return errorResponse("Not authorised for this rental", 403);
    }

    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(
        "deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_amount, deposit_hold_payment_method_id, deposit_hold_stripe_customer_id, tenant_id, customer_id, vehicle_id, auto_extend_enabled, platform_account, " +
          "deposit_hold_stripe_mode, deposit_hold_connect_account_id, deposit_hold_platform_account"
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

    // Capture against the HOLD'S OWN ANCHORS. Reading `tenant.stripe_mode` here
    // meant a tenant who flipped test->live (or migrated UK->UAE) mid-rental
    // would have us capture on an account the authorization never existed on:
    // the capture fails, the operator is told the money could not be taken, and
    // the real hold keeps sitting on the other account until it lapses.
    const anchoredMode =
      rental.deposit_hold_stripe_mode === "live" || rental.deposit_hold_stripe_mode === "test"
        ? (rental.deposit_hold_stripe_mode as StripeMode)
        : null;
    const anchoredPlatform =
      rental.deposit_hold_platform_account === "uk" || rental.deposit_hold_platform_account === "uae"
        ? rental.deposit_hold_platform_account
        : null;

    const stripeMode: StripeMode = anchoredMode ?? ((tenant?.stripe_mode as StripeMode) || "test");
    const platformAccount = anchoredPlatform ?? (rental.platform_account === "uae" ? "uae" : "uk");

    const stripe = getStripeClientForRecord({ platform_account: platformAccount }, stripeMode);
    const connectAccountId =
      rental.deposit_hold_connect_account_id ||
      (tenant
        ? getConnectAccountId({
            // Anchored mode, not tenant.stripe_mode: getConnectAccountId
            // branches on mode, so passing today's value would select the
            // account for the wrong mode while the client uses the hold's keys.
            ...tenant,
            stripe_mode: stripeMode,
            payment_model: platformAccount === "uae" ? "own" : "managed",
          })
        : null);
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
      // CAS: only condemn the PI we actually probed. Without this, a capture
      // racing the refresh engine could stamp `expired` over a freshly placed
      // replacement authorization that is perfectly alive.
      await supabase
        .from("rentals")
        .update({ deposit_hold_status: "expired" })
        .eq("id", rentalId)
        .eq("deposit_hold_payment_intent_id", rental.deposit_hold_payment_intent_id);
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
    // Full provenance for the rollover, so the row never claims Stripe told us a
    // deadline it did not.
    let newHoldExpiry: Awaited<ReturnType<typeof resolveHoldExpiryDetailed>> | null = null;
    // Belt-and-braces: never RE-HOLD the remainder on an AUTO-EXTEND rental
    // (renewal pricing replaces the deposit). The operator's capture above still
    // completes — we just don't spin up a fresh hold for the remainder.
    // Manually-extended rentals are allowed again (GMT incident, Jul 2026): a
    // rollover after a staff-initiated partial capture is a one-time, deliberate
    // operation, not the RevTek/Fabri auto-retry loop.
    const isLongRunning = (rental as any).auto_extend_enabled === true;
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
          // resolveHoldExpiryDetailed, not the back-compat resolveHoldExpiry
          // wrapper. The wrapper's fallback branch fabricates now + 4 days and
          // throws away source/extendedAuth/windowSeconds — so the rollover
          // inherited the PREVIOUS link's provenance label, typically
          // 'stripe_capture_before', attached to a timestamp we invented. Every
          // sibling writer avoids exactly this; deduct-from-deposit does the
          // same rollover correctly and is the pattern copied here.
          //
          // It matters more once extended authorization is on: a 4-day
          // fabricated expiry on a hold Stripe is actually holding for ~30 days
          // makes the driver re-authorise roughly seven times more often than
          // needed, which is the precise cost the feature exists to remove.
          newHoldExpiry = await resolveHoldExpiryDetailed(stripe, newHold, stripeOptions);
          newHoldExpiresAt = newHoldExpiry?.expiresAt ?? null;
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
        // MUST be the platform we actually captured on (`platformAccount`), not
        // rentals.platform_account. Those two deliberately diverge during a
        // UK<->UAE migration — sync-deposit-hold refuses to move
        // rentals.platform_account once payments are anchored to the old value
        // and logs "PLATFORM DIVERGENCE". process-refund resolves its Stripe
        // keys and connected account from THIS row, so stamping the rental's
        // value would send a later refund of this captured deposit to the
        // account the charge does not exist on, and the money could not be
        // returned.
        platform_account: platformAccount,
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

    // Finance Sync — enqueue deposit_capture for the accounting layer.
    // Only on capture (preauth release is a no-op per spec §8.1). Non-fatal.
    if (chargeRow && effectiveTenantId) {
      try {
        const { data: tenantRow } = await supabase
          .from("tenants")
          .select("currency_code")
          .eq("id", effectiveTenantId)
          .maybeSingle();
        await supabase.rpc("enqueue_financial_event", {
          p_tenant_id: effectiveTenantId,
          p_event_type: "deposit_capture",
          p_amount_cents: Math.round(Number(amount) * 100),
          p_currency: (tenantRow?.currency_code as string) ?? "USD",
          p_rental_id: rentalId,
          p_customer_id: rental.customer_id ?? null,
          p_vehicle_id: rental.vehicle_id ?? null,
          p_source_table: "ledger_entries",
          p_source_id: chargeRow.id,
          p_description: reason || "Deposit captured",
        });
      } catch (err) {
        console.error("[finance-sync] enqueue deposit_capture failed (non-fatal):", err);
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
      // Provenance MUST move with the expiry. Without these three the row kept
      // the previous link's labels — usually 'stripe_capture_before' — bolted
      // onto whatever this rollover produced, so a fabricated fallback deadline
      // read as one Stripe had published. Nothing downstream can tell a real
      // deadline from an invented one except this column.
      rentalUpdate.deposit_hold_expiry_source = newHoldExpiry?.source ?? null;
      rentalUpdate.deposit_hold_extended_auth = newHoldExpiry?.extendedAuth ?? null;
      rentalUpdate.deposit_hold_window_seconds = newHoldExpiry?.windowSeconds ?? null;
      // Anchor the replacement to the account/mode it was actually created on.
      rentalUpdate.deposit_hold_connect_account_id = connectAccountId;
      rentalUpdate.deposit_hold_stripe_mode = stripeMode;
      rentalUpdate.deposit_hold_platform_account = platformAccount;
    } else {
      rentalUpdate.deposit_hold_status = "captured";
      rentalUpdate.deposit_hold_amount = 0;
    }
    // Compare-and-set on the PaymentIntent we captured. If the refresh engine
    // swapped in a replacement while this capture was in flight, writing
    // unconditionally would stamp `captured` over a LIVE replacement
    // authorization and strand the renter's funds behind a terminal status.
    const { data: capturedRows, error: updateError } = await supabase
      .from("rentals")
      .update(rentalUpdate)
      .eq("id", rentalId)
      .eq("deposit_hold_payment_intent_id", rental.deposit_hold_payment_intent_id)
      .select("id");
    if (updateError) {
      console.error("[DEPOSIT-CAPTURE] Failed to update rental:", updateError);
    } else if (!capturedRows || capturedRows.length === 0) {
      // Money HAS moved — never report this as a failure — but a DIFFERENT
      // authorization now owns the row.
      //
      // Deliberately do NOT write here. The only way to reach this branch is
      // that the refresh engine landed a replacement at 'held' with a live PI,
      // and stamping anything over it (including 'needs_review') would take that
      // live hold out of the refresh driver's selection — it re-selects only
      // 'held' and 'failed' — so the replacement would stop being renewed and
      // lapse. The capture itself is durably recorded in `payments` above, and
      // the 6-hourly reconciler settles the rest. Loud log, no clobber.
      console.error(
        "[DEPOSIT-CAPTURE] Captured, but a newer authorization now owns the row — leaving it untouched.",
        {
          rentalId,
          capturedPi: rental.deposit_hold_payment_intent_id,
          capturedInCents,
          // The rollover id MUST be in this payload. It is written nowhere else:
          // the only persistence for it is `rentalUpdate`, which is the very
          // write the CAS just rejected, and capture writes no ledger row. Left
          // out, the id existed solely in memory and died with the request.
          orphanedRolloverPi: newHoldPiId ?? null,
        }
      );

      // Cancel the rollover we just minted, if any.
      //
      // It was authorised on the assumption that THIS row's hold was still the
      // incumbent. It isn't — a newer authorization owns the row — so the
      // rollover secures nothing and is not reachable from any record: the
      // rental points elsewhere, no ledger row names it, and the orphan sweep
      // cannot see it either (findLiveDepositIntent matches
      // metadata.type === 'deposit_hold', while rollovers are minted as
      // 'deposit_hold_rollover'). Without this it would sit on the renter's card
      // holding real money until the network lapsed it days later, invisible to
      // every screen and every alert.
      //
      // Cancelling is the conservative move: it touches ONLY the intent this
      // request created moments ago and leaves the live replacement alone.
      if (newHoldPiId) {
        try {
          await stripe.paymentIntents.cancel(newHoldPiId, stripeOptions);
          console.warn("[DEPOSIT-CAPTURE] Cancelled orphaned rollover", newHoldPiId);
        } catch (cancelErr) {
          // Non-fatal: the capture succeeded and must still be reported as such.
          // The id is already in the error log above for manual cleanup.
          console.error(
            "[DEPOSIT-CAPTURE] Could not cancel orphaned rollover",
            newHoldPiId,
            cancelErr
          );
        }
      }
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
