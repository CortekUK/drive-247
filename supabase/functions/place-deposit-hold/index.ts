// Place a deposit hold on customer's saved card at key handover (giving)
// Creates a Stripe PaymentIntent with capture_method: 'manual' (authorize only, no charge)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getStripeClient, getConnectAccountId, resolveHoldExpiry, DEPOSIT_HOLD_CARD_OPTIONS, type StripeMode } from "../_shared/stripe-client.ts";

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

    console.log("[DEPOSIT-HOLD] Placing hold for rental:", rentalId);

    // Fetch rental details
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("customer_id, vehicle_id, tenant_id, deposit_hold_status, deposit_amount_override")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    // Remember the prior state: a re-collection after an expired/released hold
    // needs a fresh Stripe idempotency key so it doesn't get handed back the
    // old (dead) PaymentIntent.
    const priorHoldStatus = rental.deposit_hold_status as string | null;

    // Don't place a hold if one already exists
    if (rental.deposit_hold_status === "held") {
      return jsonResponse({ success: true, alreadyHeld: true, message: "Deposit hold already active" });
    }
    // If another worker is mid-flight, bail out — they'll finish their write.
    // The Stripe idempotency key below also catches the case where this guard
    // is bypassed (e.g. status reset between read and claim).
    if (rental.deposit_hold_status === "processing") {
      return jsonResponse({ success: true, alreadyHeld: true, message: "Deposit hold is being placed by another request" });
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    // Fetch tenant settings (deposit amount, Stripe config)
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("global_deposit_amount, security_deposit_enabled, deposit_mode, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete")
      .eq("id", effectiveTenantId)
      .single();

    if (tenantError || !tenant) {
      return errorResponse("Tenant not found", 404);
    }

    if (!tenant.security_deposit_enabled) {
      return jsonResponse({ success: true, skipped: true, message: "Security deposit is disabled for this tenant" });
    }

    // Per-rental override beats the tenant default. The operator can change
    // the deposit amount on the new-rental Pre-Auth input; that value is
    // stored on rentals.deposit_amount_override. NULL means "use the tenant
    // default" (the original behaviour).
    const overrideAmount = rental.deposit_amount_override !== null && rental.deposit_amount_override !== undefined
      ? Number(rental.deposit_amount_override)
      : null;
    // A numeric override ALWAYS wins — including an explicit 0, which means the
    // operator unchecked the deposit for this rental and wants NO hold. Only fall
    // back to the tenant default when the override is NULL ("not set"). Previously
    // this required `overrideAmount > 0`, so a 0 was treated as "unset" and a $150
    // default hold was placed despite the operator opting out.
    const depositAmount = overrideAmount !== null
      ? overrideAmount
      : (Number(tenant.global_deposit_amount) || 0);
    if (depositAmount <= 0) {
      return jsonResponse({ success: true, skipped: true, message: "Deposit amount is 0" });
    }
    console.log("[DEPOSIT-HOLD] Using amount:", depositAmount, overrideAmount !== null ? "(rental override)" : "(tenant default)");

    // Fetch customer's Stripe customer ID
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("stripe_customer_id, name, email")
      .eq("id", rental.customer_id)
      .single();

    if (customerError || !customer) {
      return errorResponse("Customer not found", 404);
    }

    if (!customer.stripe_customer_id) {
      return errorResponse("Customer has no saved payment method. Card must be saved during booking.", 400);
    }

    // Set up Stripe
    const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || "test";
    const stripe = getStripeClient(stripeMode);
    const connectAccountId = getConnectAccountId(tenant);
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    console.log("[DEPOSIT-HOLD] Stripe mode:", stripeMode, "Connect:", connectAccountId);

    // Get the customer's default payment method
    const stripeCustomer = await stripe.customers.retrieve(
      customer.stripe_customer_id,
      { expand: ["invoice_settings.default_payment_method"] },
      stripeOptions
    );

    if ((stripeCustomer as any).deleted) {
      return errorResponse("Stripe customer has been deleted", 400);
    }

    // Try default payment method, then list all payment methods
    let paymentMethodId = (stripeCustomer as any).invoice_settings?.default_payment_method?.id;

    if (!paymentMethodId) {
      // List payment methods and use the most recent one
      const paymentMethods = await stripe.paymentMethods.list(
        { customer: customer.stripe_customer_id, type: "card", limit: 1 },
        stripeOptions
      );

      if (paymentMethods.data.length === 0) {
        return errorResponse("No payment method found on customer's account", 400);
      }

      paymentMethodId = paymentMethods.data[0].id;
    }

    console.log("[DEPOSIT-HOLD] Using payment method:", paymentMethodId);

    const currencyCode = (tenant.currency_code || "usd").toLowerCase();
    const amountInCents = Math.round(depositAmount * 100);

    // ATOMIC CLAIM: only proceed if we win the race to flip
    // deposit_hold_status from NULL to 'processing'. Without this guard, two
    // concurrent webhook firings (Stripe retries or duplicate endpoints) can
    // both pass the earlier `if (status === 'held') return` check and create
    // two real PaymentIntents on the same card — exactly the duplicate we saw
    // for R-f07370. Combined with the Stripe idempotency key below, this gives
    // belt-and-braces protection.
    // Claim from a placeable state: never placed (null) OR a dead hold that can
    // be re-collected (expired/released). 'held'/'processing' are handled above.
    // We match on the EXACT prior status we read, which keeps the claim atomic
    // (only wins if nothing changed underneath us). NOTE: a PostgREST `.or()`
    // filter on `.update()` mis-qualifies the column and errors with
    // "column rentals.deposit_hold_status does not exist", so we branch on the
    // proven `.is(null)` / `.eq()` filters instead.
    let claimQuery = supabase
      .from("rentals")
      .update({ deposit_hold_status: "processing" })
      .eq("id", rentalId);
    claimQuery =
      priorHoldStatus === null || priorHoldStatus === undefined
        ? claimQuery.is("deposit_hold_status", null)
        : claimQuery.eq("deposit_hold_status", priorHoldStatus);
    const { data: claimed, error: claimError } = await claimQuery.select("id");
    if (claimError) {
      return errorResponse(`Failed to claim hold slot: ${claimError.message}`, 500);
    }
    if (!claimed || claimed.length === 0) {
      // Lost the race or a hold already exists. Re-read so we can give the
      // caller an honest status without double-charging.
      const { data: current } = await supabase
        .from("rentals")
        .select("deposit_hold_status")
        .eq("id", rentalId)
        .single();
      return jsonResponse({
        success: true,
        alreadyHeld: true,
        message: `Hold slot already claimed (status=${current?.deposit_hold_status ?? "unknown"})`,
      });
    }

    // Create PaymentIntent with manual capture (hold only).
    // idempotency_key is keyed on rentalId so any retry from Stripe or any
    // accidental second invocation returns the SAME PaymentIntent instead of
    // creating a duplicate. Stripe honours this for 24h.
    //
    // We try with request_multicapture first so partial captures can keep the
    // remainder authorised on the SAME PaymentIntent instead of releasing it.
    // Stripe is supposed to silently ignore the request when not supported
    // ("if_available" semantics), but Connect accounts that haven't been
    // approved for multicapture actually error out with
    // "This account is not eligible for the requested card features." — so we
    // catch that and retry without the option. capture-deposit-hold will then
    // fall back to the rollover-PI flow for partial captures on these accounts.
    const basePayload = {
      amount: amountInCents,
      currency: currencyCode,
      customer: customer.stripe_customer_id,
      payment_method: paymentMethodId,
      capture_method: "manual" as const,
      confirm: true,
      off_session: true,
      description: `Security deposit hold for rental ${rentalId.substring(0, 8).toUpperCase()}`,
      // Expand the authorising charge so we can read the REAL expiry deadline
      // (payment_method_details.card.capture_before) instead of guessing.
      expand: ["latest_charge"],
      metadata: {
        rental_id: rentalId,
        tenant_id: effectiveTenantId,
        type: "deposit_hold",
      },
    };
    // Re-collections (prior hold expired/released) get a distinct idempotency
    // key so Stripe creates a NEW hold instead of returning the dead PI.
    const idemSuffix = priorHoldStatus === "expired" || priorHoldStatus === "released" ? `-recollect-${priorHoldStatus}` : "";
    const requestOpts = { ...(stripeOptions ?? {}), idempotencyKey: `deposit-hold-${rentalId}${idemSuffix}` };

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          ...basePayload,
          // Request extended authorization (up to ~30 days) + multicapture.
          payment_method_options: {
            card: DEPOSIT_HOLD_CARD_OPTIONS,
          },
        },
        requestOpts
      );
    } catch (piErr: any) {
      const msg = String(piErr?.message ?? "");
      const notEligibleForFeature = msg.toLowerCase().includes("not eligible for the requested card features");
      if (notEligibleForFeature) {
        console.warn("[DEPOSIT-HOLD] Multicapture not granted on this account, retrying without:", msg);
        try {
          // Idempotency key must change for the retry — Stripe returns the
          // failed first response otherwise. Suffix with -no-mc so subsequent
          // retries are still idempotent on this rental.
          paymentIntent = await stripe.paymentIntents.create(basePayload, {
            ...requestOpts,
            idempotencyKey: `${requestOpts.idempotencyKey}-no-mc`,
          });
        } catch (retryErr) {
          // Release the claim so a manual retry isn't blocked by a stuck
          // 'processing' status.
          await supabase
            .from("rentals")
            .update({ deposit_hold_status: null })
            .eq("id", rentalId)
            .eq("deposit_hold_status", "processing");
          throw retryErr;
        }
      } else {
        await supabase
          .from("rentals")
          .update({ deposit_hold_status: null })
          .eq("id", rentalId)
          .eq("deposit_hold_status", "processing");
        throw piErr;
      }
    }

    console.log("[DEPOSIT-HOLD] PaymentIntent created:", paymentIntent.id, "status:", paymentIntent.status);

    if (paymentIntent.status !== "requires_capture") {
      console.error("[DEPOSIT-HOLD] Unexpected status:", paymentIntent.status);
      // Release the 'processing' claim so retries / manual placement aren't blocked.
      await supabase
        .from("rentals")
        .update({ deposit_hold_status: null })
        .eq("id", rentalId)
        .eq("deposit_hold_status", "processing");
      return errorResponse(`Hold failed with status: ${paymentIntent.status}. The card may have been declined.`, 400);
    }

    // Read the REAL expiry from Stripe (capture_before on the charge). With
    // extended authorization this can be ~30 days; otherwise ~7 days. Never
    // hardcode 31 — that lie is what let holds die silently while the DB still
    // showed "held".
    const expiresAtIso = await resolveHoldExpiry(stripe, paymentIntent, stripeOptions);

    // Update rental with deposit hold info
    const { error: updateError } = await supabase
      .from("rentals")
      .update({
        deposit_hold_payment_intent_id: paymentIntent.id,
        deposit_hold_status: "held",
        deposit_hold_amount: depositAmount,
        deposit_hold_placed_at: new Date().toISOString(),
        deposit_hold_expires_at: expiresAtIso,
        deposit_hold_payment_method_id: paymentMethodId,
        deposit_hold_stripe_customer_id: customer.stripe_customer_id,
      })
      .eq("id", rentalId);

    if (updateError) {
      console.error("[DEPOSIT-HOLD] Failed to update rental:", updateError);
      // Try to cancel the hold since we couldn't save it
      await stripe.paymentIntents.cancel(paymentIntent.id, stripeOptions);
      // Release the 'processing' claim so a retry can succeed.
      await supabase
        .from("rentals")
        .update({ deposit_hold_status: null })
        .eq("id", rentalId)
        .eq("deposit_hold_status", "processing");
      return errorResponse("Failed to save deposit hold record", 500);
    }

    console.log("[DEPOSIT-HOLD] Hold placed successfully. Amount:", depositAmount, "Expires:", expiresAtIso);

    return jsonResponse({
      success: true,
      paymentIntentId: paymentIntent.id,
      amount: depositAmount,
      expiresAt: expiresAtIso,
    });
  } catch (error: any) {
    console.error("[DEPOSIT-HOLD] Error:", error);

    // Handle Stripe-specific errors
    if (error.type === "StripeCardError") {
      return errorResponse(`Card declined: ${error.message}`, 400);
    }

    return errorResponse(error.message, 500);
  }
});
