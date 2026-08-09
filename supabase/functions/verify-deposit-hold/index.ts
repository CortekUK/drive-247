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
  readHoldCaptureFacts,
  chainExpiryFromEndDate,
  TENANT_STRIPE_COLUMNS,
  type StripeMode,
} from "../_shared/stripe-client.ts";
import { authorizeDepositHoldRequest } from "../_shared/deposit-hold-auth.ts";

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

// ── Who may run a verification ─────────────────────────────────────────────
//
// This endpoint WRITES: it corrects rentals.deposit_hold_status, re-stamps the
// expiry/verified clocks and pushes the chain bound forward. Moving a row off
// 'held' is exactly what unblocks placement — i.e. what permits a fresh
// authorisation on a renter's card — so it is an editor action, and client-side
// gating (useManagerPermissions().canEdit) is UX, never an authorisation
// boundary.
//
// The server-side decision lives in `authorizeDepositHoldRequest`
// (_shared/deposit-hold-auth.ts), shared with capture-deposit-hold,
// place-deposit-hold, create-hold-checkout and release-deposit-hold so all five
// money paths admit exactly the same people: active staff of the RENTAL'S OWN
// tenant holding head_admin / admin / ops, a manager with an editor grant on the
// rentals tab, any super admin, or a trusted machine caller. A viewer is
// refused, and so is any role nobody has thought about yet. This function passes
// none of the widening options — no renter and no unidentified caller may ever
// verify a hold.

type CaptureFacts = Awaited<ReturnType<typeof readHoldCaptureFacts>>;

/**
 * Read the REAL capture deadline (and the window the network granted) off the
 * authorising charge, or null when Stripe has not published one.
 *
 * Deliberately NOT _shared/stripe-client.ts's resolveHoldExpiry /
 * resolveHoldExpiryDetailed: those layer a `now + HOLD_EXPIRY_FALLBACK_DAYS`
 * floor on top, and that value MOVES on every call. Persisting it here would
 * re-arm deposit_hold_expires_at on every verify, and refresh-deposit-holds
 * selects rentals to re-authorise with
 * `.lt('deposit_hold_expires_at', now + 2 days)` — so a frequently-verified
 * rental could NEVER enter the refresh window and its hold would die unnoticed
 * at the real deadline. That is precisely the GMT incident this function exists
 * to prevent, so we use the no-fallback reader and the caller leaves the stored
 * value alone on null.
 */
async function readCaptureFacts(
  stripe: ReturnType<typeof getStripeClientForRecord>,
  intent: any,
  stripeOptions: { stripeAccount?: string } | undefined
): Promise<CaptureFacts> {
  try {
    return await readHoldCaptureFacts(stripe, intent, stripeOptions);
  } catch (err) {
    console.warn("[HOLD-VERIFY] Could not read capture_before; leaving stored expiry untouched:", err);
    return null;
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

    const { rentalId } = await req.json();
    if (!rentalId) {
      return errorResponse("Missing required field: rentalId");
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    // verify_jwt = true only proves the caller holds *a* session on this
    // Supabase project — and booking-app CUSTOMERS authenticate against the same
    // project. This endpoint writes deposit state, so it must additionally
    // prove the caller is staff of the rental's own tenant.
    //
    // The decision itself is `authorizeDepositHoldRequest` in
    // _shared/deposit-hold-auth.ts, shared with capture-deposit-hold,
    // place-deposit-hold, create-hold-checkout and release-deposit-hold. This was
    // inline until those four were fixed; extracting it is what stops the five
    // money paths drifting apart. Behaviour is unchanged for this function: an
    // active staff member of the RENTAL'S OWN tenant with a write role, a super
    // admin, or a trusted machine caller. No renter and no unidentified caller —
    // this call site passes neither widening option.
    //
    // Runs before the rental read, so a refusal costs one lookup and leaks
    // nothing. The guard resolves the rental's tenant itself in order to compare.
    const auth = await authorizeDepositHoldRequest(req, supabase, {
      rentalId,
      logPrefix: "[HOLD-VERIFY]",
    });
    if (!auth.ok) return errorResponse(auth.message, auth.status);

    // deposit_hold_links.actor: the app_user id when a human asked, a plain
    // label when another edge function or the reconciler did. Unchanged from the
    // inline version — the machine callers here are all reconciliation jobs.
    const actor = auth.caller.kind === "staff" ? auth.caller.actor : "reconciler";

    const { data: rental, error: rentalError } = await supabase
      .from("rentals")
      .select(
        "id, tenant_id, end_date, deposit_hold_payment_intent_id, deposit_hold_status, deposit_hold_expires_at, deposit_hold_chain_expires_at, platform_account, deposit_hold_attempt_seq"
      )
      .eq("id", rentalId)
      .single();

    if (rentalError || !rental) {
      return errorResponse("Rental not found", 404);
    }

    // Belt-and-braces on the tenant boundary the guard already enforced against
    // its own read of this rental. Cheap, and it means a future edit that lets a
    // caller name a different rental than the one authorised cannot go unnoticed.
    if (auth.rental.id !== (rental.id as string) || auth.rental.tenant_id !== rental.tenant_id) {
      console.error("[HOLD-VERIFY] Authorised rental does not match the rental read; refusing.");
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

    // Which link of the chain this verify is reporting on.
    const attemptSeq = Number((rental as any).deposit_hold_attempt_seq ?? 0);

    /**
     * LEDGER: record what Stripe said about this link.
     *
     * UPSERT, not insert: deposit_hold_links is UNIQUE on
     * (rental_id, attempt_seq, action), and a verify can be run any number of
     * times against one attempt — an operator clicking "Check with Stripe"
     * twice must not error, and an unbounded row per click would bury the
     * placement/refresh rows that matter. So the row means "the LATEST verify
     * of this link": created_at is deliberately not written, so it keeps the
     * first verify's timestamp while completed_at tracks the most recent.
     *
     * FULL REPLACEMENT, not a partial merge. A PostgREST merge-duplicates
     * upsert only overwrites the columns present in the payload, and the call
     * sites carry different key sets — so a rental that once failed a verify
     * and later verifies cleanly would end up with `outcome: 'succeeded'`
     * sitting next to a stale `error_code: 'resource_missing'`, or a dead
     * hold's row still carrying the previous run's `capture_before`. Every
     * mutable column is therefore defaulted to null here and each call site
     * overrides only what it actually observed, so one upsert fully replaces
     * the prior verify observation. (created_at is deliberately never written:
     * the row keeps the first verify's timestamp while completed_at tracks the
     * most recent.)
     *
     * Non-fatal throughout: an audit write must never turn a successful
     * reconciliation into a 500 — and supabase-js REJECTS on a transport
     * failure rather than resolving with `{ error }`, so both are swallowed.
     */
    const recordVerify = async (fields: Record<string, unknown>) => {
      try {
        const { error } = await supabase
          .from("deposit_hold_links")
          .upsert(
            {
              rental_id: rentalId,
              tenant_id: rental.tenant_id,
              attempt_seq: attemptSeq,
              action: "verify",
              payment_intent_id: probedPiId,
              platform_account: (rental as any).platform_account ?? null,
              actor,
              completed_at: new Date().toISOString(),
              // Mutable set — every call site replaces the lot.
              connect_account_id: null,
              stripe_mode: null,
              capture_before: null,
              extended_auth_status: null,
              outcome: null,
              error_code: null,
              error_message: null,
              estimate_inputs: null,
              ...fields,
            },
            { onConflict: "rental_id,attempt_seq,action" }
          );
        if (error) console.error("[HOLD-VERIFY] Failed to write deposit_hold_links row (continuing):", error);
      } catch (ledgerErr) {
        console.error("[HOLD-VERIFY] deposit_hold_links upsert threw (continuing):", ledgerErr);
      }
    };

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
      await recordVerify({
        outcome: "failed",
        error_code: "stripe_context_unresolvable",
        error_message: "Could not resolve a Stripe client/account for this rental; nothing was checked or changed.",
        estimate_inputs: { hold_status_before: currentStatus, checked: false },
      });
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
        await recordVerify({
          connect_account_id: connectAccountId,
          outcome: "orphaned",
          error_code: "resource_missing",
          error_message: `Stripe has no record of ${probedPiId} on ${connectAccountId ?? "(platform)"}.`,
          estimate_inputs: { hold_status_before: currentStatus, checked: true },
        });
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

    // "We consulted Stripe at this instant", and nothing else. Anchored to the
    // same row identity as casUpdate so it can never land on a row that has
    // moved on, but a 0-row result is NOT an error here: there is no state
    // being corrected, so losing the race costs only a timestamp.
    const stampVerifiedAt = async (extra: Record<string, unknown> = {}) => {
      try {
        let query = supabase
          .from("rentals")
          .update({ deposit_hold_verified_at: new Date().toISOString(), ...extra })
          .eq("id", rentalId)
          .eq("deposit_hold_payment_intent_id", probedPiId);
        query = currentStatus === null
          ? query.is("deposit_hold_status", null)
          : query.eq("deposit_hold_status", currentStatus);
        const { error } = await query;
        // supabase-js resolves rather than throwing, so an unchecked write here
        // would silently leave deposit_hold_verified_at looking like "never".
        if (error) console.error("[HOLD-VERIFY] Could not stamp deposit_hold_verified_at:", error);
      } catch (stampErr) {
        // ...and it REJECTS on transport failure. This write corrects nothing,
        // so it must never turn a good reconciliation into a 500.
        console.error("[HOLD-VERIFY] deposit_hold_verified_at stamp threw (continuing):", stampErr);
      }
    };

    // ── Chain bound: re-stamp FORWARD from the rental's LIVE end date. ───────
    //
    // rentals.deposit_hold_chain_expires_at is written once, at placement, from
    // the end_date as it stood then — and refresh-deposit-holds treats it as a
    // HARD STOP (both in its driver filter and in refreshOneHold). Extending a
    // rental moves end_date but does not re-place the hold, so without this the
    // chain terminates on the ORIGINAL end date and the deposit quietly stops
    // being renewed while the car is still out. That is near-certain for a
    // fleet of manually-extended rentals.
    //
    // FORWARD ONLY, deliberately. Moving the bound out is always safe (the
    // refresher just keeps renewing a hold on a rental that is still running,
    // and status/'Active' filtering plus the operator's release remain the
    // other stops). Moving it IN could terminate a chain that is still needed,
    // so a shortened rental keeps the longer bound until a human releases it.
    // No `now` floor either: re-flooring on every verify would mean the chain
    // never terminates at all.
    const chainRestamp = ((): Record<string, string> => {
      const live = chainExpiryFromEndDate((rental as any).end_date as string | null);
      if (!live) return {};
      const stored = (rental as any).deposit_hold_chain_expires_at as string | null;
      if (!stored) return {}; // NULL already means "no ceiling" — leave it.
      if (new Date(live).getTime() <= new Date(stored).getTime()) return {};
      console.log(
        "[HOLD-VERIFY] Chain bound re-stamped forward on rental", rentalId,
        stored, "->", live, "(rental end date moved)"
      );
      return { deposit_hold_chain_expires_at: live };
    })();

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
      // persist NO DEADLINE in that case (see readCaptureFacts): inventing one
      // would push the rental out of the cron's window on every call.
      const facts = await readCaptureFacts(stripe, intent, stripeOptions);
      const stripeExpiresAt = facts?.captureBefore ?? null;
      const reportedExpiresAt = stripeExpiresAt ?? storedExpiresAt;
      const expiryLabel = stripeExpiresAt ? stripeExpiresAt.slice(0, 10) : null;

      // Written AFTER the write attempt below, so `outcome` describes what
      // actually landed. Recording 'succeeded' up front made the ledger claim a
      // reconciliation that a lost CAS never applied.
      const recordLiveVerify = (extra: Record<string, unknown>) =>
        recordVerify({
          connect_account_id: connectAccountId,
          stripe_mode: ((tenant as any).stripe_mode as string | null) ?? null,
          capture_before: stripeExpiresAt,
          extended_auth_status: facts?.extendedAuthStatus ?? null,
          outcome: "succeeded",
          ...extra,
          estimate_inputs: {
            pi_status: piStatus,
            hold_status_before: currentStatus,
            live_hold: true,
            worker_owns_row: workerOwnsRow,
            window_seconds: facts?.windowSeconds ?? null,
            chain_expires_at_restamped: chainRestamp.deposit_hold_chain_expires_at ?? null,
            ...((extra.estimate_inputs as Record<string, unknown> | undefined) ?? {}),
          },
        });

      if (workerOwnsRow) {
        await recordLiveVerify({ estimate_inputs: { applied: false, reason: "worker_owns_row" } });
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

      // NOT SEEDING A FALLBACK HERE, deliberately.
      //
      // A live hold with a NULL deposit_hold_expires_at used to be invisible to
      // the refresh cron (`.lt()` against NULL is NULL, not true), and the
      // obvious fix is to write our HOLD_EXPIRY_FALLBACK_DAYS floor into the
      // hole. The refresh driver now filters
      // `deposit_hold_expires_at.is.null,deposit_hold_expires_at.lt.<threshold>`
      // and sorts NULL FIRST — NULL means "we do not know this is alive", which
      // is the most urgent state there is. Writing a 4-day floor over it would
      // therefore make the row LESS urgent and push the refresh out by roughly
      // the lookahead. Leaving the value alone is both the safer direction and
      // the one that keeps every persisted expiry Stripe's own answer.
      const changed = currentStatus !== "held" || expiryDrifted;

      if (changed) {
        const patch: Record<string, unknown> = {
          deposit_hold_status: "held",
          deposit_hold_verified_at: new Date().toISOString(),
          // Carried on the same CAS so the chain bound can only move on a row
          // we still own (see chainRestamp above; {} when nothing to move).
          ...chainRestamp,
        };
        // Only stamp the status clock when the status itself moved.
        if (currentStatus !== "held") patch.deposit_hold_status_changed_at = new Date().toISOString();
        // ONLY ever persist a deadline Stripe actually told us — and when we
        // do, label its provenance and record the window the network granted,
        // so nothing downstream has to guess whether the timestamp is real.
        if (stripeExpiresAt !== null) {
          patch.deposit_hold_expires_at = stripeExpiresAt;
          patch.deposit_hold_expiry_source = "stripe_capture_before";
          patch.deposit_hold_extended_auth = facts?.extendedAuth ?? null;
          patch.deposit_hold_window_seconds = facts?.windowSeconds ?? null;
        }
        let applied: boolean;
        try {
          applied = await casUpdate(patch);
        } catch (casErr: any) {
          // casUpdate throws on a DB error. Leave a trace before the 500 —
          // "we consulted Stripe and could not save the answer" is exactly the
          // state this ledger exists to make findable.
          await recordLiveVerify({
            outcome: "failed",
            error_code: "rental_update_failed",
            error_message: String(casErr?.message ?? casErr).slice(0, 500),
            estimate_inputs: { applied: false },
          });
          throw casErr;
        }
        if (!applied) {
          await recordLiveVerify({ estimate_inputs: { applied: false, reason: "lost_race" } });
          return await reportLostRace(true, reportedExpiresAt);
        }
        await recordLiveVerify({ estimate_inputs: { applied: true } });
        console.log(
          "[HOLD-VERIFY] Reconciled", rentalId, currentStatus, "->", "held",
          "expires", stripeExpiresAt ?? "(unchanged)"
        );
      } else {
        // Nothing about the hold changed, but we DID just confirm it against
        // Stripe — record when, so a reconciler can tell "checked, still fine"
        // from "never checked". (workerOwnsRow already returned above, so this
        // branch never touches a row another worker is mid-write on.)
        // Best-effort by design: a 0-row result only means the row moved under
        // us, and there is no state to correct. The chain re-stamp rides along
        // on the same anchored write.
        await stampVerifiedAt(chainRestamp);
        await recordLiveVerify({ estimate_inputs: { applied: false, reason: "no_change" } });
      }

      return jsonResponse({
        verified: true,
        liveHold: true,
        status: "held",
        changed,
        expiresAt: reportedExpiresAt,
        // Only ever 'stripe_capture_before' or null — this function never
        // reports a deadline it invented (there isn't one).
        expirySource: stripeExpiresAt !== null ? "stripe_capture_before" : null,
        extendedAuth: facts?.extendedAuth ?? null,
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
      await recordVerify({
        connect_account_id: connectAccountId,
        stripe_mode: ((tenant as any).stripe_mode as string | null) ?? null,
        outcome: "succeeded",
        estimate_inputs: {
          pi_status: piStatus,
          hold_status_before: currentStatus,
          live_hold: false,
          conclusive: false,
        },
      });
      if (!workerOwnsRow) await stampVerifiedAt();
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

    // Same rule as the live branch: the ledger row is written AFTER the write
    // attempt, so `outcome` and `applied` describe what actually landed.
    const recordDeadVerify = (extra: Record<string, unknown>) =>
      recordVerify({
        connect_account_id: connectAccountId,
        stripe_mode: ((tenant as any).stripe_mode as string | null) ?? null,
        outcome: "succeeded",
        ...extra,
        estimate_inputs: {
          pi_status: piStatus,
          hold_status_before: currentStatus,
          hold_status_after: wouldClobber ? currentStatus : trueStatus,
          live_hold: false,
          conclusive: true,
          would_clobber: wouldClobber,
          ...((extra.estimate_inputs as Record<string, unknown> | undefined) ?? {}),
        },
      });

    if (changed) {
      let applied: boolean;
      try {
        applied = await casUpdate({
          deposit_hold_status: trueStatus,
          deposit_hold_status_changed_at: new Date().toISOString(),
          deposit_hold_verified_at: new Date().toISOString(),
        });
      } catch (casErr: any) {
        await recordDeadVerify({
          outcome: "failed",
          error_code: "rental_update_failed",
          error_message: String(casErr?.message ?? casErr).slice(0, 500),
          estimate_inputs: { applied: false },
        });
        throw casErr;
      }
      if (!applied) {
        await recordDeadVerify({ estimate_inputs: { applied: false, reason: "lost_race" } });
        return await reportLostRace(false, null);
      }
      await recordDeadVerify({ estimate_inputs: { applied: true } });
      console.warn(
        "[HOLD-VERIFY] Stale hold corrected on rental",
        rentalId,
        `${currentStatus} -> ${trueStatus}`,
        "(Stripe PI",
        probedPiId,
        "is",
        piStatus + ")"
      );
    } else if (!workerOwnsRow) {
      // Already recorded correctly (or a 'released' we refuse to downgrade) —
      // still a real Stripe consultation, so the clock moves.
      await stampVerifiedAt();
      await recordDeadVerify({ estimate_inputs: { applied: false, reason: "no_change" } });
    } else {
      await recordDeadVerify({ estimate_inputs: { applied: false, reason: "worker_owns_row" } });
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
