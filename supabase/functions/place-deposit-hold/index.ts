// Place a deposit hold on customer's saved card at key handover (giving)
// Creates a Stripe PaymentIntent with capture_method: 'manual' (authorize only, no charge)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getConnectAccountId,
  getChargePlatformAccount,
  getStripeClientForAccount,
  getStripeClientForRecord,
  createDepositHoldIntentWithFallback,
  resolveHoldExpiryDetailed,
  chainExpiryFromEndDate,
  CHAIN_GRACE_DAYS_AFTER_END,
  type StripeMode,
} from "../_shared/stripe-client.ts";
import { getCustomerIdForAccount, CUSTOMER_ACCOUNT_COLUMNS } from "../_shared/customer-account.ts";
import { authorizeDepositHoldRequest } from "../_shared/deposit-hold-auth.ts";

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

    const { rentalId, tenantId, manualOverride, actor: actorInput } = await req.json();

    if (!rentalId) {
      return errorResponse("Missing required field: rentalId");
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    // This authorises real money on a renter's card. It read no Authorization
    // header, so the gateway's `verify_jwt = true` default was the only check —
    // and the PUBLIC ANON KEY in the booking bundle satisfies that. Any session
    // on the project could force an authorisation on another tenant's renter.
    //
    // This endpoint has the widest caller set of the five, so the guard is
    // configured, not bolted on:
    //
    //  * SERVER-TO-SERVER (service-role bearer) — stripe-webhook-test,
    //    stripe-webhook-live (both on `place_deposit_hold` session metadata) and
    //    charge-saved-card. These are the automatic placement paths for the
    //    portal's new-rental flow; breaking them would stop deposits being held
    //    across every tenant, which is far worse than the hole.
    //  * PORTAL STAFF — rentals/[id] (post-charge auto-placement),
    //    charge-deposit-dialog ("Refresh hold", manualOverride: true) and
    //    use-key-handover (giving the keys). Tenant-scoped and role-checked.
    //  * THE RENTER THEMSELVES (`allowRentalCustomer`) — the booking app's
    //    success page places the hold from the browser after payment. A signed-in
    //    renter is admitted only for their OWN rental, resolved through
    //    customer_users; they can never capture or release it.
    //  * GUEST BOOKINGS (`allowUnidentifiedAutomation`) — the same success page
    //    reached with no session at all. This is the ONLY mechanism that places a
    //    deposit hold for a website booking: the webhook path needs
    //    `place_deposit_hold` metadata and only the PORTAL sets it. Refusing here
    //    would silently stop deposits on every customer-originated booking. So an
    //    unidentified caller is admitted for AUTOMATIC placement only — never with
    //    manualOverride, which bypasses the extended-rental block. Known, bounded
    //    residual gap; see the note on the option in _shared/deposit-hold-auth.ts.
    const auth = await authorizeDepositHoldRequest(req, supabase, {
      rentalId,
      logPrefix: "[DEPOSIT-HOLD]",
      allowRentalCustomer: true,
      allowUnidentifiedAutomation: true,
      manualOverride: !!manualOverride,
    });
    if (!auth.ok) return errorResponse(auth.message, auth.status);

    // Body `tenantId` is a hint used only to load Stripe/deposit config below.
    // The guard has already bound the caller to the rental's real tenant, and a
    // mismatch means the caller is describing a different rental than the one
    // they named.
    if (tenantId && auth.rental.tenant_id && tenantId !== auth.rental.tenant_id) {
      return errorResponse("Not authorised for this rental", 403);
    }

    // Who is asking, for the deposit_hold_links ledger.
    //
    // A PROVEN identity always wins: when the guard resolved a real human (an
    // app_user's id, or "customer"), that is what the ledger records — a
    // client-supplied `actor` must not be able to sign someone else's name to a
    // card authorisation. `actorInput` is still honoured for the machine paths,
    // where it is the only way a trusted caller can say which job it was, and it
    // remains length-capped. No caller sends it today.
    const humanActor = auth.caller.kind === "staff" || auth.caller.kind === "customer";
    const actor = !humanActor && typeof actorInput === "string" && actorInput.trim()
      ? actorInput.trim().slice(0, 120)
      : auth.caller.actor;

    console.log("[DEPOSIT-HOLD] Placing hold for rental:", rentalId);

    // Fetch rental details
    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select("customer_id, vehicle_id, tenant_id, end_date, deposit_hold_status, deposit_hold_payment_intent_id, deposit_amount_override, auto_extend_enabled, platform_account, deposit_hold_attempt_seq, disclosed_hold_amount, disclosed_hold_version")
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
      .select("payment_provider, global_deposit_amount, security_deposit_enabled, deposit_charge_enabled, deposit_mode, currency_code, stripe_mode, stripe_account_id, stripe_onboarding_complete, payment_model, own_stripe_account_id, own_stripe_test_account_id")
      .eq("id", effectiveTenantId)
      .single();

    if (tenantError || !tenant) {
      return errorResponse("Tenant not found", 404);
    }

    // A tenant on CHARGED deposits collects the deposit as a real payment against
    // a 'Security Deposit' ledger charge. Authorising the card on top of that
    // ring-fences the same money a second time and the renter is short twice
    // over — the exact double-hit this migration exists to remove.
    //
    // The refusal lives here, not in the callers, because there are six of them
    // (the Stripe webhook's place_deposit_hold flag, charge-saved-card, key
    // handover, the booking success page x2, and the manual portal buttons) and
    // any one of them missed would silently double-charge a live customer.
    // A Square tenant never places an authorisation hold. Square has no
    // SetupIntent and cannot vault a card from a hosted link, so there is
    // nothing to authorise against — this is designed-out, not unimplemented.
    //
    // It returns a SKIP rather than throwing for the same reason the charged-
    // deposit refusal below does: six callers reach this function, including the
    // Stripe webhook and the booking success page, and a throw would turn a
    // deliberately-absent feature into a failed booking. Square tenants are
    // created with deposit_charge_enabled=true, so the refusal below would also
    // catch them — this one states the actual reason instead of implying the
    // operator configured it that way.
    if ((tenant as { payment_provider?: string }).payment_provider === "square") {
      console.log(`[place-deposit-hold] tenant ${effectiveTenantId} is on Square — holds are not supported on this provider.`);
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "square_tenant",
        message: "This tenant processes payments through Square, which cannot place an authorisation hold. Deposits are collected as a charge instead.",
      });
    }

    if ((tenant as { deposit_charge_enabled?: boolean }).deposit_charge_enabled === true) {
      console.log(`[place-deposit-hold] tenant ${effectiveTenantId} is on charged deposits — no authorisation placed.`);
      return jsonResponse({
        success: true,
        skipped: true,
        message: "This tenant collects deposits as a charge, not a hold — no authorisation was placed.",
      });
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
    const probedPiId = (rental.deposit_hold_payment_intent_id as string | null) || null;
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
        .update({
          deposit_hold_status: deadStatus,
          deposit_hold_status_changed_at: new Date().toISOString(),
          // We just asked Stripe and got a conclusive answer, so this row is
          // reconciled as of now — same meaning as verify-deposit-hold's stamp.
          deposit_hold_verified_at: new Date().toISOString(),
        })
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
    // held).
    //
    // CURRENTLY INERT: GMT moved to deposit_mode='global' (2026-08-25) when
    // per-vehicle deposits were dropped as a product decision, so this set no
    // longer matches any tenant's mode and the resolver falls through to the
    // tenant global. Kept so the mechanism survives — do NOT read it as "GMT is
    // on per-vehicle".
    //
    // Still scoped deliberately: the other per_vehicle tenants have
    // global_deposit_amount = $0, so enabling this for them would start placing
    // holds they don't collect today — a separate rollout decision. And the
    // inverse is worse: switching them to 'global' would drop 40 vehicles to a
    // $0 deposit. Set their global amount before touching their mode.
    //
    // NOTE: this is a second copy of PER_VEHICLE_DEPOSIT_TENANT_IDS, duplicated
    // from _shared/deposit-amount.ts. Keep the two in step.
    const PER_VEHICLE_DEPOSIT_TENANT_IDS = new Set([
      "ada84c6f-eb17-43b6-a14d-d16518165349", // globalmotiontransport (GMT)
    ]);
    let baseDeposit = Number(tenant.global_deposit_amount) || 0;
    let baseDepositSource = "tenant_global";
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
        baseDepositSource = "vehicle_security_deposit";
      }
    }
    const depositAmount = overrideAmount !== null ? overrideAmount : baseDeposit;
    // Recorded on the ledger row so "why was THIS amount authorised?" is
    // answerable months later, when the tenant/vehicle figures have moved on.
    const depositSource = overrideAmount !== null ? "rental_override" : baseDepositSource;
    if (depositAmount <= 0) {
      return jsonResponse({ success: true, skipped: true, message: "Deposit amount is 0" });
    }
    console.log("[DEPOSIT-HOLD] Using amount:", depositAmount, overrideAmount !== null ? "(rental override)" : "(tenant default)");

    // Fetch customer's Stripe customer ID
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select(`${CUSTOMER_ACCOUNT_COLUMNS}, name, email`)
      .eq("id", rental.customer_id)
      .single();

    if (customerError || !customer) {
      return errorResponse("Customer not found", 404);
    }

    // Set up Stripe — NEW hold, so it belongs to the tenant's current
    // platform account ('managed' → UK, 'own' → UAE).
    const stripeMode: StripeMode = (tenant.stripe_mode as StripeMode) || "test";
    const platformAccount = getChargePlatformAccount(tenant);
    const stripe = getStripeClientForAccount(platformAccount, stripeMode);
    const connectAccountId = getConnectAccountId(tenant);
    const stripeOptions = connectAccountId ? { stripeAccount: connectAccountId } : undefined;

    console.log("[DEPOSIT-HOLD] Stripe mode:", stripeMode, "Connect:", connectAccountId);

    // Per-account customer id (validated live), self-healing from the legacy
    // shared id. Per-account so a hold on one platform can never reference a
    // customer that lives on the other.
    const holdCustomerId = await getCustomerIdForAccount({
      supabase,
      stripe,
      account: platformAccount,
      stripeAccount: connectAccountId,
      customerRowId: rental.customer_id,
      customer,
    });

    if (!holdCustomerId) {
      return errorResponse("Customer has no saved payment method. Card must be saved during booking.", 400);
    }

    // Get the customer's default payment method
    const stripeCustomer = await stripe.customers.retrieve(
      holdCustomerId,
      { expand: ["invoice_settings.default_payment_method"] },
      stripeOptions
    );

    if ((stripeCustomer as any).deleted) {
      return errorResponse("Stripe customer has been deleted", 400);
    }

    // Try default payment method, then list all payment methods.
    // We keep the whole PaymentMethod object, not just its id: the card
    // identity columns (brand/last4/exp/funding) come off it for free here,
    // whereas re-retrieving it later would be an extra Stripe round-trip on
    // every placement. Card identity is what makes "which card is this chain
    // on, and is it a DEBIT card?" answerable — debit stacking is the main
    // renter-harm risk once a hold starts re-authorising for 90 days.
    let paymentMethod: any = (stripeCustomer as any).invoice_settings?.default_payment_method ?? null;

    if (!paymentMethod?.id) {
      // List payment methods and use the most recent one
      const paymentMethods = await stripe.paymentMethods.list(
        { customer: holdCustomerId, type: "card", limit: 1 },
        stripeOptions
      );

      if (paymentMethods.data.length === 0) {
        return errorResponse("No payment method found on customer's account", 400);
      }

      paymentMethod = paymentMethods.data[0];
    }

    const paymentMethodId: string = paymentMethod.id;
    const card = paymentMethod.card ?? null;

    console.log(
      "[DEPOSIT-HOLD] Using payment method:", paymentMethodId,
      card ? `(${card.brand} ••${card.last4}, funding=${card.funding})` : "(card details unavailable)"
    );

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
    //
    // The claim also BURNS AN ATTEMPT NUMBER. deposit_hold_attempt_seq is the
    // monotonic counter every link of this rental's hold chain is keyed on: the
    // Stripe idempotency key below, and the deposit_hold_links ledger row
    // (UNIQUE on rental_id + attempt_seq + action). Incrementing it inside the
    // CAS is what makes it safe without a DB-side `col = col + 1`: only one
    // caller can win the claim, so only one caller can mint this number.
    const attemptSeq = Number((rental as any).deposit_hold_attempt_seq ?? 0) + 1;
    let claimQuery = supabase
      .from("rentals")
      .update({
        deposit_hold_status: "processing",
        deposit_hold_status_changed_at: new Date().toISOString(),
        deposit_hold_attempt_seq: attemptSeq,
      })
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
    //
    // No payment_method_options here on purpose: createDepositHoldIntentWithFallback
    // adds the card block per attempt, walking DEPOSIT_HOLD_CARD_VARIANTS from
    // extended-authorization + multicapture down to nothing. Stripe is supposed
    // to silently ignore an unsupported feature ("if_available" semantics), but
    // Connect accounts that haven't been approved for them error out with
    // "This account is not eligible for the requested card features." — GMT's
    // live account does exactly that — so the request has to be downgraded
    // rather than 500. capture-deposit-hold falls back to the rollover-PI flow
    // for partial captures when multicapture wasn't granted.
    const basePayload = {
      amount: amountInCents,
      currency: currencyCode,
      customer: holdCustomerId,
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
    // The idempotency key is keyed on the ATTEMPT, not on the rental and not on
    // the dead PaymentIntent.
    //
    // Both previous schemes leaked a stale Stripe response into a fresh
    // attempt. Keying on status collapsed to the plain `deposit-hold-<rentalId>`
    // key on exactly the retry that needed a new one, because every
    // placement-failure path below resets deposit_hold_status to NULL. Keying
    // on the dead PI id fixed that case but still replays a DECLINE verbatim:
    // the failure paths leave deposit_hold_payment_intent_id untouched, so a
    // retry after a soft decline re-sends the identical key and Stripe hands
    // back its cached decline for 24h — the customer could fix their card and
    // the operator would still be told it failed.
    //
    // attempt_seq is minted by the atomic claim above, so it advances exactly
    // once per real attempt: never reused after a failure, never advanced by a
    // duplicate invocation (that one loses the claim and returns early), and
    // still idempotent for a network-level retry INSIDE one attempt, which is
    // the only thing an idempotency key is supposed to protect.
    const idempotencyKey = `deposit-hold-${rentalId}-a${attemptSeq}`;
    const requestOpts = { ...(stripeOptions ?? {}), idempotencyKey };

    // Release the claim so a retry (manual or automatic) isn't blocked by a
    // stuck 'processing' status, and leave the reason behind. Every failure
    // path resets status to NULL rather than a terminal value: this rental has
    // no authorisation, and NULL is the state the claim above can re-take.
    //
    // This is the RECOVERY-CRITICAL write of every failure path, so it runs
    // FIRST (before the ledger row is completed) and it can never throw: a row
    // stranded at 'processing' makes every subsequent placement answer "being
    // placed by another request" until reconcile-deposit-holds' stuck-claim
    // sweep frees it, which is the worst possible outcome for an operator who
    // is already stuck. One retry, because the only plausible cause of a throw
    // here is a transport blip.
    //
    // Anchored on the attempt WE minted as well as on 'processing': if the row
    // was freed and re-claimed by another placement while Stripe was working,
    // that writer owns the slot and our failure must not clear its claim.
    const releaseClaim = async (message: string, code: string | null) => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const { error } = await supabase
            .from("rentals")
            .update({
              deposit_hold_status: null,
              deposit_hold_status_changed_at: new Date().toISOString(),
              deposit_hold_last_error: message.slice(0, 500),
              deposit_hold_last_error_code: code,
            })
            .eq("id", rentalId)
            .eq("deposit_hold_status", "processing")
            .eq("deposit_hold_attempt_seq", attemptSeq);
          // supabase-js RESOLVES on a Postgres error rather than throwing, so
          // an unchecked write here would strand the row with nothing logged.
          if (!error) return;
          console.error("[DEPOSIT-HOLD] Failed to release claim on rental", rentalId, error);
        } catch (releaseErr) {
          // ...and it REJECTS on a transport failure, which an `{ error }`
          // check alone would sail straight past.
          console.error("[DEPOSIT-HOLD] Claim release threw on rental", rentalId, releaseErr);
        }
      }
      console.error(
        "[DEPOSIT-HOLD] CLAIM NOT RELEASED — rental", rentalId,
        "may be stranded at 'processing' (attempt", attemptSeq, "); reconcile-deposit-holds will sweep it"
      );
    };

    // LEDGER: written BEFORE Stripe is contacted so a crashed or timed-out
    // attempt is still discoverable — an orphaned authorisation with no DB row
    // is precisely the failure this table exists to make findable. Non-fatal:
    // an audit-row problem must never stop a deposit being placed, and the
    // UNIQUE (rental_id, attempt_seq, action) key means a retry of the SAME
    // attempt is a no-op rather than a duplicate.
    const linkRow = {
      rental_id: rentalId,
      tenant_id: effectiveTenantId,
      attempt_seq: attemptSeq,
      action: "place",
      superseded_pi_id: probedPiId,
      platform_account: platformAccount,
      connect_account_id: connectAccountId,
      stripe_mode: stripeMode,
      amount_cents: amountInCents,
      currency: currencyCode,
      idempotency_key: idempotencyKey,
      estimate_inputs: {
        deposit_amount: depositAmount,
        deposit_source: depositSource,
        deposit_mode: tenant.deposit_mode ?? null,
        tenant_global_deposit_amount: tenant.global_deposit_amount ?? null,
        rental_override: overrideAmount,
        manual_override: manualOverride === true,
        prior_hold_status: priorHoldStatus,
      },
      disclosed_amount: (rental as any).disclosed_hold_amount ?? null,
      disclosure_ref: (rental as any).disclosed_hold_version ?? null,
      card_funding: card?.funding ?? null,
      outcome: "pending",
      actor,
    };
    //
    // GENUINELY best-effort: supabase-js RESOLVES with `{ error }` on a
    // Postgres error but REJECTS on a transport/fetch failure, so an `{ error }`
    // check alone is not enough. Both ledger writers swallow BOTH, because a
    // network blip while writing an audit row must never propagate past a
    // deposit — least of all past the claim release, which would strand the
    // rental at 'processing'.
    {
      try {
        const { error: linkError } = await supabase.from("deposit_hold_links").insert(linkRow);
        if (linkError) console.error("[DEPOSIT-HOLD] Failed to write deposit_hold_links row (continuing):", linkError);
      } catch (linkErr) {
        console.error("[DEPOSIT-HOLD] deposit_hold_links insert threw (continuing):", linkErr);
      }
    }

    const completeLink = async (patch: Record<string, unknown>) => {
      try {
        const { error } = await supabase
          .from("deposit_hold_links")
          .update({ ...patch, completed_at: new Date().toISOString() })
          .eq("rental_id", rentalId)
          .eq("attempt_seq", attemptSeq)
          .eq("action", "place");
        if (error) console.error("[DEPOSIT-HOLD] Failed to complete deposit_hold_links row (continuing):", error);
      } catch (completeErr) {
        console.error("[DEPOSIT-HOLD] deposit_hold_links update threw (continuing):", completeErr);
      }
    };

    let paymentIntent;
    try {
      // Downgrades through DEPOSIT_HOLD_CARD_VARIANTS (extended auth +
      // multicapture -> extended auth -> multicapture -> nothing). Replaces a
      // hand-rolled two-rung version here that dropped straight from the pair
      // to no card features at all, so an account eligible for extended
      // authorization ALONE — a ~30-day link instead of a ~5-7 day one — never
      // got the chance to prove it.
      paymentIntent = await createDepositHoldIntentWithFallback(stripe, basePayload, requestOpts);
    } catch (piErr: any) {
      const code = piErr?.code ?? piErr?.raw?.code ?? piErr?.decline_code ?? null;
      // Claim release FIRST — it is what lets the operator retry. The ledger
      // row is diagnostics and comes second (both are non-throwing, so the
      // order is about which write is attempted while the request is healthy).
      await releaseClaim(String(piErr?.message ?? piErr), code);
      await completeLink({
        outcome: "failed",
        error_code: code,
        error_message: String(piErr?.message ?? piErr).slice(0, 500),
      });
      throw piErr;
    }

    console.log("[DEPOSIT-HOLD] PaymentIntent created:", paymentIntent.id, "status:", paymentIntent.status);

    if (paymentIntent.status !== "requires_capture") {
      console.error("[DEPOSIT-HOLD] Unexpected status:", paymentIntent.status);
      // Release the 'processing' claim FIRST so retries / manual placement
      // aren't blocked; the ledger row follows.
      await releaseClaim(
        `Hold failed with status: ${paymentIntent.status}`,
        `pi_status_${paymentIntent.status}`
      );
      await completeLink({
        payment_intent_id: paymentIntent.id,
        outcome: "failed",
        error_code: `pi_status_${paymentIntent.status}`,
        error_message: `PaymentIntent settled at ${paymentIntent.status} instead of requires_capture`,
      });
      return errorResponse(`Hold failed with status: ${paymentIntent.status}. The card may have been declined.`, 400);
    }

    // Read the REAL expiry from Stripe (capture_before on the charge) AND where
    // that answer came from. With extended authorization this can be ~30 days;
    // otherwise ~5-7. Never hardcode 31 — that lie is what let holds die
    // silently while the DB still showed "held". Persisting the provenance is
    // the other half: a `fallback` expiry is a floor we invented, and the
    // refresher must be able to tell it from Stripe's own deadline.
    const expiry = await resolveHoldExpiryDetailed(stripe, paymentIntent, stripeOptions);
    const expiresAtIso = expiry.expiresAt;

    // The chain must stop somewhere. end_date is nullable on rentals, so an
    // open-ended rental simply gets no terminal date (NULL), which the
    // refresher reads as "no ceiling yet" rather than "already over".
    //
    // THIS IS A CACHE AND A FLOOR, NOT THE AUTHORITY. Placement runs once;
    // end_date moves every time the rental is extended, and an extension does
    // not re-place the hold. A frozen bound read literally would terminate the
    // chain on the ORIGINAL end date and the deposit would stop being renewed
    // mid-rental — near-certain for GMT, whose whole fleet is manually extended
    // (see the two-tier guard above).
    //
    // Nothing relies on this snapshot staying fresh any more. The authoritative
    // reader is `resolveChainBound` in _shared/deposit-hold-refresh.ts: the
    // refresher recomputes the bound from the rental's LIVE end_date on every
    // pass, enforces the LATER of that and this stored value, and re-stamps this
    // column forward when they disagree. verify-deposit-hold re-stamps it
    // forward too. What this write still buys is (a) a correct value for the
    // common case with no extra read, and (b) the placement floor below, which
    // the refresher deliberately honours and will never pull back in.
    //
    // The grace window is the shared CHAIN_GRACE_DAYS_AFTER_END constant in
    // _shared/stripe-client.ts — ONE definition, reached by this file and by the
    // refresher both directly and through chainExpiryFromEndDate, so the two
    // derivations cannot drift. Its VALUE is a product decision that has not
    // been formally made; see the constant's own doc comment.
    const chainExpiresAt = ((): string | null => {
      const fromEndDate = chainExpiryFromEndDate((rental as any).end_date as string | null);
      if (!fromEndDate) return null;
      // PLACEMENT-ONLY floor: a hold placed on a rental that is already past
      // its end date (routine when staff hold a deposit late on an overdue or
      // extended rental) would otherwise be born with a bound in the PAST, and
      // the refresher would refuse to renew it even once — the hold would die
      // at the first link, ~4 days later, in silence. Never applied on the
      // re-stamp path, where re-flooring on every call would mean the chain
      // never terminates at all.
      const floorMs = Date.now() + CHAIN_GRACE_DAYS_AFTER_END * 86_400_000;
      return new Date(Math.max(new Date(fromEndDate).getTime(), floorMs)).toISOString();
    })();

    // Update rental with deposit hold info.
    //
    // Anchored to the claim we still hold ('processing'), not a bare
    // .eq('id', …). Every other write in this family is a compare-and-set; this
    // one wasn't, so a row that moved on while Stripe was authorising — a
    // release, a capture, or the refresh cron taking over — would be silently
    // overwritten with our hold. Zero rows updated means we no longer own the
    // slot, which is handled exactly like a write failure below: our
    // authorisation is the orphan and gets cancelled.
    //
    // The call is wrapped because supabase-js REJECTS on a transport failure
    // rather than resolving with `{ error }`. Unwrapped, that rejection lands
    // in the outer catch with a LIVE authorisation on the customer's card, the
    // row stranded at 'processing', and nothing cancelled. A rejection is
    // ambiguous — the write may well have landed — so we re-read the row and
    // let the truth decide, rather than cancelling a hold the DB now points at.
    let savedRows: Array<{ id: string }> | null = null;
    let updateError: { message: string } | null = null;
    const runSuccessWrite = () =>
      supabase
      .from("rentals")
      .update({
        deposit_hold_payment_intent_id: paymentIntent.id,
        deposit_hold_status: "held",
        deposit_hold_status_changed_at: new Date().toISOString(),
        deposit_hold_amount: depositAmount,
        deposit_hold_placed_at: new Date().toISOString(),
        deposit_hold_expires_at: expiresAtIso,
        deposit_hold_payment_method_id: paymentMethodId,
        deposit_hold_stripe_customer_id: holdCustomerId,
        // Record which platform account this hold lives on so capture/release/
        // sync target the right keys even if the tenant's model flips later.
        platform_account: platformAccount,
        // ANCHORING (I3): every later operation on THIS hold — refresh, capture,
        // release — must use the account, mode and currency it was created
        // under, never the tenant's current row. Re-deriving currency from
        // tenants.currency_code mid-rental is how a UK->UAE flip produces a
        // replacement authorisation in a new currency on the old account.
        deposit_hold_connect_account_id: connectAccountId,
        deposit_hold_stripe_mode: stripeMode,
        deposit_hold_currency: currencyCode,
        // Which PLATFORM account (UK vs UAE) this authorisation actually lives
        // on. `platform_account` above carries the same value today, but it is
        // the RENTAL's platform and other paths may rewrite it — sync-deposit-hold
        // could overwrite the anchor, after which reconcile-deposit-holds resolved
        // its Stripe client from the wrong account, got resource_missing, and
        // could never reconcile the hold again. This column is the hold's OWN
        // platform and nothing but placement writes it, so the reconciler always
        // has a true anchor to prefer. CHECK allows only null | 'uk' | 'uae';
        // getChargePlatformAccount returns exactly 'uk' | 'uae'.
        deposit_hold_platform_account: platformAccount,
        // Provenance of deposit_hold_expires_at, plus what the network actually
        // granted us. Answers "did this hold get 30 days or 7?" and "is that
        // expiry real or our floor?" — neither of which the DB could answer.
        deposit_hold_expiry_source: expiry.source,
        deposit_hold_extended_auth: expiry.extendedAuth,
        deposit_hold_window_seconds: expiry.windowSeconds,
        deposit_hold_chain_expires_at: chainExpiresAt,
        // Card identity, so a 90-day chain can be audited (and debit stacking
        // spotted) without a Stripe round-trip per rental.
        deposit_hold_card_brand: card?.brand ?? null,
        deposit_hold_card_last4: card?.last4 ?? null,
        deposit_hold_card_exp_month: card?.exp_month ?? null,
        deposit_hold_card_exp_year: card?.exp_year ?? null,
        deposit_hold_card_funding: card?.funding ?? null,
        // deposit_hold_target_amount is deliberately NOT written. It is meant
        // to hold "what we WANT authorised for the rest of the chain" as
        // distinct from what currently IS authorised, but nothing reads it —
        // the refresher re-authorises against deposit_hold_amount. Two amount
        // columns with no defined precedence WILL drift the first time one is
        // updated in isolation, and this is a money path. Leaving it NULL is
        // forward-compatible: a future reader must resolve
        // `target_amount ?? deposit_hold_amount`, for which NULL is correct.
        // Wire it up together with that reader (workstream B), not before.
        // We just observed this PaymentIntent at Stripe, so the row is
        // reconciled as of now.
        deposit_hold_verified_at: new Date().toISOString(),
        // A live authorisation starts a clean slate: any backoff state left by
        // earlier failed attempts describes a chain that no longer exists.
        deposit_hold_failure_count: 0,
        deposit_hold_last_error: null,
        deposit_hold_last_error_code: null,
        deposit_hold_next_retry_at: null,
      })
      .eq("id", rentalId)
      .eq("deposit_hold_status", "processing")
      // ...and to the attempt WE minted. Status alone is not an identity: if
      // the row is freed and re-claimed while Stripe is authorising (the
      // stranded-claim sweep frees it, a fresh placement re-claims it), a
      // status-only CAS lands on the WINNER's claim and records our
      // PaymentIntent and amount against their attempt_seq — after which the
      // winner loses its own CAS and cancels its live authorisation.
      // attempt_seq is minted inside the claim, so it identifies us exactly.
      .eq("deposit_hold_attempt_seq", attemptSeq)
      .select("id");

    try {
      const res = await runSuccessWrite();
      savedRows = (res.data as Array<{ id: string }> | null) ?? null;
      updateError = res.error ? { message: res.error.message } : null;
    } catch (writeErr: any) {
      // Ambiguous: the statement may have committed before the connection
      // broke. Ask the row itself before treating a live authorisation as an
      // orphan and cancelling it.
      console.error("[DEPOSIT-HOLD] Hold record write threw for rental", rentalId, writeErr);
      let landed = false;
      try {
        const { data: after } = await supabase
          .from("rentals")
          .select("deposit_hold_payment_intent_id, deposit_hold_status")
          .eq("id", rentalId)
          .single();
        landed =
          after?.deposit_hold_payment_intent_id === paymentIntent.id &&
          after?.deposit_hold_status === "held";
      } catch (rereadErr) {
        // Still blind. Fall through to the failure path, which cancels the
        // authorisation: giving the customer's money back and leaving a
        // re-placeable rental beats leaving an untracked live hold on a card.
        console.error("[DEPOSIT-HOLD] Could not re-read rental after a failed hold write:", rereadErr);
      }
      if (landed) {
        console.warn("[DEPOSIT-HOLD] Hold record write reported an error but landed for rental", rentalId);
        savedRows = [{ id: rentalId }];
        updateError = null;
      } else {
        savedRows = null;
        updateError = { message: String(writeErr?.message ?? writeErr) };
      }
    }

    const lostClaim = !updateError && (!savedRows || savedRows.length === 0);

    if (updateError || lostClaim) {
      console.error(
        "[DEPOSIT-HOLD] Failed to record hold on rental:",
        updateError ?? "claim was taken by another writer while Stripe authorised"
      );
      // Try to cancel the hold since we couldn't save it. If the cancel ALSO
      // fails we have a live authorisation on the customer's card that no row
      // points at — the ledger row below is then the only trace, so it must be
      // written either way.
      let cancelled = false;
      try {
        await stripe.paymentIntents.cancel(paymentIntent.id, stripeOptions);
        cancelled = true;
      } catch (cancelErr) {
        console.error("[DEPOSIT-HOLD] ORPHANED AUTHORISATION — could not cancel", paymentIntent.id, cancelErr);
      }
      const reason = updateError
        ? updateError.message
        : "hold slot was claimed by another writer while Stripe authorised";
      const errorCode = updateError ? "rental_update_failed" : "claim_lost";
      // Release the 'processing' claim so a retry can succeed — before the
      // ledger row, which is diagnostics. Anchored on 'processing' AND on our
      // own attempt_seq, so if we lost the claim this correctly does nothing
      // rather than stamping our failure over the winner's state.
      await releaseClaim(reason, errorCode);
      await completeLink({
        payment_intent_id: paymentIntent.id,
        capture_before: expiry.source === "stripe_capture_before" ? expiresAtIso : null,
        extended_auth_status: expiry.extendedAuthStatus,
        outcome: cancelled ? "failed" : "orphaned",
        error_code: errorCode,
        error_message: `${reason}${cancelled ? " (authorisation cancelled)" : " (AUTHORISATION STILL LIVE AT STRIPE)"}`.slice(0, 500),
      });
      return errorResponse("Failed to save deposit hold record", 500);
    }

    await completeLink({
      payment_intent_id: paymentIntent.id,
      // Only a deadline Stripe actually published is a capture_before; our
      // 4-day floor is not one and must never be recorded as though it were.
      capture_before: expiry.source === "stripe_capture_before" ? expiresAtIso : null,
      extended_auth_status: expiry.extendedAuthStatus,
      card_funding: card?.funding ?? null,
      outcome: "succeeded",
    });

    console.log(
      "[DEPOSIT-HOLD] Hold placed successfully. Amount:", depositAmount,
      "Expires:", expiresAtIso, `(${expiry.source})`,
      "Chain until:", chainExpiresAt ?? "(no end_date)"
    );

    return jsonResponse({
      success: true,
      paymentIntentId: paymentIntent.id,
      amount: depositAmount,
      expiresAt: expiresAtIso,
      expirySource: expiry.source,
      extendedAuth: expiry.extendedAuth,
      chainExpiresAt,
      attemptSeq,
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
