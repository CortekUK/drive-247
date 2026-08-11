// Release a deposit hold — cancels the Stripe PaymentIntent to free the held funds
// Called at key handover (receiving) or manually by admin

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getConnectAccountId, getStripeClientForRecord, type StripeMode } from "../_shared/stripe-client.ts";
import { authorizeDepositHoldRequest } from "../_shared/deposit-hold-auth.ts";

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

    // ── Auth ────────────────────────────────────────────────────────────────
    // Releasing CANCELS a live card authorisation — it hands the customer their
    // security deposit back. This function read no Authorization header at all,
    // so the only check was the gateway's `verify_jwt = true` default, which the
    // PUBLIC ANON KEY in the booking bundle satisfies. A renter who knew their
    // own rental UUID could drop their own deposit on the way out of the car;
    // any session on the project could do it to any tenant's rental.
    //
    // Deliberately NOT opened to the rental's customer (`allowRentalCustomer` is
    // off): releasing is an operator decision taken at key handover, never a
    // self-service one. Every caller in the repo is portal staff — the rental
    // page's manual release and hooks/use-key-handover.ts (receiving the keys).
    // No webhook, cron or edge function invokes this.
    const auth = await authorizeDepositHoldRequest(req, supabase, {
      rentalId,
      logPrefix: "[DEPOSIT-RELEASE]",
    });
    if (!auth.ok) return errorResponse(auth.message, auth.status);

    // Body `tenantId` only selects Stripe config below; it can never widen what
    // the guard above just decided.
    if (tenantId && auth.rental.tenant_id && tenantId !== auth.rental.tenant_id) {
      return errorResponse("Not authorised for this rental", 403);
    }

    console.log("[DEPOSIT-RELEASE] Releasing hold for rental:", rentalId);

    // Fetch rental deposit hold info
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(
        "deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_amount, tenant_id, platform_account, " +
          "deposit_hold_stripe_mode, deposit_hold_connect_account_id, deposit_hold_platform_account"
      )
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
      .select("stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id")
      .eq("id", effectiveTenantId)
      .single();

    // Resolve Stripe from the HOLD'S OWN ANCHORS, not the tenant's current row.
    //
    // This function used to read `tenant.stripe_mode` and today's payment_model.
    // A tenant who flips test->live, or migrates UK->UAE, mid-rental would send
    // us looking for the authorization on an account it was never created on.
    // Stripe answers `resource_missing`, which the catch below reads as "there
    // is no live hold" — so we wrote `released` while the renter's money was
    // still frozen on the OTHER account, and `released` is terminal, so every
    // reconciler sweep then skipped the row forever.
    //
    // The anchors are written at placement (place-deposit-hold) and re-stamped
    // on every refresh, so they are authoritative. Fall back to the old
    // derivation only when they are NULL (holds placed before the anchor
    // columns existed).
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
    // A pinned connected-account id beats re-deriving one from mutable tenant
    // columns; only fall back to derivation when the hold predates the anchor.
    // The fallback is fed the ANCHORED mode, not tenant.stripe_mode, because
    // getConnectAccountId branches on mode and would otherwise pick the account
    // for the tenant's mode-of-today against keys for the hold's mode.
    const connectAccountId =
      rental.deposit_hold_connect_account_id ||
      (tenant
        ? getConnectAccountId({
            ...tenant,
            stripe_mode: stripeMode,
            payment_model: platformAccount === "uae" ? "own" : "managed",
          })
        : null);

    // The ACCOUNT is the dimension that decides whether `resource_missing` is
    // trustworthy, so it belongs in this predicate too. A hold placed while
    // stripe_onboarding_complete was false has a NULL account anchor; once the
    // Connect webhook flips it true mid-hold, the derivation starts returning a
    // real, valid account that the authorization was never created on — Stripe
    // then answers `resource_missing` and, without this term, we would have
    // called that "anchored" and written the terminal 'released'.
    // A derived NULL is indistinguishable from an anchored NULL, so that case
    // stays anchored.
    const accountAnchored = !!rental.deposit_hold_connect_account_id || connectAccountId === null;
    const usedAnchors = anchoredMode !== null && anchoredPlatform !== null && accountAnchored;
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    // Cancel the PaymentIntent to release the hold
    try {
      await stripe.paymentIntents.cancel(
        rental.deposit_hold_payment_intent_id,
        stripeOptions
      );
      console.log("[DEPOSIT-RELEASE] PaymentIntent cancelled:", rental.deposit_hold_payment_intent_id);
    } catch (stripeErr: any) {
      // Treat "nothing left to cancel" as success and self-heal the DB:
      //  - payment_intent_unexpected_state: already cancelled or captured
      //  - resource_missing: the PI no longer exists on the Stripe account we
      //    currently target (orphaned hold — e.g. placed before a Connect
      //    account / customer was re-created, or a manual-capture auth that
      //    Stripe already auto-expired after ~7 days). Either way there is no
      //    live hold on the card, so we still mark the rental released below
      //    instead of throwing a 500 the way the old code did.
      if (stripeErr.code === "payment_intent_unexpected_state") {
        // The PI exists on the account we asked, it is simply not cancellable
        // (already cancelled or captured). Nothing is frozen. Self-heal.
        console.warn(
          "[DEPOSIT-RELEASE] No live hold to cancel (",
          stripeErr.code,
          "):",
          stripeErr.message
        );
      } else if (stripeErr.code === "resource_missing") {
        // "Not on THIS account" is only evidence the money is free if we were
        // certain which account to ask. With anchors we were; without them we
        // derived the account from mutable tenant columns and a mid-rental mode
        // or platform switch would land us here with the hold still LIVE
        // somewhere else. Refusing to write the terminal `released` keeps the
        // row inside the reconciler sweeps instead of orphaning the funds.
        if (!usedAnchors) {
          console.error(
            "[DEPOSIT-RELEASE] resource_missing on a NON-ANCHORED lookup — cannot prove the hold is free.",
            { rentalId, stripeMode, platformAccount, connectAccountId }
          );
          // Carry the REASON, not just the status. The admin health console and
          // the tenant payments triage table render an error cell from
          // deposit_hold_last_error and sort by deposit_hold_status_changed_at
          // (DESC, nulls last) — a bare status write shows a blank reason and
          // sinks to the bottom of the very list used to triage it. There is no
          // trigger on deposit_hold_status_changed_at; every standalone function
          // stamps it by hand.
          await supabase
            .from("rentals")
            .update({
              deposit_hold_status: "needs_review",
              deposit_hold_last_error_code: "resource_missing_unanchored",
              deposit_hold_last_error:
                `Stripe reported resource_missing for ${rental.deposit_hold_payment_intent_id} on ` +
                `${platformAccount}/${stripeMode}${connectAccountId ? ` (${connectAccountId})` : ""}, ` +
                `but this hold carries no platform anchor, so we cannot prove the authorization is not still live ` +
                `on another account. Check Stripe before releasing.`,
              deposit_hold_status_changed_at: new Date().toISOString(),
            })
            .eq("id", rentalId)
            .eq("deposit_hold_payment_intent_id", rental.deposit_hold_payment_intent_id);

          return errorResponse(
            "Could not confirm the hold was released. It has been flagged for review so the funds are not lost — please check Stripe before retrying.",
            409
          );
        }
        console.warn(
          "[DEPOSIT-RELEASE] No live hold to cancel (anchored lookup, resource_missing):",
          stripeErr.message
        );
      } else {
        throw stripeErr;
      }
    }

    // Update rental.
    //
    // Compare-and-set on the PaymentIntent we actually cancelled. The refresh
    // engine may have swapped in a replacement authorization while this request
    // was in flight; a bare .eq("id") would stamp `released` over that live
    // replacement and strand it.
    const { data: updatedRows, error: updateError } = await supabase
      .from("rentals")
      .update({ deposit_hold_status: "released" })
      .eq("id", rentalId)
      .eq("deposit_hold_payment_intent_id", rental.deposit_hold_payment_intent_id)
      .select("id");

    if (updateError) {
      console.error("[DEPOSIT-RELEASE] Failed to update rental:", updateError);
      return errorResponse("Failed to update deposit hold status", 500);
    }

    if (!updatedRows || updatedRows.length === 0) {
      // The hold moved under us — we cancelled the old authorization, but a
      // newer one now owns the row. Leave it alone; the reconciler will settle it.
      console.warn(
        "[DEPOSIT-RELEASE] Hold changed during release; not overwriting newer state.",
        { rentalId, cancelled: rental.deposit_hold_payment_intent_id }
      );
      return jsonResponse({
        success: true,
        superseded: true,
        message: "The hold was updated while releasing. The previous authorization was cancelled.",
      });
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
