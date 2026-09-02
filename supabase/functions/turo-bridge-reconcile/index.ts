/**
 * turo-bridge-reconcile — decides what a sync run is allowed to BELIEVE, and
 * therefore what it is allowed to CHANGE.
 *
 * ═══ THE ONE ASYMMETRY EVERYTHING HERE IS BUILT ON ══════════════════════════
 *
 *   Acquiring a block is cheap and reversible.
 *   Releasing a block sells the same car twice.
 *
 * A stale block costs one manual unblock. A wrongly-released block puts a
 * customer on a forecourt in front of a car that is physically in another
 * state. Every rule below is that asymmetry applied, and where the two
 * directions conflict, over-blocking always wins.
 *
 * ═══ ABSENCE IS NOT EVIDENCE ════════════════════════════════════════════════
 *
 * A degraded read yields FEWER records, and fewer records is exactly what a
 * cancellation looks like. Cloudflare answering HTTP 200 with a valid empty
 * body, an expired session, a renamed field, a truncated page — all four
 * present identically as "the trip is not in the list any more".
 *
 * So a trip that stops appearing becomes MISSING, which is a SUSPICION. The
 * block stays in force. missing_since and missing_streak accumulate. Nothing is
 * deleted. Holding a block forever is affordable and that is not obvious until
 * you read the availability query: both the booking and portal reads filter
 * `.gte("end_date", today)` (apps/booking/src/hooks/use-vehicle-booked-dates.ts:74),
 * so a stale block ages out of relevance on its own. We never need to delete a
 * block to unblock the future — only to stop extending it.
 *
 * RELEASING requires POSITIVE evidence, graded:
 *   E1  the trip appeared in a read carrying a cancellation status. This is
 *       PRESENCE, not absence, and it is machine-decidable.
 *   E2  a targeted probe of the trip's own URL returned a definite not-found.
 *       CAPABILITY-GATED and currently UNAVAILABLE — the per-trip endpoint is
 *       unconfirmed and we have no Turo account to confirm it against. It is
 *       reported as unavailable rather than approximated.
 *   E3  absence corroborated across >= 3 qualifying runs spanning >= 24h.
 *       This raises a REVIEW ITEM for a human. It is never itself a release,
 *       and the database refuses to accept it as one
 *       (03-foundation-schema.sql §13).
 *   E4  positive re-observation. Reopens from any state, always, no ceremony.
 *   E5  an operator's explicit decision, with their name on it.
 *
 * ═══ THE LIVENESS-PROOF RULE ════════════════════════════════════════════════
 *
 * A run that positively parsed ZERO reservations may never move any row toward
 * MISSING. This single rule neutralises the empty-200, the expired session and
 * the wholesale field rename simultaneously, because all three present as "we
 * parsed nothing". Only a demonstrably working read that shows OTHER trips can
 * cast doubt on THIS trip.
 *
 * It is not enforced here. It is enforced in Postgres: turo_sync_jobs
 * .observed_complete is GENERATED ALWAYS and includes `parsed_count > 0`, so no
 * caller — service_role included — can assert it. This function reads the
 * verdict; it does not compute it.
 *
 * ═══ WHAT THIS FUNCTION MAY NOT DO ══════════════════════════════════════════
 *
 *   - It never DELETEs a turo_bridge_reservations row. There is no delete
 *     statement in this file. (I-1)
 *   - It never UPDATEs or DELETEs a rental, payment or installment. A Turo read
 *     is READ-ONLY toward our own bookings, always. When a Turo trip collides
 *     with a Drive247 rental the system's job is to surface it loudly, not to
 *     pick a winner. (I-11)
 *   - It never deletes a blocked_dates row directly. The only door is
 *     public.turo_release_block(), which re-proves job authority, tenant match,
 *     vehicle observation, window coverage and the 48h hold from scratch —
 *     independently of anything decided here. (03 §7d, §8)
 *   - A row whose source is 'fixture' never produces a block, a release or a
 *     conflict. Demo data staying distinguishable forever is the whole point of
 *     that column. (I-15)
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const TOKEN_MIN_LENGTH = 32;
const TOKEN_MAX_LENGTH = 200;

/** One reconcile pass touches at most this many staged rows. See TRUNCATION. */
const MAX_ROWS = 2000;
/** Per-row writes are serialised in chunks this wide. */
const WRITE_CONCURRENCY = 8;

/**
 * E3's dwell has BOTH a count and an elapsed-time floor. An operator clicking
 * Sync three times during an outage must not be able to manufacture a release,
 * and without the time floor they could.
 */
const E3_MIN_RUNS = 3;
const E3_MIN_ELAPSED_MS = 24 * 60 * 60 * 1000;

/**
 * ⚠ THE CANCELLATION VOCABULARY IS A GUESS, AND IT IS THE DANGEROUS DIRECTION.
 *
 * We have no Turo host account, so these strings come from Turo's public
 * language and from the shapes the two extension scaffolds emit — not from an
 * observed feed. The DEFAULT for anything not on this list is NON-TERMINAL:
 * an unrecognised status leaves the trip OBSERVED and is reported by name in
 * the response, so a vocabulary change shows up as a question rather than as a
 * silent release. The opposite default would release blocks on a string we have
 * never seen.
 */
const CANCELLED_VOCAB = new Set([
  "cancelled", "canceled", "cancellation", "declined", "decline", "rejected",
  "expired", "withdrawn", "voided", "host_cancelled", "hostcancelled",
  "guest_cancelled", "guestcancelled", "renter_cancelled", "cancelled_by_host",
  "cancelled_by_guest", "trip_cancelled",
]);

/**
 * ⚠ 'completed' IS NOT TERMINAL. Guests extend up to 24h AFTER a trip ends and
 * Turo auto-accepts. These statuses therefore mean COMPLETED_HOLD, not CLOSED,
 * and the row is held until ends_at + 48h — 24h for Turo's extension window,
 * plus 24h because MV3 runs nothing while Chrome is quit, so the read that
 * would OBSERVE an extension may simply not happen for a day.
 */
const COMPLETED_VOCAB = new Set([
  "completed", "complete", "ended", "finished", "returned", "checked_out",
  "checkedout", "trip_completed", "past",
]);

/** Statuses that positively mean "still on". Everything else is just unknown. */
const LIVE_VOCAB = new Set([
  "booked", "confirmed", "upcoming", "active", "in_progress", "inprogress",
  "started", "ongoing", "reserved", "accepted", "current",
]);

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function asText(v: unknown, max: number): string | null {
  if (typeof v === "number" || typeof v === "boolean") return String(v).slice(0, max);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}
function normVocab(v: unknown): string | null {
  const s = asText(v, 80);
  return s ? s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") : null;
}
function ms(v: unknown): number | null {
  const s = asText(v, 64);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identical to the resolver in turo-bridge-ingest — see that file's header. */
async function resolvePairing(supabase: SupabaseClient, token: string) {
  const tokenHash = await sha256Hex(token);
  const digest = await supabase
    .from("turo_bridge_tokens").select("id, tenant_id, revoked_at")
    .eq("token_hash", tokenHash).maybeSingle();
  if (!digest.error) return { pairing: digest.data, hardError: null as string | null };
  if (digest.error.code !== "42703") return { pairing: null, hardError: digest.error.message };
  const plain = await supabase
    .from("turo_bridge_tokens").select("id, tenant_id, revoked_at")
    .eq("token", token).maybeSingle();
  if (plain.error) return { pairing: null, hardError: plain.error.message };
  return { pairing: plain.data, hardError: null as string | null };
}

/**
 * Operator identity, for the E5 path only. Resolved from the caller's Supabase
 * JWT via app_users — never from a header, never from the body. `tenants` is not
 * consulted for identity at all.
 */
async function resolveActor(
  supabase: SupabaseClient,
  authHeader: string | null,
): Promise<{ appUserId: string; tenantId: string | null; isSuperAdmin: boolean } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, tenant_id, is_super_admin, is_active")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  if (!appUser || appUser.is_active === false) return null;
  return {
    appUserId: appUser.id as string,
    tenantId: (appUser.tenant_id as string | null) ?? null,
    isSuperAdmin: appUser.is_super_admin === true,
  };
}

// ---------------------------------------------------------------------------
type Staged = {
  id: string;
  reservation_id: string;
  source: string;
  status: string;
  sync_state: string;
  presence_state: string;
  turo_status: string | null;
  turo_vehicle_id: string | null;
  turo_guest_id: string | null;
  guest_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  hold_until: string | null;
  missing_since: string | null;
  missing_streak: number;
  missing_review_raised_at: string | null;
  last_seen_job_id: string | null;
  first_seen_job_id: string | null;
  vehicle_map_id: string | null;
  matched_vehicle_id: string | null;
  blocked_date_id: string | null;
  promoted_rental_id: string | null;
  superseded_by_reservation_id: string | null;
};

type Action = {
  reservation_id: string;
  row_id: string;
  from: string;
  to: string | null;
  evidence: string;
  applied: boolean;
  refused_because?: string;
  note?: string;
};

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("Method not allowed. POST a JSON body.", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[TURO-RECONCILE] Missing Supabase environment configuration");
    return errorResponse("Server is not configured.", 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body must be JSON.", 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- tenant resolution -------------------------------------------------
  // TWO doors, and NEITHER of them is the request body. The extension presents
  // a pairing token; the portal presents the operator's JWT. Whichever arrives,
  // tenant_id comes from a server-side row. If both arrive they must agree —
  // one Chrome profile can be paired to two Drive247 tenants over its life, and
  // reconciling A's trips under B's tenant is unrecoverable once written.
  const token = asText(body.token ?? body.pairing_token ?? body.pairingToken, 300);
  const actor = await resolveActor(supabase, req.headers.get("Authorization"));

  let tenantId: string | null = null;
  let tokenId: string | null = null;

  if (token) {
    if (token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH) {
      return errorResponse("Pairing token not recognised.", 401);
    }
    const { pairing, hardError } = await resolvePairing(supabase, token);
    if (hardError) {
      console.error("[TURO-RECONCILE] token lookup failed:", hardError);
      return errorResponse("Could not verify the pairing token.", 500);
    }
    if (!pairing) return errorResponse("Pairing token not recognised.", 401);
    if (pairing.revoked_at) return errorResponse("This pairing token has been revoked.", 401);
    tenantId = pairing.tenant_id as string;
    tokenId = pairing.id as string;
  }

  if (actor && !actor.isSuperAdmin) {
    if (tenantId && actor.tenantId !== tenantId) {
      // The worst outcome in this system, refused rather than warned about.
      return errorResponse(
        "This pairing token belongs to a different Drive247 account than the one you are signed into.",
        403,
      );
    }
    tenantId = tenantId ?? actor.tenantId;
  }

  if (!tenantId) {
    return errorResponse(
      "Provide a pairing token in the body, or call this as a signed-in portal user.",
      401,
    );
  }

  const action = asText(body.action, 40) ?? "reconcile";
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  // =========================================================================
  // E5 — THE OPERATOR RELEASE. The single most dangerous button in the feature.
  //
  // An operator who has just cancelled a trip inside the Turo UI holds
  // knowledge the system does not, and forcing them to wait 24h for E3 is how
  // a car sits unsellable for a day it was available. So this exists — but it
  // costs a signed-in named human, an exact typed confirmation of the
  // reservation id, and a row that is ALREADY MISSING. It is not available on a
  // trip we can still see in the feed: if Turo is still showing it, releasing
  // its block is precisely the double-sell.
  // =========================================================================
  if (action === "operator_release") {
    if (!actor) {
      return errorResponse(
        "Releasing a booking by hand requires a signed-in Drive247 user — this decision gets a name on it.",
        401,
      );
    }
    const rowId = asText(body.reservation_row_id, 64);
    const typed = asText(body.confirm_reservation_id, 200);
    const note = asText(body.note, 500);
    if (!rowId) return errorResponse("`reservation_row_id` is required.", 400);

    const { data: row, error: rowError } = await supabase
      .from("turo_bridge_reservations")
      .select("id, tenant_id, reservation_id, source, presence_state, sync_state, blocked_date_id, missing_since, missing_streak")
      .eq("id", rowId).eq("tenant_id", tenantId).maybeSingle();
    if (rowError) return errorResponse("Could not read that booking.", 500);
    if (!row) return errorResponse("Unknown booking.", 404);

    if (typed !== row.reservation_id) {
      return errorResponse(
        `Type the Turo reservation id (${row.reservation_id}) to confirm. Releasing the wrong booking puts a car back on sale while it is out on rent.`,
        400,
      );
    }
    if (row.presence_state !== "MISSING") {
      return errorResponse(
        `This booking is currently ${row.presence_state}. Only a booking that has already stopped appearing in Turo can be released by hand — if Turo is still showing it, releasing its block would double-sell the car.`,
        409,
      );
    }

    const evidence = {
      class: "E5",
      actor_app_user_id: actor.appUserId,
      at: nowIso,
      note,
      missing_since: row.missing_since,
      missing_streak: row.missing_streak,
    };
    const { error: upErr } = await supabase
      .from("turo_bridge_reservations")
      .update({
        presence_state: "RELEASED_BY_OPERATOR",
        release_evidence: evidence,
        presence_reason: `released by operator ${actor.appUserId}`,
        updated_at: nowIso,
      })
      .eq("id", rowId).eq("tenant_id", tenantId);
    if (upErr) return errorResponse(upErr.message, 409);

    // The block, if there is one, still goes through the one door — and that
    // door re-proves job authority independently. An operator saying "it's
    // gone" moves OUR record; it does not manufacture evidence about the read.
    let blockReleased = false;
    let blockNote: string | null = null;
    if (row.blocked_date_id && row.source !== "fixture") {
      const jobId = asText(body.job_id, 64);
      if (!jobId) {
        blockNote = "The availability block was kept: releasing it needs the id of a clean read that covers this trip.";
      } else {
        // ⚠ THE CITED JOB IS A REQUEST PARAMETER. Unlike the reconcile path
        // above, this id did not come from a run we just qualified — it came
        // out of the body, chosen by whatever the portal happened to offer.
        // Check it HERE, before the RPC, for two reasons:
        //
        //  (1) TENANT. turo_release_block compares the job's tenant to the
        //      BLOCK's tenant, which is right but arrives as a raw 23514. A
        //      job id belonging to another operator must read as "not
        //      recognised" and teach the caller nothing about whether it
        //      exists.
        //
        //  (2) LIVENESS. observed_complete = is_authoritative AND
        //      parsed_count > 0. A run can finish cleanly having parsed NOTHING
        //      — the WAF answering the trips feed HTTP 200 with an empty body,
        //      while /api/vehicles/me answers normally so the run still names
        //      every vehicle it "observed". Citing that run is absence
        //      releasing a car. The RPC now refuses it too; this makes the
        //      refusal legible instead of a constraint-violation string.
        const { data: citedJob, error: citedErr } = await supabase
          .from("turo_sync_jobs")
          .select("id, tenant_id, observed_complete, is_authoritative, parsed_count, completeness, degraded_reason")
          .eq("id", jobId)
          .maybeSingle();

        if (citedErr) {
          blockNote = "The availability block was kept: we could not verify the read you cited.";
        } else if (!citedJob || citedJob.tenant_id !== tenantId) {
          blockNote = "The availability block was kept: that sync run is not recognised on this account.";
        } else if (citedJob.observed_complete !== true) {
          blockNote = (citedJob.parsed_count ?? 0) === 0
            ? "The availability block was kept: the sync you cited finished without reading a single trip, so it cannot tell the difference between 'this booking is gone' and 'Turo showed us nothing'. Run a sync that reads your other trips, then try again."
            : `The availability block was kept: the sync you cited was ${citedJob.completeness ?? "partial"}, so it does not prove this booking has gone.`;
        } else {
          const { data: released, error: relErr } = await supabase
            .rpc("turo_release_block", { p_block_id: row.blocked_date_id, p_job_id: jobId });
          if (relErr) blockNote = `The availability block was kept: ${relErr.message}`;
          else blockReleased = released === true;
        }
      }
    }

    return jsonResponse({
      ok: true,
      action: "operator_release",
      reservation_id: row.reservation_id,
      presence_state: "RELEASED_BY_OPERATOR",
      block_released: blockReleased,
      note: blockNote,
    });
  }

  // =========================================================================
  // THE THREE SAFE ANSWERS.
  //
  // A cancellation candidate has four possible replies and only ONE of them can
  // put a car back on sale. That one is `operator_release` above, and it costs a
  // typed reservation id and a cited authoritative run. These three cost a
  // signed-in human and nothing else, because NONE OF THEM CAN REMOVE A BLOCK:
  //
  //   keep_block  the operator is not sure — leave everything exactly as it is
  //               and write down that they looked. NO state change at all.
  //   reinstate   "this trip is still on". Positive information, and the row
  //               goes back to staged / OBSERVED. Re-blocking is the cheap
  //               direction; that is why §13 permits it from every state.
  //   ignore      "stop asking me". The row leaves the queue and THE BLOCK
  //               STAYS — sync_state 'ignored' says nothing about presence.
  //
  // The worst outcome any of them can produce is a block that outlives the trip,
  // and that ages out on its own: every availability read filters on end_date.
  // =========================================================================
  if (action === "operator_resolve") {
    if (!actor) {
      return errorResponse(
        "Answering a cancellation question requires a signed-in Drive247 user — this decision gets a name on it.",
        401,
      );
    }
    const rowId = asText(body.reservation_row_id, 64);
    const resolution = asText(body.resolution, 30);
    const note = asText(body.note, 500);
    if (!rowId) return errorResponse("`reservation_row_id` is required.", 400);
    if (resolution === "release") {
      // Belt and braces: a release routed here would skip the typed
      // confirmation and the MISSING precondition entirely.
      return errorResponse(
        "A release must be sent as action 'operator_release' — it needs the typed reservation id and a cited run.",
        400,
      );
    }
    if (!resolution || !["keep_block", "reinstate", "ignore"].includes(resolution)) {
      return errorResponse("`resolution` must be one of: keep_block, reinstate, ignore.", 400);
    }

    const { data: row, error: rowError } = await supabase
      .from("turo_bridge_reservations")
      .select("id, tenant_id, reservation_id, sync_state, presence_state, matched_vehicle_id, vehicle_map_id")
      .eq("id", rowId).eq("tenant_id", tenantId).maybeSingle();
    if (rowError) return errorResponse("Could not read that booking.", 500);
    // A row id belonging to another tenant is simply not found. Cross-tenant
    // probing learns nothing from the difference.
    if (!row) return errorResponse("Unknown booking.", 404);

    const patch: Record<string, unknown> = { updated_at: nowIso };

    if (resolution === "keep_block") {
      // Deliberately NOT a state change. "I looked and I am not sure" is not
      // evidence about the trip, so it must not move the row.
      patch.state_reason = note
        ? `kept blocked by ${actor.appUserId}: ${note}`
        : `kept blocked by ${actor.appUserId}`;
    } else if (resolution === "reinstate") {
      if (!row.matched_vehicle_id || !row.vehicle_map_id) {
        // turo_bridge_reservations_staged_needs_vehicle. Said in words here
        // rather than surfaced as a raw 23514 from the constraint.
        return errorResponse(
          "This booking is not matched to one of your cars yet, so it cannot go back to the staged list. Map the vehicle first.",
          409,
        );
      }
      patch.sync_state = "staged";
      patch.state_reason = `reinstated by ${actor.appUserId}${note ? `: ${note}` : ""}`;
      // The §13 trigger clears missing_since / missing_streak on a return to
      // OBSERVED; we clear the evidence pointer for the same reason ingest does,
      // so a later candidate cannot be admitted on a read since contradicted.
      patch.missing_evidence_job_id = null;
      if (row.presence_state === "MISSING") {
        patch.presence_state = "OBSERVED";
        patch.presence_reason = `operator ${actor.appUserId} confirmed the trip is still on`;
      }
    } else {
      // ignore — turo_bridge_reservations_ignored_needs_human requires BOTH.
      patch.sync_state = "ignored";
      patch.ignored_by = actor.appUserId;
      patch.ignored_at = nowIso;
      patch.ignore_reason = note ?? "dismissed by the operator";
      patch.state_reason = `ignored by ${actor.appUserId}`;
    }

    const { error: upErr } = await supabase
      .from("turo_bridge_reservations")
      .update(patch)
      .eq("id", rowId).eq("tenant_id", tenantId);
    if (upErr) {
      // 23514 is one of the state-machine guards in §13 refusing the move. Its
      // message names the transition, which is more use than anything we could
      // paraphrase.
      return errorResponse(upErr.message, upErr.code === "23514" ? 409 : 500);
    }

    return jsonResponse({
      ok: true,
      action: "operator_resolve",
      resolution,
      reservation_id: row.reservation_id,
      sync_state: (patch.sync_state as string) ?? row.sync_state,
      presence_state: (patch.presence_state as string) ?? row.presence_state,
      // Stated on EVERY one of the three, because "I clicked the button and the
      // car is still blocked" must never read as a failure.
      block_released: false,
      note: "No availability block was released. None of these answers can release one.",
    });
  }

  // =========================================================================
  // RECONCILE A RUN
  // =========================================================================
  const jobId = asText(body.job_id ?? body.run_id, 64);
  if (!jobId) return errorResponse("`job_id` is required.", 400);
  const dryRun = body.dry_run === true;

  const { data: job, error: jobError } = await supabase
    .from("turo_sync_jobs")
    .select(
      "id, tenant_id, job_kind, source, state, degraded, degraded_reason, reader_outcome, " +
      "is_authoritative, observed_complete, completeness, parsed_count, raw_item_count, " +
      "records_seen, records_ingested, observed_from, observed_to, window_start, window_end, " +
      "observed_turo_vehicle_ids, saw_end_of_feed, finished_at, started_at",
    )
    .eq("id", jobId).eq("tenant_id", tenantId).maybeSingle();

  if (jobError) {
    console.error("[TURO-RECONCILE] job read failed:", jobError.message);
    return errorResponse("Could not read the sync run.", 500);
  }
  if (!job) return errorResponse("Unknown sync run.", 404);

  if (job.state === "running") {
    // Reconciling an open run would read a half-written window as a whole one.
    return errorResponse(
      "That sync is still running. Reconcile it once it has finished — a half-finished read cannot be used to conclude anything.",
      409,
    );
  }

  // ---- RUN QUALIFICATION -------------------------------------------------
  // Read, never computed. observed_complete and is_authoritative are GENERATED
  // ALWAYS columns; that is what makes them worth trusting.
  const qualifying = job.observed_complete === true && job.is_authoritative === true;

  const report: Record<string, unknown> = {
    ok: true,
    job_id: jobId,
    dry_run: dryRun,
    run: {
      state: job.state,
      reader_outcome: job.reader_outcome,
      completeness: job.completeness,
      degraded: job.degraded,
      degraded_reason: job.degraded_reason,
      parsed_count: job.parsed_count,
      records_seen: job.records_seen,
      observed_from: job.observed_from,
      observed_to: job.observed_to,
      qualifying,
    },
    // E2 ships as UNAVAILABLE rather than approximated. Saying so out loud is
    // the point: an operator waiting on a cancellation deserves to know the
    // fast path does not exist yet, instead of wondering why nothing happened.
    evidence_available: { E1: true, E2: false, E3: true, E4: true, E5: true },
    e2_unavailable_because:
      "Turo's per-trip detail endpoint is unconfirmed — we have no Turo host account to confirm it against — so a targeted 'is this trip gone?' probe is not implemented. It is not approximated.",
  };

  if (!qualifying) {
    // ⚠ A DEGRADED RUN WRITES NOTHING. Not one presence transition, not one
    //   conflict, not one block. Its own row already records the failure; that
    //   is the whole of its effect.
    report.concluded = "nothing";
    report.reason = !job.observed_complete
      ? (job.parsed_count === 0
          ? "This read returned no usable bookings at all. A valid-but-empty response is indistinguishable from Turo's bot protection answering with nothing, so it was not used to conclude anything."
          : "This read could not prove it reached the end of the feed, so a booking missing from it may simply be on a page we never got.")
      : "This read was marked degraded.";
    report.blocks_touched = 0;
    report.transitions = [];
    report.advice = "Nothing changed and no availability was released. Existing blocks are all still in force.";
    console.log(`[TURO-RECONCILE] run ${jobId} not qualifying (${job.completeness}/${job.degraded_reason}) — concluded nothing`);
    return jsonResponse(report);
  }

  const observedFromMs = ms(job.observed_from);
  const observedToMs = ms(job.observed_to);
  if (observedFromMs === null || observedToMs === null) {
    // Belt and braces: observed_complete implies both are set, but a schema
    // that has drifted must not become a licence to conclude.
    report.concluded = "nothing";
    report.reason = "The run reports no observed window, so it proves coverage of nothing.";
    return jsonResponse(report);
  }

  const observedVehicles = new Set<string>(
    Array.isArray(job.observed_turo_vehicle_ids) ? job.observed_turo_vehicle_ids as string[] : [],
  );

  // ---- load the tenant's staged rows -------------------------------------
  const { data: rowsRaw, error: rowsError } = await supabase
    .from("turo_bridge_reservations")
    .select(
      "id, reservation_id, source, status, sync_state, presence_state, turo_status, turo_vehicle_id, " +
      "turo_guest_id, guest_name, starts_at, ends_at, hold_until, missing_since, missing_streak, " +
      "missing_review_raised_at, last_seen_job_id, first_seen_job_id, vehicle_map_id, matched_vehicle_id, " +
      "blocked_date_id, promoted_rental_id, superseded_by_reservation_id",
    )
    .eq("tenant_id", tenantId)
    .order("starts_at", { ascending: true })
    .limit(MAX_ROWS + 1);

  if (rowsError) {
    console.error("[TURO-RECONCILE] staged read failed:", rowsError.message);
    return errorResponse("Could not read the staged bookings.", 500);
  }

  const all = (rowsRaw ?? []) as unknown as Staged[];
  // TRUNCATION. If we could not see every staged row, we cannot claim that a
  // row's absence from this run is meaningful — the row might simply be past
  // our own page limit. So a truncated LOAD disables the absence pass entirely,
  // exactly as a truncated READ does.
  const loadTruncated = all.length > MAX_ROWS;
  const rows = loadTruncated ? all.slice(0, MAX_ROWS) : all;

  const seenThisRun = rows.filter((r) => r.last_seen_job_id === jobId);
  const newThisRun = rows.filter((r) => r.first_seen_job_id === jobId);
  const sawTrips = seenThisRun.length > 0;

  const actions: Action[] = [];
  const unrecognisedStatuses = new Map<string, number>();
  const conflictsToRaise: Record<string, unknown>[] = [];

  // =========================================================================
  // PASS 1 — WHAT WE POSITIVELY SAW. Presence, not absence.
  // =========================================================================
  type Plan = { row: Staged; to: string; evidence: Record<string, unknown> | null; reason: string };

  // ⚠ ONE PLAN PER ROW, AND THE STRONGER CONCLUSION WINS.
  //
  // Pass 1 and the hold-expiry pass below BOTH walk seenThisRun, so a row that
  // is already COMPLETED_HOLD and still reads 'completed' with an expired hold
  // used to collect two plans — COMPLETED_HOLD and CLOSED. The apply step runs
  // plans CONCURRENTLY (inChunks -> Promise.all), so whichever landed second
  // decided the outcome: CLOSED -> COMPLETED_HOLD is an illegal transition
  // (03 §13) and would be refused, meaning a trip closed or failed to close
  // depending on socket ordering. Ranked and deduped here instead.
  //
  // A "transition" to the state a row is already in is dropped outright. The
  // §13 trigger no-ops it anyway, but emitting it inflates the counters an
  // operator reads — and a row reported as "cancelled by Turo" on every
  // subsequent sync is a report that stops being believed.
  const PLAN_RANK: Record<string, number> = {
    OBSERVED: 1, COMPLETED_HOLD: 2, CANCELLED: 3, CLOSED: 4,
  };
  const planByRow = new Map<string, Plan>();
  const addPlan = (p: Plan): void => {
    if (p.row.presence_state === p.to) return;
    const held = planByRow.get(p.row.id);
    if (held && (PLAN_RANK[held.to] ?? 0) >= (PLAN_RANK[p.to] ?? 0)) return;
    planByRow.set(p.row.id, p);
  };

  for (const row of seenThisRun) {
    const vocab = normVocab(row.turo_status);

    if (vocab && CANCELLED_VOCAB.has(vocab)) {
      // E1. This is PRESENCE — the trip is in the feed, wearing a cancellation.
      addPlan({
        row, to: "CANCELLED",
        evidence: { class: "E1", job_id: jobId, turo_status: row.turo_status, at: nowIso },
        reason: `Turo reported this trip as '${row.turo_status}'`,
      });
      continue;
    }

    if (vocab && COMPLETED_VOCAB.has(vocab)) {
      // NOT terminal. Held to ends_at + 48h; only a LATER qualifying run that
      // still shows it complete may close it, and the database refuses CLOSED
      // inside the hold regardless.
      addPlan({ row, to: "COMPLETED_HOLD", evidence: null, reason: `Turo reported '${row.turo_status}'; held for late extensions` });
      continue;
    }

    if (vocab && !LIVE_VOCAB.has(vocab)) {
      // A status we have never seen. Treated as NON-TERMINAL and reported by
      // name. This is the vocabulary guess failing SAFE.
      unrecognisedStatuses.set(row.turo_status ?? vocab, (unrecognisedStatuses.get(row.turo_status ?? vocab) ?? 0) + 1);
    }

    if (row.presence_state !== "OBSERVED") {
      // E4. Re-observation reopens from anything, including CLOSED and
      // CANCELLED. Closed means closed, not forgotten.
      addPlan({ row, to: "OBSERVED", evidence: null, reason: "seen again in a clean read" });
    }
  }

  // ---- COMPLETED_HOLD rows whose hold has expired ------------------------
  // CLOSED needs the hold to have expired AND a later qualifying run to have
  // seen it. Elapsed time alone is never enough: for an operator who syncs
  // weekly, "48h have passed" happens with no read behind it at all.
  for (const row of seenThisRun) {
    if (row.presence_state !== "COMPLETED_HOLD") continue;
    const holdMs = ms(row.hold_until);
    const vocab = normVocab(row.turo_status);
    const stillComplete = vocab !== null && COMPLETED_VOCAB.has(vocab);
    if (stillComplete && holdMs !== null && nowMs >= holdMs) {
      addPlan({
        row, to: "CLOSED",
        evidence: { class: "E1", job_id: jobId, turo_status: row.turo_status, at: nowIso },
        reason: "trip finished, the 48h extension hold has passed, and a clean read still shows it finished",
      });
    }
  }

  // Materialised only now, so both producing passes have had their say and
  // every downstream reader (PASS 2's already-decided test, the dry-run
  // counters, the apply loop and the release path) sees ONE plan per row.
  const plans: Plan[] = [...planByRow.values()];

  // =========================================================================
  // PASS 2 — ABSENCE. Produces MISSING, and MISSING ONLY.
  // =========================================================================
  const missingNow: Staged[] = [];

  if (!sawTrips) {
    // Cannot happen for a qualifying run (parsed_count > 0 is baked into the
    // generated column) unless every parsed trip was rejected downstream.
    // Refuse to conclude anyway — belt and braces on the rule that matters most.
    report.absence_pass = "skipped: this run matched no staged bookings at all, so its silence about any one booking means nothing";
  } else if (loadTruncated) {
    report.absence_pass = `skipped: more than ${MAX_ROWS} staged bookings exist, so this pass could not see them all`;
  } else if (observedVehicles.size === 0) {
    // ⚠ A RUN THAT NAMED NO VEHICLES TESTIFIES ABOUT NO VEHICLE.
    //
    // observed_turo_vehicle_ids is NOT NULL DEFAULT '{}' (03 §1) and is NOT part
    // of the observed_complete predicate (03 §10), so a run can qualify while
    // naming nothing — a feed whose trips carry no vehicle id, or a client that
    // never populated the field. The per-row test below is guarded by
    // `observedVehicles.size > 0`, so on an empty set it degrades OPEN and every
    // in-window staged row is marked MISSING at once.
    //
    // Nothing is released by that — the §7 release gate re-proves vehicle
    // observation against the same empty array and `= ANY('{}')` is false, so
    // the database refuses. But it is still wrong, and expensively so: it
    // increments missing_streak on the ENTIRE fleet every run, and after three
    // runs over 24h it raises a `missing_review` conflict on every booking the
    // operator has. A report that says "all 180 of your trips may have been
    // cancelled" is a report that stops being read.
    report.absence_pass =
      "skipped: this run named no Turo vehicles, so it cannot testify that any particular booking is gone";
  } else {
    for (const row of rows) {
      if (row.last_seen_job_id === jobId) continue;                       // seen
      if (plans.some((p) => p.row.id === row.id)) continue;               // already decided
      if (!["OBSERVED", "COMPLETED_HOLD", "QUARANTINED"].includes(row.presence_state)) continue;

      const s = ms(row.starts_at);
      const e = ms(row.ends_at);
      // A trip with no window cannot be tested for containment, so its absence
      // carries no information. Leave it exactly where it is.
      if (s === null || e === null) continue;
      // ⚠ WINDOW CONTAINMENT. A trip months outside what this run read is not
      //   missing — it was never in scope. Without this test every long-range
      //   booking would go MISSING on every sync.
      if (s < observedFromMs || e > observedToMs) continue;
      // Silence about a car we never looked at is not a statement about that
      // car. Mirrors rule 3 of the release gate in 03 §7.
      //
      // ⚠ Both halves fail CLOSED, which is the correction. This previously read
      // `row.turo_vehicle_id && observedVehicles.size > 0 && !has(...)`, so a row
      // with no turo_vehicle_id skipped the test and went MISSING. A booking we
      // cannot even name a car for is the LEAST evidenced row in the table, not
      // the most: rule 3 of the release gate coalesces exactly this to NULL and
      // refuses, so marking it MISSING only ever produces a conflict the
      // database will not honour. (`observedVehicles.size === 0` is handled
      // above, for the whole pass.)
      if (!row.turo_vehicle_id) continue;
      if (!observedVehicles.has(row.turo_vehicle_id)) continue;

      missingNow.push(row);
    }
  }

  // =========================================================================
  // PASS 3 — SUCCESSION. A trip that came back under a NEW id has not vanished.
  //
  // Evaluated ONLY inside one qualifying run, so a truncated read can never
  // manufacture a false succession. Both sides must be visible to the same
  // clean read.
  // =========================================================================
  const supersededBy = new Map<string, { successor: Staged; score: number }>();

  for (const gone of missingNow) {
    let best: { successor: Staged; score: number } | null = null;
    for (const cand of newThisRun) {
      if (cand.id === gone.id) continue;
      const score = successionScore(gone, cand);
      if (score > 0 && (!best || score > best.score)) best = { successor: cand, score };
    }
    if (!best) continue;

    if (best.score >= 0.85) {
      supersededBy.set(gone.id, best);
    } else if (best.score >= 0.60) {
      // Ambiguous identity goes to a human, never to a guess. BOTH rows keep
      // their blocks in the meantime — over-blocking one car briefly is the
      // safe error; a gap is not.
      conflictsToRaise.push({
        tenant_id: tenantId,
        reservation_row_id: gone.id,
        job_id: jobId,
        kind: "succession_ambiguous",
        severity: "review",
        detail: {
          candidate_reservation_id: best.successor.reservation_id,
          candidate_row_id: best.successor.id,
          score: Number(best.score.toFixed(2)),
          note: "This booking disappeared and a similar new one appeared in the same read. They may be the same trip reissued. Both are still blocking their dates until you decide.",
        },
      });
    }
  }

  // =========================================================================
  // PASS 4 — VEHICLE MOVED. A Turo agent can move a trip to a different car.
  // Detected against the CONFIRMED mapping, because ingest has already
  // overwritten the raw field by the time we get here.
  // =========================================================================
  const mapIds = [...new Set(rows.map((r) => r.vehicle_map_id).filter((v): v is string => !!v))];
  const mapById = new Map<string, { turo_vehicle_id: string | null; vehicle_id: string }>();
  if (mapIds.length > 0) {
    const { data: maps } = await supabase
      .from("turo_vehicle_map")
      .select("id, turo_vehicle_id, vehicle_id")
      .eq("tenant_id", tenantId)
      .in("id", mapIds.slice(0, 500));
    for (const m of maps ?? []) {
      mapById.set(m.id as string, { turo_vehicle_id: m.turo_vehicle_id as string | null, vehicle_id: m.vehicle_id as string });
    }
  }

  const vehicleMoved: Staged[] = [];
  for (const row of seenThisRun) {
    if (!row.vehicle_map_id || !row.turo_vehicle_id) continue;
    const mapped = mapById.get(row.vehicle_map_id);
    if (!mapped?.turo_vehicle_id) continue;
    if (mapped.turo_vehicle_id !== row.turo_vehicle_id) {
      vehicleMoved.push(row);
      conflictsToRaise.push({
        tenant_id: tenantId,
        reservation_row_id: row.id,
        vehicle_id: row.matched_vehicle_id,
        job_id: jobId,
        kind: "vehicle_unresolved",
        severity: "review",
        detail: {
          was_turo_vehicle_id: mapped.turo_vehicle_id,
          now_turo_vehicle_id: row.turo_vehicle_id,
          note: "Turo now shows this trip on a different vehicle. The existing block has NOT been moved — moving it would mean a moment with no block covering the trip. Confirm the new car and the block will be transferred in one step.",
        },
      });
    }
  }

  // =========================================================================
  // PASS 5 — CONFLICTS AGAINST OUR OWN RENTALS.
  //
  // ⚠ TIMESTAMP GRANULARITY, THEN DATE PROJECTION. rentals stores start_date /
  //   end_date as DATE with SEPARATE pickup_time / return_time TIME columns
  //   (verified live), while Turo trips are instants. Compared at DATE
  //   granularity, a Turo trip handing back at 10:00 on Tuesday and a Drive247
  //   rental picking up at 16:00 the same Tuesday look like a collision and are
  //   not — that is an ordinary same-day turnaround, and treating it as a
  //   conflict would produce false alarms every single day.
  // =========================================================================
  const liveRows = rows.filter((r) => r.source !== "fixture" && r.matched_vehicle_id);
  const vehicleIds = [...new Set(liveRows.map((r) => r.matched_vehicle_id!))];

  type Rental = {
    id: string; vehicle_id: string | null; start_date: string; end_date: string | null;
    pickup_time: string | null; return_time: string | null; status: string | null;
    payment_status: string | null; document_status: string | null; rental_number: string | null;
    turo_reservation_id: string | null;
  };
  let rentals: Rental[] = [];
  if (vehicleIds.length > 0) {
    const { data: rentalRows, error: rentalError } = await supabase
      .from("rentals")
      .select("id, vehicle_id, start_date, end_date, pickup_time, return_time, status, payment_status, document_status, rental_number, turo_reservation_id")
      .eq("tenant_id", tenantId)
      .in("vehicle_id", vehicleIds.slice(0, 500))
      .not("status", "in", "(Cancelled,Rejected,Closed)");
    if (rentalError) console.error("[TURO-RECONCILE] rentals read failed:", rentalError.message);
    rentals = (rentalRows ?? []) as unknown as Rental[];
  }

  for (const row of liveRows) {
    if (!["OBSERVED", "COMPLETED_HOLD"].includes(row.presence_state)) continue;
    const ts = ms(row.starts_at); const te = ms(row.ends_at);
    if (ts === null || te === null) continue;

    for (const rental of rentals) {
      if (rental.vehicle_id !== row.matched_vehicle_id) continue;
      // A rental this very reservation was promoted into is not a conflict
      // with itself.
      if (rental.id === row.promoted_rental_id) continue;
      if (rental.turo_reservation_id === row.reservation_id) continue;

      const rs = Date.parse(`${rental.start_date}T${rental.pickup_time ?? "00:00:00"}Z`);
      // ⚠ NULL end_date is +INFINITY, not "no end". The column is nullable for
      //   open-ended PAYG rentals; treating NULL as absent would miss every
      //   overlap with one. The booking app makes the same choice
      //   (use-vehicle-booked-dates.ts:90-96).
      const re = rental.end_date
        ? Date.parse(`${rental.end_date}T${rental.return_time ?? "23:59:59"}Z`)
        : Number.POSITIVE_INFINITY;
      if (Number.isNaN(rs)) continue;

      const overlaps = rs < te && ts < re;
      if (!overlaps) continue;

      const committed =
        rental.status === "Active" ||
        (rental.status === "Pending" &&
          (rental.payment_status === "fulfilled" ||
            ["signed", "completed"].includes(rental.document_status ?? "")));

      conflictsToRaise.push({
        tenant_id: tenantId,
        reservation_row_id: row.id,
        rental_id: rental.id,
        vehicle_id: row.matched_vehicle_id,
        job_id: jobId,
        kind: committed ? "overlap_committed" : "overlap_soft",
        severity: committed ? "blocking" : "review",
        overlap_start: new Date(Math.max(ts, rs)).toISOString(),
        overlap_end: Number.isFinite(re) ? new Date(Math.min(te, re)).toISOString() : new Date(te).toISOString(),
        detail: {
          rental_number: rental.rental_number,
          rental_status: rental.status,
          turo_reservation_id: row.reservation_id,
          note: committed
            ? "A Turo trip and a committed Drive247 booking want the same car at the same time. Someone is not getting a car. Nothing has been changed on either side — this needs a person."
            : "A Turo trip overlaps an unconfirmed Drive247 booking. No block was written for the Turo trip.",
        },
      });
    }
  }

  // =========================================================================
  // APPLY
  // =========================================================================
  if (dryRun) {
    report.concluded = "dry run — nothing written";
    report.would = {
      confirm: plans.filter((p) => p.to === "OBSERVED").length,
      hold: plans.filter((p) => p.to === "COMPLETED_HOLD").length,
      close: plans.filter((p) => p.to === "CLOSED").length,
      cancel: plans.filter((p) => p.to === "CANCELLED").length,
      mark_missing: missingNow.length,
      supersede: supersededBy.size,
      conflicts: conflictsToRaise.length,
    };
    return jsonResponse(report);
  }

  // ---- 1. positive transitions ------------------------------------------
  await inChunks(plans, WRITE_CONCURRENCY, async (plan) => {
    const patch: Record<string, unknown> = {
      presence_state: plan.to,
      presence_reason: plan.reason,
      updated_at: nowIso,
    };
    if (plan.evidence) patch.release_evidence = plan.evidence;
    // E4. The §13 trigger already clears missing_since / missing_streak /
    // missing_review_raised_at, but not the job that witnessed the absence.
    // Cleared here so a later cancellation_candidate cannot be admitted on the
    // strength of a read that has since been contradicted. (The §7 release gate
    // re-proves everything anyway — this is the second lock, not the first.)
    if (plan.to === "OBSERVED") patch.missing_evidence_job_id = null;

    const { error } = await supabase
      .from("turo_bridge_reservations")
      .update(patch).eq("id", plan.row.id).eq("tenant_id", tenantId);

    actions.push({
      reservation_id: plan.row.reservation_id, row_id: plan.row.id,
      from: plan.row.presence_state, to: plan.to,
      evidence: plan.evidence ? String(plan.evidence.class) : "E4",
      applied: !error,
      refused_because: error?.message,
      note: plan.reason,
    });
  });

  // ---- 2. absence => MISSING. THE BLOCK IS NOT TOUCHED. ------------------
  await inChunks(missingNow, WRITE_CONCURRENCY, async (row) => {
    const succession = supersededBy.get(row.id);
    if (succession) {
      // A link, never a delete. The old row keeps its block until the successor
      // is confirmed to cover the same window; over-blocking briefly is the
      // safe error, a gap is not.
      const { error } = await supabase
        .from("turo_bridge_reservations")
        .update({
          presence_state: "SUPERSEDED",
          superseded_by_reservation_id: succession.successor.reservation_id,
          superseded_at: nowIso,
          presence_reason: `reissued as ${succession.successor.reservation_id} (match ${succession.score.toFixed(2)})`,
          updated_at: nowIso,
        })
        .eq("id", row.id).eq("tenant_id", tenantId);
      actions.push({
        reservation_id: row.reservation_id, row_id: row.id,
        from: row.presence_state, to: "SUPERSEDED", evidence: "succession",
        applied: !error, refused_because: error?.message,
        note: "Block kept — the trip moved, it did not end.",
      });
      return;
    }

    const streak = (row.missing_streak ?? 0) + 1;
    const { error } = await supabase
      .from("turo_bridge_reservations")
      .update({
        presence_state: "MISSING",
        missing_since: row.missing_since ?? nowIso,
        missing_streak: streak,
        missing_evidence_job_id: jobId,
        presence_reason: `not present in a clean read (${streak} in a row)`,
        updated_at: nowIso,
      })
      .eq("id", row.id).eq("tenant_id", tenantId);

    actions.push({
      reservation_id: row.reservation_id, row_id: row.id,
      from: row.presence_state, to: "MISSING", evidence: "absent_only",
      applied: !error, refused_because: error?.message,
      // Stated on every single row, because this is the sentence that stops
      // somebody "helpfully" adding a delete later.
      note: "Availability block KEPT. Absence is not evidence.",
    });
  });

  // ---- 3. E3 — corroborated absence raises a REVIEW ITEM, never a release --
  for (const row of rows) {
    if (row.presence_state !== "MISSING") continue;
    if (row.missing_review_raised_at) continue;
    const since = ms(row.missing_since);
    const streak = row.missing_streak ?? 0;
    if (streak < E3_MIN_RUNS) continue;
    if (since === null || nowMs - since < E3_MIN_ELAPSED_MS) continue;

    conflictsToRaise.push({
      tenant_id: tenantId,
      reservation_row_id: row.id,
      vehicle_id: row.matched_vehicle_id,
      job_id: jobId,
      kind: "missing_review",
      severity: "review",
      detail: {
        turo_reservation_id: row.reservation_id,
        missing_since: row.missing_since,
        qualifying_runs_absent: streak,
        note:
          "This booking has been absent from " + streak + " clean reads over more than a day. " +
          "That is a strong hint it was cancelled — but absence is still not proof, so the car is STILL BLOCKED. " +
          "Check Turo, then release it by hand if it really is gone.",
      },
    });
    await supabase
      .from("turo_bridge_reservations")
      .update({ missing_review_raised_at: nowIso })
      .eq("id", row.id).eq("tenant_id", tenantId);
  }

  // ---- 4. THE ONLY RELEASE PATH -----------------------------------------
  // A row that just went CANCELLED on E1 may have its block released — but not
  // by us. We ask the database, and the database re-proves authority, tenant,
  // vehicle observation, window coverage and the 48h hold from scratch. If it
  // refuses, the block stays and we say why.
  const releases: Record<string, unknown>[] = [];
  for (const plan of plans) {
    if (plan.to !== "CANCELLED") continue;
    const row = plan.row;
    if (row.source === "fixture") continue;            // I-15: fixtures are inert
    if (!row.blocked_date_id) continue;

    // The one door requires the staging row to be a cancellation_candidate, and
    // that transition is itself gated. Only rows that got as far as staged or
    // promoted can make it — which is exactly the set that can own a block.
    if (!["staged", "promoted"].includes(row.sync_state)) {
      releases.push({ reservation_id: row.reservation_id, released: false, because: `sync_state is ${row.sync_state}` });
      continue;
    }

    const { error: candidateError } = await supabase
      .from("turo_bridge_reservations")
      .update({
        sync_state: "cancellation_candidate",
        missing_evidence_job_id: jobId,
        missing_since: row.missing_since ?? nowIso,
        state_reason: `Turo reported '${row.turo_status}' in job ${jobId}`,
        updated_at: nowIso,
      })
      .eq("id", row.id).eq("tenant_id", tenantId);

    if (candidateError) {
      // The gate refused — most often the 48h hold. Entirely fine: the block
      // simply stays, which is the direction that cannot hurt anybody.
      releases.push({ reservation_id: row.reservation_id, released: false, because: candidateError.message });
      continue;
    }

    const { data: released, error: releaseError } = await supabase
      .rpc("turo_release_block", { p_block_id: row.blocked_date_id, p_job_id: jobId });
    releases.push({
      reservation_id: row.reservation_id,
      released: released === true,
      because: releaseError?.message ?? null,
    });
  }

  // ---- 5. conflicts ------------------------------------------------------
  // Fixtures never produce one (I-15). One OPEN conflict per (reservation,
  // kind) is enforced by a partial unique index, so a re-run refreshes rather
  // than stacking.
  const fixtureIds = new Set(rows.filter((r) => r.source === "fixture").map((r) => r.id));
  const conflictRows = conflictsToRaise.filter((c) => !fixtureIds.has(c.reservation_row_id as string));
  let conflictsWritten = 0;
  let conflictsRefreshed = 0;

  for (const c of conflictRows) {
    // ⚠ NOT an upsert, deliberately. The uniqueness here is a PARTIAL index
    //   (turo_bridge_conflicts_open_unique ... WHERE resolved_at IS NULL), and
    //   Postgres will only infer a partial index as an ON CONFLICT arbiter when
    //   the statement repeats the index predicate — which PostgREST cannot
    //   emit. So `.upsert(..., { onConflict: "reservation_row_id,kind" })`
    //   fails with 42P10 on EVERY call, not just on a collision: the insert
    //   fallback did all the work, and an already-open conflict was never
    //   refreshed. Done explicitly instead.
    const { error: insError } = await supabase.from("turo_bridge_conflicts").insert(c);
    if (!insError) { conflictsWritten++; continue; }

    if (insError.code !== "23505") {
      // A conflict we could not record is a collision nobody will be told
      // about. Loud in the log, and never fatal to the rest of the pass.
      console.error("[TURO-RECONCILE] conflict write failed:", insError.message);
      continue;
    }

    // An OPEN conflict of this kind already stands on this row. Refresh its
    // narrative rather than stacking a second: a stale detail ("score 0.61")
    // outliving the read that produced it is how an operator ends up acting on
    // yesterday's evidence.
    const { error: updError } = await supabase
      .from("turo_bridge_conflicts")
      .update({
        severity: c.severity,
        job_id: c.job_id ?? null,
        overlap_start: c.overlap_start ?? null,
        overlap_end: c.overlap_end ?? null,
        detail: c.detail,
        updated_at: nowIso,
      })
      .eq("tenant_id", tenantId)
      .eq("reservation_row_id", c.reservation_row_id as string)
      .eq("kind", c.kind as string)
      .is("resolved_at", null);

    if (updError) console.error("[TURO-RECONCILE] conflict refresh failed:", updError.message);
    else conflictsRefreshed++;
  }

  // ---- 6. report ---------------------------------------------------------
  const applied = actions.filter((a) => a.applied);
  report.concluded = "applied";
  // ABSOLUTE COUNTERS, from OUR OWN staged table. Never processed/total, never
  // a percentage, and the word "complete" appears only where the database said
  // so — a truncated read must never be able to render as 8/8 green.
  report.counts = {
    staged_rows_examined: rows.length,
    seen_in_this_read: seenThisRun.length,
    confirmed_still_on: applied.filter((a) => a.to === "OBSERVED").length,
    finished_and_held: applied.filter((a) => a.to === "COMPLETED_HOLD").length,
    closed: applied.filter((a) => a.to === "CLOSED").length,
    cancelled_by_turo: applied.filter((a) => a.to === "CANCELLED").length,
    stopped_appearing: applied.filter((a) => a.to === "MISSING").length,
    reissued_under_a_new_id: applied.filter((a) => a.to === "SUPERSEDED").length,
    moved_to_another_vehicle: vehicleMoved.length,
    conflicts_raised: conflictsWritten,
    conflicts_refreshed: conflictsRefreshed,
    blocks_released: releases.filter((r) => r.released === true).length,
    refused_writes: actions.filter((a) => !a.applied).length,
  };
  report.transitions = actions.slice(0, 300);
  report.releases = releases;
  report.load_truncated = loadTruncated;
  if (unrecognisedStatuses.size > 0) {
    // The vocabulary guess, failing loudly. This is what a Turo wording change
    // looks like before it becomes a bug.
    report.unrecognised_turo_statuses = [...unrecognisedStatuses.entries()].map(([status, count]) => ({ status, count }));
    report.unrecognised_note =
      "Turo used trip statuses we do not recognise. They were treated as STILL ON — the safe reading — and no block was released because of them. If one of these means 'cancelled', tell us and we will add it.";
  }
  report.advice =
    (report.counts as Record<string, number>).stopped_appearing > 0
      ? "Bookings that stopped appearing are marked as such, but their cars are STILL BLOCKED. Nothing is released on absence alone."
      : "No availability was released on absence.";

  console.log(
    `[TURO-RECONCILE] run ${jobId} tenant ${tenantId}: ` +
      `${(report.counts as Record<string, number>).confirmed_still_on} confirmed, ` +
      `${(report.counts as Record<string, number>).stopped_appearing} missing (blocks kept), ` +
      `${(report.counts as Record<string, number>).blocks_released} released, ` +
      `${conflictsWritten} conflicts` + (tokenId ? ` [token ${tokenId}]` : ""),
  );

  return jsonResponse(report);
});

// ---------------------------------------------------------------------------
/**
 * How much do these two look like the same trip reissued? Guest identity plus
 * window overlap plus vehicle, and nothing else — no name fuzziness beyond an
 * exact normalised match, because "Marcus D." is not a person, it is a prefix.
 *
 * Deliberately conservative. Below 0.60 the two rows stay independent and the
 * old one follows the ordinary absence path, which keeps its block. The cost of
 * missing a succession is a stale block; the cost of inventing one is a
 * released block on a trip that is still running.
 */
function successionScore(gone: Staged, cand: Staged): number {
  let score = 0;

  if (gone.turo_guest_id && cand.turo_guest_id) {
    if (gone.turo_guest_id !== cand.turo_guest_id) return 0;   // different person: not a reissue
    score += 0.45;
  } else if (gone.guest_name && cand.guest_name) {
    const a = gone.guest_name.trim().toLowerCase();
    const b = cand.guest_name.trim().toLowerCase();
    if (a !== b) return 0;
    score += 0.25;   // a display name is weak evidence and is scored as such
  } else {
    return 0;        // no identity at all: never guess
  }

  const gs = ms(gone.starts_at), ge = ms(gone.ends_at);
  const cs = ms(cand.starts_at), ce = ms(cand.ends_at);
  if (gs === null || ge === null || cs === null || ce === null) return 0;
  const overlap = Math.min(ge, ce) - Math.max(gs, cs);
  const span = Math.max(ge - gs, ce - cs);
  if (span <= 0 || overlap <= 0) return 0;
  const ratio = overlap / span;
  if (ratio < 0.8) return 0;
  score += 0.35 * ratio;

  if (gone.turo_vehicle_id && cand.turo_vehicle_id && gone.turo_vehicle_id === cand.turo_vehicle_id) {
    score += 0.20;
  }
  return score;
}

/** Bounded parallelism. A Turo host with a large fleet must not open 400 sockets. */
async function inChunks<T>(items: T[], width: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += width) {
    await Promise.all(items.slice(i, i + width).map(fn));
  }
}
