// Reconcile a rental's recorded deposit hold against the TRUTH at Stripe.
//
// Why this exists: a card authorisation expires on its own (~5-7 days at the
// network default, up to ~30 with extended authorization). When it does, Stripe
// releases the funds and CANCELS the PaymentIntent — and nothing in this
// codebase notices. The deposit-hold PI id lives on
// rentals.deposit_hold_payment_intent_id, while every webhook looks
// PaymentIntents up by payments.stripe_payment_intent_id, so a dead
// authorisation leaves rentals.deposit_hold_status = 'held' forever. The
// operator then sees a green "Held" badge next to "A deposit hold is already
// active on this rental." and has no way forward — GMT's "I cannot refresh the
// hold. This is affecting our day to day business", Aug 2026.
//
// capture-deposit-hold already self-heals this way, but only at the moment an
// operator tries to charge. This function makes the same reconciliation
// available BEFORE they commit to anything, and is the read-side half of the
// fix (create-hold-checkout / place-deposit-hold are the write-side half).
//
// Input:  { rentalId }
// Output: { verified, liveHold, status, changed, expiresAt, needsReview?, message }
//
// `status` is ALWAYS a string. A rental that has never had a hold reports the
// sentinel 'none' (never persisted, only reported) so callers can format it
// without a null check.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getConnectAccountId,
  getStripeClientForRecord,
  TENANT_STRIPE_COLUMNS,
  type StripeMode,
} from "../_shared/stripe-client.ts";

// Stripe PaymentIntent status -> the deposit_hold_status that is TRUE when we
// see it. Only these four are conclusive; anything else (requires_action,
// requires_confirmation, processing) is still in motion, so we must neither
// write a terminal status for it nor call it a live hold — no money is
// authorised until requires_capture.
//
// Every value on the right MUST already exist in the rentals.deposit_hold_status
// CHECK constraint (processing | held | captured | released | expired |
// refreshing | failed) — the constraint rejects anything else at runtime.
const PI_STATUS_TO_HOLD_STATUS: Record<string, string> = {
  requires_capture: "held",
  canceled: "expired",
  succeeded: "captured",
  requires_payment_method: "failed",
};

/** Contract says `status: string`; null is only ever an internal value. */
const reportStatus = (status: string | null): string => status ?? "none";

/**
 * Read the REAL capture deadline off the authorising charge.
 *
 * Deliberately NOT _shared/stripe-client.ts's resolveHoldExpiry: that helper
 * returns `now + 7 days` whenever it cannot read capture_before, and that value
 * MOVES on every call. Persisting it here would re-arm deposit_hold_expires_at
 * on every verify, and refresh-deposit-holds selects rentals to re-authorise
 * with `.lt('deposit_hold_expires_at', now + 2 days)` — so a rental verified
 * more often than once every 5 days could NEVER enter the refresh window and
 * its hold would die unnoticed at the real deadline. That is precisely the GMT
 * incident this function exists to prevent, so we return null instead of
 * guessing and the caller leaves the stored value alone.
 */
async function readCaptureDeadline(
  stripe: ReturnType<typeof getStripeClientForRecord>,
  intent: any,
  stripeOptions: { stripeAccount?: string } | undefined
): Promise<string | null> {
  try {
    const latestCharge = intent?.latest_charge;
    let charge: any = latestCharge && typeof latestCharge === "object" ? latestCharge : null;
    // We ask Stripe to expand latest_charge, so this second round-trip should
    // never happen — but a string id here would otherwise silently cost us the
    // real deadline forever.
    if (!charge && typeof latestCharge === "string") {
      charge = await stripe.charges.retrieve(latestCharge, stripeOptions);
    }
    const captureBefore = charge?.payment_method_details?.card?.capture_before;
    if (typeof captureBefore === "number" && captureBefore > 0) {
      return new Date(captureBefore * 1000).toISOString();
    }
  } catch (err) {
    console.warn("[HOLD-VERIFY] Could not read capture_before; leaving stored expiry untouched:", err);
  }
  return null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { rentalId } = await req.json();
    if (!rentalId) {
      return errorResponse("Missing required field: rentalId");
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    // verify_jwt = true only proves the caller holds *a* session on this
    // Supabase project — and booking-app CUSTOMERS authenticate against the same
    // project. This endpoint writes deposit state, so it must additionally
    // prove the caller is staff of the rental's own tenant.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return errorResponse("Missing authorization", 401);

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // Server-to-server callers (other edge functions, cron) present the service
    // role key; they are already trusted and have no app_users row.
    const isServiceRole = serviceRoleKey.length > 0 && token === serviceRoleKey;

    let caller: { tenant_id: string | null; is_super_admin: boolean } | null = null;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return errorResponse("Invalid token", 401);

      // app_users has its own primary key; the auth user is linked via
      // auth_user_id (matching on `id` silently matches nothing).
      const { data: appUser } = await supabase
        .from("app_users")
        .select("tenant_id, is_super_admin, is_active")
        .eq("auth_user_id", userData.user.id)
        .maybeSingle();

      if (!appUser || appUser.is_active === false) {
        return errorResponse("Not authorised for this rental", 403);
      }
      caller = {
        tenant_id: (appUser.tenant_id as string | null) ?? null,
        is_super_admin: appUser.is_super_admin === true,
      };
    }

    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(
        "id, tenant_id, deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_expires_at, platform_account"
      )
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    if (caller && !caller.is_super_admin && caller.tenant_id !== rental.tenant_id) {
      return errorResponse("Not authorised for this rental", 403);
    }

    const currentStatus = (rental.deposit_hold_status as string | null) ?? null;
    const storedExpiresAt = (rental.deposit_hold_expires_at as string | null) ?? null;

    // Nothing was ever authorised, so there is no Stripe object to reconcile
    // against. This is a perfectly normal state (deposit disabled, amount 0, or
    // a hold that was released and cleared) — report it as verified, not as an
    // error, so the caller can go straight to placing a hold.
    if (!rental.deposit_hold_payment_intent_id) {
      return jsonResponse({
        verified: true,
        liveHold: false,
        status: reportStatus(currentStatus),
        changed: false,
        expiresAt: null,
        message: "No deposit hold is recorded on this rental.",
      });
    }

    // The PaymentIntent we are about to inspect. EVERY write below is anchored
    // to this id as well as to the status we read — see casUpdate.
    const probedPiId = rental.deposit_hold_payment_intent_id as string;

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select(TENANT_STRIPE_COLUMNS)
      .eq("id", rental.tenant_id)
      .single();

    if (tenantError || !tenant) {
      return errorResponse("Tenant not found", 404);
    }

    // RECORD-ANCHORED: the hold lives on the platform account it was CREATED on
    // (rentals.platform_account), not whichever model the tenant is on today.
    // Same resolution as capture-deposit-hold and refresh-deposit-holds — read
    // it with the wrong platform's keys and Stripe reports the PI as missing,
    // which would look exactly like an expired hold.
    //
    // getConnectAccountId THROWS for a live payment_model='own' tenant with no
    // connected account, and platform_account='uae' forces that model — so every
    // UAE-migrated rental of a tenant mid-OAuth would 500. This endpoint's
    // contract is that a reconcilable state never throws, so an unresolvable
    // Stripe context is reported as needsReview, exactly like a missing PI.
    const stripeContext = ((): {
      stripe: ReturnType<typeof getStripeClientForRecord>;
      stripeOptions: { stripeAccount?: string } | undefined;
      connectAccountId: string | null;
    } | null => {
      try {
        const stripeMode: StripeMode = ((tenant as any).stripe_mode as StripeMode) || "test";
        const client = getStripeClientForRecord(rental, stripeMode);
        const account = getConnectAccountId({
          ...(tenant as any),
          payment_model: rental.platform_account === "uae" ? "own" : "managed",
        });
        return {
          stripe: client,
          stripeOptions: account ? { stripeAccount: account } : undefined,
          connectAccountId: account,
        };
      } catch (configErr) {
        console.warn("[HOLD-VERIFY] Stripe context unresolvable for rental", rentalId, configErr);
        return null;
      }
    })();

    if (!stripeContext) {
      return jsonResponse({
        verified: false,
        liveHold: false,
        status: reportStatus(currentStatus),
        changed: false,
        expiresAt: storedExpiresAt,
        needsReview: true,
        message:
          "Stripe is not reachable for this rental — the tenant's Stripe connection is incomplete, so the deposit hold could not be checked. Nothing was changed.",
      });
    }

    const { stripe, stripeOptions, connectAccountId } = stripeContext;

    let intent;
    try {
      intent = await stripe.paymentIntents.retrieve(
        probedPiId,
        // Expand the authorising charge so we can read the REAL capture
        // deadline without a second round-trip.
        { expand: ["latest_charge"] },
        stripeOptions
      );
    } catch (err: any) {
      const code = err?.code ?? err?.raw?.code;
      if (code === "resource_missing") {
        // The recorded PI does not exist on this account/mode. Either it was
        // written against a different platform account or the id is stale. We
        // CANNOT conclude the customer's money is free, so we change nothing
        // and flag it for a human: guessing here either strands a real hold or
        // authorises the same card twice.
        console.warn(
          "[HOLD-VERIFY] PaymentIntent not found on account",
          connectAccountId ?? "(platform)",
          probedPiId
        );
        return jsonResponse({
          verified: false,
          liveHold: false,
          status: reportStatus(currentStatus),
          changed: false,
          expiresAt: storedExpiresAt,
          needsReview: true,
          message:
            "Stripe has no record of this deposit hold on the connected account. Nothing was changed — check the rental in Stripe before charging or re-holding.",
        });
      }
      // Network / auth / anything else is a genuine failure, not a state we can
      // reconcile. Let the outer catch turn it into a 500 rather than reporting
      // a hold as dead just because Stripe was unreachable.
      throw err;
    }

    const piStatus = String(intent.status);
    const trueStatus = PI_STATUS_TO_HOLD_STATUS[piStatus] ?? null;

    // Another worker owns this row right now: place-deposit-hold holds it at
    // 'processing' while it authorises, refresh-deposit-holds at 'refreshing'
    // while it cancels-and-replaces. Both write the outcome themselves, and the
    // PI we just read is the one they are replacing — stamping our conclusion
    // over the top would race them and could pin a stale PI's expiry onto a
    // brand-new hold. Report what we saw; write nothing.
    const workerOwnsRow = currentStatus === "processing" || currentStatus === "refreshing";

    // Compare-and-set on BOTH the status we read AND the PaymentIntent we
    // actually probed.
    //
    // Status alone is not enough, and the gap is not theoretical — it is most
    // likely to open exactly when we conclude "canceled", because that is what
    // refresh-deposit-holds does to the old PI:
    //   T0  we read the row: status='held', PI=PI_A
    //   T1  the refresh cron sets 'refreshing', CANCELS PI_A, creates PI_B and
    //       writes deposit_hold_payment_intent_id=PI_B + status='held'
    //   T2  our probe of PI_A returns 'canceled' -> we classify it dead
    //   T3  a status-only CAS still matches ('held' again) and we write
    //       'expired' over a row that now carries a LIVE authorisation
    // The customer would then be re-authorised on top of PI_B — two live holds
    // on one card, the exact outcome this workstream exists to prevent.
    // A row whose PI id has moved on is by definition not the row we probed, so
    // a 0-row update is the CORRECT outcome; reportLostRace handles it.
    const casUpdate = async (patch: Record<string, unknown>): Promise<boolean> => {
      let query = supabase
        .from("rentals")
        .update(patch)
        .eq("id", rentalId)
        .eq("deposit_hold_payment_intent_id", probedPiId);
      // NOTE: a PostgREST `.or()` filter on `.update()` mis-qualifies the column
      // ("column rentals.deposit_hold_status does not exist"), so branch on the
      // proven `.is(null)` / `.eq()` filters instead — same idiom as
      // place-deposit-hold's atomic claim.
      query = currentStatus === null
        ? query.is("deposit_hold_status", null)
        : query.eq("deposit_hold_status", currentStatus);
      const { data, error } = await query.select("id");
      if (error) throw new Error(`Failed to save reconciled deposit hold: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    };

    // The row moved under us. Report what is there NOW instead of our stale
    // conclusion, and say so plainly — this is not an error, just a re-read.
    const reportLostRace = async (liveHold: boolean, expiresAt: string | null) => {
      const { data: fresh } = await supabase
        .from("rentals")
        .select("deposit_hold_status")
        .eq("id", rentalId)
        .single();
      return jsonResponse({
        verified: true,
        liveHold,
        status: reportStatus((fresh?.deposit_hold_status as string | null) ?? currentStatus),
        changed: false,
        expiresAt,
        message: "Another update changed this deposit hold while it was being checked. Nothing was overwritten — check again to see the current state.",
      });
    };

    if (trueStatus === "held") {
      // Alive. Re-read the REAL deadline from the charge's capture_before:
      // deposit_hold_expires_at drifts whenever a hold is granted (or refused)
      // extended authorization, and refresh-deposit-holds picks rentals to
      // re-authorise off that column — a stale value silently skips the cron,
      // which is how holds died unnoticed in the first place.
      //
      // null means Stripe has not published a deadline for this charge. We
      // persist NOTHING in that case (see readCaptureDeadline): inventing one
      // would push the rental out of the cron's window on every call.
      const stripeExpiresAt = await readCaptureDeadline(stripe, intent, stripeOptions);
      const reportedExpiresAt = stripeExpiresAt ?? storedExpiresAt;
      const expiryLabel = stripeExpiresAt ? stripeExpiresAt.slice(0, 10) : null;

      if (workerOwnsRow) {
        return jsonResponse({
          verified: true,
          liveHold: true,
          status: reportStatus(currentStatus),
          changed: false,
          expiresAt: reportedExpiresAt,
          message: expiryLabel
            ? `The deposit hold is active at Stripe (capturable until ${expiryLabel}). Another update is in progress, so nothing was changed here.`
            : "The deposit hold is active at Stripe. Another update is in progress, so nothing was changed here.",
        });
      }

      // Compare expiries as instants, not strings: Postgres hands back
      // "2026-08-16T10:00:00+00:00" while toISOString() produces
      // "2026-08-16T10:00:00.000Z". A string compare is never equal, so we'd
      // write on every single call.
      const storedMs = storedExpiresAt ? new Date(storedExpiresAt).getTime() : NaN;
      const expiryDrifted = stripeExpiresAt !== null
        && !(Math.abs(storedMs - new Date(stripeExpiresAt).getTime()) < 1000);
      const changed = currentStatus !== "held" || expiryDrifted;

      if (changed) {
        const patch: Record<string, unknown> = { deposit_hold_status: "held" };
        // Only ever persist a deadline Stripe actually told us.
        if (stripeExpiresAt !== null) patch.deposit_hold_expires_at = stripeExpiresAt;
        const applied = await casUpdate(patch);
        if (!applied) return await reportLostRace(true, reportedExpiresAt);
        console.log("[HOLD-VERIFY] Reconciled", rentalId, currentStatus, "->", "held", "expires", stripeExpiresAt ?? "(unchanged)");
      }

      return jsonResponse({
        verified: true,
        liveHold: true,
        status: "held",
        changed,
        expiresAt: reportedExpiresAt,
        message: expiryLabel
          ? `The deposit hold is active and can be charged until ${expiryLabel}.`
          : "The deposit hold is active and can be charged. Stripe has not published a capture deadline for it yet.",
      });
    }

    if (!trueStatus) {
      // Still authorising at Stripe (requires_action, requires_confirmation,
      // processing). No funds are held yet, but it is not dead either — writing
      // a terminal status here would be a lie, and there is no non-terminal
      // value in the CHECK constraint that means "mid-3DS".
      return jsonResponse({
        verified: true,
        liveHold: false,
        status: reportStatus(currentStatus),
        changed: false,
        expiresAt: storedExpiresAt,
        message: `The deposit hold has not finished authorising (Stripe status: ${piStatus}). Nothing was changed — check again shortly.`,
      });
    }

    // Conclusively dead: expired (canceled), captured (succeeded) or failed
    // (requires_payment_method). Write the truth so the badge stops lying and
    // so the placement paths stop short-circuiting on a hold that no longer
    // exists.
    //
    // Two things we deliberately do NOT overwrite:
    //  - a row another worker owns (see workerOwnsRow above);
    //  - a 'released' status when Stripe says 'canceled'. Both describe the
    //    same canceled PI, but 'released' records that a human deliberately let
    //    the hold go. Downgrading that to 'expired' would erase the operator's
    //    action from the record.
    const wouldClobber = workerOwnsRow || (currentStatus === "released" && trueStatus === "expired");
    const changed = !wouldClobber && currentStatus !== trueStatus;

    if (changed) {
      const applied = await casUpdate({ deposit_hold_status: trueStatus });
      if (!applied) return await reportLostRace(false, null);
      console.warn(
        "[HOLD-VERIFY] Stale hold corrected on rental",
        rentalId,
        `${currentStatus} -> ${trueStatus}`,
        "(Stripe PI",
        probedPiId,
        "is",
        piStatus + ")"
      );
    }

    const DEAD_HOLD_MESSAGES: Record<string, string> = {
      expired:
        "This deposit hold is no longer active — the authorisation was released and the funds are back with the customer. Place a new hold to re-authorise the deposit.",
      captured:
        "This deposit hold was already captured — the money has been taken and no authorisation remains on the card.",
      failed:
        "The card could not be authorised for this deposit hold, so no funds are held. Place a new hold once the customer has a working card on file.",
    };

    return jsonResponse({
      verified: true,
      liveHold: false,
      status: reportStatus(wouldClobber ? currentStatus : trueStatus),
      changed,
      expiresAt: null,
      message: DEAD_HOLD_MESSAGES[trueStatus] ?? `The deposit hold is ${trueStatus} at Stripe.`,
    });
  } catch (error: any) {
    console.error("[HOLD-VERIFY] Error:", error);
    return errorResponse(error.message, 500);
  }
});
