// Place a deposit hold on customer's saved card at key handover (giving)
// Creates a Stripe PaymentIntent with capture_method: 'manual' (authorize only, no charge)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getConnectAccountId, getChargePlatformAccount, getStripeClientForAccount, getStripeClientForRecord, resolveHoldExpiry, DEPOSIT_HOLD_CARD_OPTIONS, type StripeMode } from "../_shared/stripe-client.ts";

// Stripe PaymentIntent status -> the deposit_hold_status that is conclusively
// true when we see it. Only these three mean the authorisation is DEAD and the
// rental may be re-collected; requires_capture means it is alive, and anything
// else (requires_action, requires_confirmation, processing) is still in motion
// and is treated as alive so we never authorise the same card twice.
//
// Duplicated in create-hold-checkout — _shared/stripe-client.ts is owned by
// another workstream and this pair of guards must ship without touching it.
const DEAD_PI_STATUS_TO_HOLD_STATUS: Record<string, string> = {
  canceled: "expired",
  succeeded: "captured",
  requires_payment_method: "failed",
};

/**
 * Is the hold recorded on this rental STILL alive at Stripe?
 *
 * rentals.deposit_hold_status is written when a hold is placed and then never
 * revisited: card authorisations expire on their own (~5-7 days at the network
 * default) and Stripe cancels the PaymentIntent, but every webhook looks
 * PaymentIntents up by payments.stripe_payment_intent_id, never by
 * rentals.deposit_hold_payment_intent_id. So the row keeps saying 'held' on a
 * dead auth forever and every placement path short-circuits — the operator is
 * told a hold is already active and has no way forward (GMT: "I cannot refresh
 * the hold", Aug 2026).
 *
 * FAIL SAFE, NOT OPEN: any doubt — Stripe unreachable, an id Stripe has never
 * heard of, a PI still mid-authorisation — returns `alive: true` so we keep the
 * conservative skip rather than risk double-authorising a customer's card.
 */
async function probeRecordedHold(
  stripe: ReturnType<typeof getStripeClientForRecord>,
  paymentIntentId: string,
  stripeOptions: { stripeAccount?: string } | undefined
): Promise<{ alive: boolean; deadStatus: string | null }> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, stripeOptions);
    const deadStatus = DEAD_PI_STATUS_TO_HOLD_STATUS[String(intent.status)] ?? null;
    if (deadStatus) return { alive: false, deadStatus };
    return { alive: true, deadStatus: null };
  } catch (err) {
    console.warn("[DEPOSIT-HOLD] Could not verify existing hold at Stripe, treating as active:", err);
    return { alive: true, deadStatus: null };
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId, tenantId, manualOverride } = await req.json();

    if (!rentalId) {
      return errorResponse("Missing required field: rentalId");
    }

    console.log("[DEPOSIT-HOLD] Placing hold for rental:", rentalId);

    // Fetch rental details
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("customer_id, vehicle_id, tenant_id, deposit_hold_status, deposit_hold_payment_intent_id, deposit_amount_override, auto_extend_enabled, platform_account")
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    // Two-tier guard (GMT incident, Jul 2026 — the old blanket ban broke
    // deposits for tenants whose business is manually-extended rentals):
    //
    // 1. AUTO-EXTEND rentals NEVER get a hold, from any caller (RevTek/Jeffrey:
    //    renewal pricing replaces the deposit; hit twice by auto placement).
    // 2. Manually-EXTENDED rentals are blocked only for AUTOMATIC callers
    //    (webhooks, booking-success, post-charge auto-placement) — that loop is
    //    what spammed RevTek/Fabri with 16 failed attempts on every extension
    //    payment. A deliberate staff action passes manualOverride: true and is
    //    allowed through: the operator is choosing to hold a deposit on a
    //    rental they extended, which is legitimate (GMT's whole fleet).
    if ((rental as any).auto_extend_enabled) {
      console.log("[DEPOSIT-HOLD] Skipped — auto-extend rental:", rentalId);
      return jsonResponse({ success: true, skipped: true, message: "Auto-extend rental — deposit hold skipped (renewal pricing replaces the deposit)" });
    }
    if (!manualOverride) {
      let hasExtensions = false;
      {
        const { count } = await supabase
          .from("rental_extensions")
          .select("id", { count: "exact", head: true })
          .eq("rental_id", rentalId);
        hasExtensions = (count ?? 0) > 0;
      }
      if (hasExtensions) {
        console.log("[DEPOSIT-HOLD] Skipped — extended rental (automatic caller):", rentalId);
        return jsonResponse({ success: true, skipped: true, message: "Extended rental — automatic deposit placement skipped. Staff can place a hold deliberately from the rental page." });
      }
    }

    const effectiveTenantId = tenantId || rental.tenant_id;

    // Fetch tenant settings (deposit amount, Stripe config).
    // Hoisted above the 'held' guard below: that guard now has to ask Stripe
    // whether the recorded hold is real, and resolving the right Stripe client
    // needs this row.
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("global_deposit_amount, security_deposit_enabled, deposit_mode, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id")
      .eq("id", effectiveTenantId)
      .single();

    if (tenantError || !tenant) {
      return errorResponse("Tenant not found", 404);
    }

    // Remember the prior state: a re-collection after a dead hold needs a fresh
    // Stripe idempotency key so it doesn't get handed back the old (dead)
    // PaymentIntent. It is `let` because the stale-hold reconciliation below
    // may correct it — and the atomic claim further down matches on it.
    let priorHoldStatus = rental.deposit_hold_status as string | null;

    // Don't place a hold if one already exists — but 'held' in the DB is NOT
    // proof of a live authorisation (see probeRecordedHold above). Ask Stripe
    // before refusing: an expired auth left this branch returning alreadyHeld
    // forever, so the rental could never take another deposit and the operator
    // had no way forward (GMT: "I cannot refresh the hold", Aug 2026).
    //
    // The PI we probe is the one the heal below is anchored to. Anchoring on
    // status alone is unsafe: refresh-deposit-holds CANCELS the old PI and then
    // re-writes the row as 'held' carrying a BRAND NEW live PI, so a
    // status-only guard would happily mark that live hold dead and we would
    // authorise the customer's card a second time.
    const probedPiId = (rental.deposit_hold_payment_intent_id as string | null) ?? null;
    if (priorHoldStatus === "held") {
      let alive = true;
      let deadStatus: string | null = null;
      try {
        if (!probedPiId) {
          // No PaymentIntent recorded, so nothing can be alive — the status is
          // a leftover, not an authorisation.
          alive = false;
        } else {
          const holdMode: StripeMode = (tenant.stripe_mode as StripeMode) || "test";
          // Record-anchored: the EXISTING hold lives on the platform account it
          // was created on (rentals.platform_account), which may differ from
          // where the NEW hold goes if the tenant has since flipped model.
          const holdStripe = getStripeClientForRecord(rental as any, holdMode);
          const holdConnectId = getConnectAccountId({
            ...(tenant as any),
            payment_model: (rental as any).platform_account === "uae" ? "own" : "managed",
          });
          const probe = await probeRecordedHold(
            holdStripe,
            probedPiId,
            holdConnectId ? { stripeAccount: holdConnectId } : undefined
          );
          alive = probe.alive;
          deadStatus = probe.deadStatus;
        }
      } catch (probeErr) {
        // getConnectAccountId throws for a live 'own' tenant with no connected
        // account. Keep the old conservative answer rather than turning a clean
        // skip into a 500.
        console.warn("[DEPOSIT-HOLD] Hold liveness probe unavailable, treating as active:", probeErr);
        alive = true;
      }

      if (alive) {
        return jsonResponse({ success: true, alreadyHeld: true, message: "Deposit hold already active" });
      }

      // Correct the record to the truth BEFORE the atomic claim below, anchored
      // to the EXACT row we probed — same status AND same PaymentIntent (or the
      // same absence of one). priorHoldStatus must track the correction: the
      // claim matches on it, and a claim still looking for 'held' would find
      // nothing and bail out with "Hold slot already claimed".
      //
      // deadStatus === null means the row said 'held' with NO PaymentIntent
      // behind it, so the honest value is NULL (never placed).
      let healQuery = supabase
        .from("rentals")
        .update({ deposit_hold_status: deadStatus })
        .eq("id", rentalId)
        .eq("deposit_hold_status", "held");
      healQuery = probedPiId
        ? healQuery.eq("deposit_hold_payment_intent_id", probedPiId)
        : healQuery.is("deposit_hold_payment_intent_id", null);
      const { data: healed, error: healError } = await healQuery.select("id");

      if (healError) {
        return errorResponse(`Failed to correct stale deposit hold status: ${healError.message}`, 500);
      }
      if (!healed || healed.length === 0) {
        // Somebody else moved the row while we were asking Stripe — most likely
        // refresh-deposit-holds swapping in a NEW PaymentIntent. Our "dead"
        // conclusion is about a PI that is no longer this rental's hold, so
        // fail safe and keep the conservative answer rather than authorising
        // the card again.
        console.warn(`[DEPOSIT-HOLD] Rental ${rentalId} changed under the hold probe; leaving it alone`);
        return jsonResponse({ success: true, alreadyHeld: true, message: "Deposit hold already active" });
      }
      console.warn(`[DEPOSIT-HOLD] Stale hold on rental ${rentalId} corrected held -> ${deadStatus ?? "null"}; re-collecting`);
      priorHoldStatus = deadStatus;
      // ...and fall through to place a fresh hold.
    }

    // If another worker is mid-flight, bail out — they'll finish their write.
    // The Stripe idempotency key below also catches the case where this guard
    // is bypassed (e.g. status reset between read and claim).
    if (priorHoldStatus === "processing") {
      return jsonResponse({ success: true, alreadyHeld: true, message: "Deposit hold is being placed by another request" });
    }
    // Same for the refresh cron, which owns the row as 'refreshing' between
    // cancelling the old PaymentIntent and writing the new one
    // (refresh-deposit-holds). Without this guard the atomic claim below happily
    // takes the slot from it mid-flight and we create a duplicate authorisation
    // on the customer's card — the cron then writes its own PI id over ours and
    // ours is orphaned, never released.
    if (priorHoldStatus === "refreshing") {
      return jsonResponse({ success: true, alreadyHeld: true, message: "Deposit hold is being refreshed by another request" });
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
    // Base (non-override) amount: normally the tenant's global_deposit_amount.
    // For a per_vehicle tenant the correct amount is the VEHICLE's own
    // security_deposit — the value the booking page and portal already show.
    // place-deposit-hold historically ignored deposit_mode and under-held
    // vehicles priced above the global (e.g. GMT's Tesla: $200 configured, $100
    // held). SCOPED to GMT only for now: the other per_vehicle tenants have
    // global_deposit_amount = $0, so enabling this for them would start placing
    // holds they don't collect today — a separate rollout decision.
    const PER_VEHICLE_DEPOSIT_TENANT_IDS = new Set([
      "ada84c6f-eb17-43b6-a14d-d16518165349", // globalmotiontransport (GMT)
    ]);
    let baseDeposit = Number(tenant.global_deposit_amount) || 0;
    if (
      tenant.deposit_mode === "per_vehicle" &&
      PER_VEHICLE_DEPOSIT_TENANT_IDS.has(effectiveTenantId) &&
      rental.vehicle_id
    ) {
      const { data: veh } = await supabase
        .from("vehicles")
        .select("security_deposit")
        .eq("id", rental.vehicle_id)
        .single();
      if (veh && veh.security_deposit != null) {
        baseDeposit = Number(veh.security_deposit) || 0;
      }
    }
    const depositAmount = overrideAmount !== null ? overrideAmount : baseDeposit;
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

    // Set up Stripe — NEW hold, so it belongs to the tenant's current
    // platform account ('managed' → UK, 'own' → UAE).
    const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || "test";
    const platformAccount = getChargePlatformAccount(tenant);
    const stripe = getStripeClientForAccount(platformAccount, stripeMode);
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
    // be re-collected (expired/released/captured/failed). 'held', 'processing'
    // and 'refreshing' are all returned above — including a 'held' row we just
    // reconciled against Stripe, in which case priorHoldStatus already carries
    // the CORRECTED value, so the claim matches the row as it now stands.
    // We match on the EXACT prior status we read (or wrote) AND on the exact
    // PaymentIntent the row carried, which keeps the claim atomic (only wins if
    // nothing changed underneath us). The PI anchor matters because
    // refresh-deposit-holds can hand the row a NEW live authorisation while
    // leaving the status looking claimable — claiming that would put a second
    // hold on the customer's card. NOTE: a PostgREST `.or()`
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
    // Only when a PI was actually recorded: with none recorded there is no
    // authorisation to protect, and nothing in this codebase ever writes a PI id
    // without moving the status in the same statement, so the status filter
    // already covers that case.
    if (probedPiId) claimQuery = claimQuery.eq("deposit_hold_payment_intent_id", probedPiId);
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
    // Re-collections get a distinct idempotency key so Stripe creates a NEW
    // hold instead of replaying the dead one for 24h.
    //
    // Keyed on the DEAD PAYMENT INTENT, not on the prior status. Status is the
    // wrong anchor because every placement-failure path below resets
    // deposit_hold_status to NULL while LEAVING deposit_hold_payment_intent_id
    // in place: a declined re-collection therefore came back with a null status
    // and collapsed to the plain `deposit-hold-<rentalId>` key — the very key
    // the rental's FIRST-EVER hold used — so within Stripe's 24h window the
    // operator was handed the old response and told the hold was placed when no
    // authorisation existed.
    //
    // The surviving PI id has none of that trouble: it is untouched by the
    // failure resets, differs for each successive re-collection (so a second
    // dead hold gets a second key), collapses to the unsuffixed key only for a
    // genuine first hold, and keeps true retries of ONE attempt idempotent.
    const idemSuffix = probedPiId ? `-recollect-${probedPiId}` : "";
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
        // Record which platform account this hold lives on so capture/release/
        // sync target the right keys even if the tenant's model flips later.
        platform_account: platformAccount,
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
