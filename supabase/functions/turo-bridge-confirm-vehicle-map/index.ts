/**
 * turo-bridge-confirm-vehicle-map — a HUMAN says which of our cars a Turo
 * vehicle identity is.
 *
 * ─── WHY THIS EXISTS AS ITS OWN FUNCTION ────────────────────────────────────
 * `turo_vehicle_map.confirmed_by` is NOT NULL and references `app_users`
 * (turo-bridge-poc/sql/03-foundation-schema.sql:398). That is not decoration:
 * the whole table exists so that a vehicle binding is always traceable to a
 * named person. The portal holds SELECT and nothing else on the Turo tables, so
 * there is no client-side route to writing one, and no service-role route that
 * could supply a truthful `confirmed_by` either. A signed-in caller is the only
 * way this row can be created honestly.
 *
 * apps/portal/src/hooks/use-turo-vehicle-map.ts:677 has called this name since
 * it was written; nothing answered it. This is that endpoint, built to the body
 * the hook already sends.
 *
 * ─── verify_jwt ─────────────────────────────────────────────────────────────
 * MUST stay at its default (true). Unlike turo-bridge-ingest, the caller here is
 * an operator sitting in the Drive247 portal with a real Supabase session. There
 * is no pairing-token door and there must not be one: a pairing token proves
 * which tenant, never which person, and `confirmed_by` needs a person.
 *
 * ─── WHAT THIS FUNCTION WILL NOT DO ─────────────────────────────────────────
 * It never creates a vehicle. `vehicles.reg` is globally unique across every
 * operator on the platform (461/461 distinct, live) and a wrong one cannot be
 * undone cleanly, so an unmatched Turo car is a question for the Vehicles page,
 * not something to conjure here.
 *
 * It never guesses which identity was confirmed. `match_key` is a GENERATED
 * column; we send the identity fields and then CHECK that the key Postgres
 * derived is the one the operator was actually looking at. A mismatch means the
 * queue and the database disagree about what "this Turo car" means, and the
 * right answer to that is a refusal, not a mapping.
 *
 * It never promotes anything. Confirming a mapping moves matched rows to
 * 'staged' — ready to import — and nothing further. Import stays a separate,
 * explicitly acknowledged act in turo-bridge-promote.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

function asText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

function asLabels(v: unknown, maxItems = 25, maxLen = 200): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = asText(item, maxLen);
    if (s !== null && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * A literal mirror of public.turo_norm_label(text)
 * (03-foundation-schema.sql:75-82) and of the same mirror in
 * apps/portal/src/hooks/use-turo-vehicle-map.ts:89. Three copies is two too
 * many, but the alternative is a round trip per candidate; if any of them drift
 * the match_key check below turns the drift into a refusal rather than a wrong
 * mapping.
 */
function normLabel(label: string | null): string {
  return (label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Mirror of the GENERATED turo_vehicle_map.match_key (03:384-390). */
function matchKeyFor(turoVehicleId: string | null, displayLabel: string | null): string | null {
  const tid = (turoVehicleId ?? "").trim();
  if (tid) return `tid:${tid.toLowerCase()}`;
  const norm = normLabel(displayLabel);
  return norm ? `lbl:${norm}` : null;
}

/** `match_basis` CHECK on turo_bridge_reservations (03:713-718). CLOSED list. */
const MATCH_BASIS = new Set(["turo_vehicle_id", "label_exact", "label_alias", "human"]);
/** `vehicle_match_method` CHECK (03:1850-1853). CLOSED list. */
const MATCH_METHOD = new Set([
  "listing_map", "plate_exact", "reg_normalised", "vin_suggested", "label_parsed", "operator", "unresolved",
]);

/**
 * The portal queue names its evidence in its own vocabulary
 * (apps/portal/src/hooks/use-turo-vehicle-map.ts `TuroMatchEvidence`), which is
 * not the database's. Translate rather than let an unrecognised value fall
 * through to 'operator': the CHECK would take a wrong value silently and the
 * column exists precisely so a bad mapping is auditable afterwards.
 *
 * Anything not on this list becomes 'operator', which is the truthful floor —
 * a human clicked the button, whatever the machine thought.
 */
const EVIDENCE_TO_METHOD: Record<string, string> = {
  turo_vehicle_id: "listing_map",
  plate_exact: "plate_exact",
  label_plate_parsed: "label_parsed",
  label_fuzzy: "label_parsed",
  // A VIN can only ever SUGGEST: vehicles.vin is not unique (326 distinct
  // across 400 non-null, live). Never 'plate_exact', never 'listing_map'.
  vin_unique: "vin_suggested",
  operator_choice: "operator",
};

type Actor = { appUserId: string; tenantId: string | null; isSuperAdmin: boolean };

async function resolveActor(supabase: SupabaseClient, authHeader: string | null): Promise<Actor | null> {
  if (!authHeader) return null;
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const { data: userData } = await supabase.auth.getUser(jwt);
  const authUserId = userData?.user?.id;
  if (!authUserId) return null;

  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, tenant_id, is_active, is_super_admin")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!appUser || appUser.is_active === false) return null;

  return {
    appUserId: appUser.id as string,
    tenantId: (appUser.tenant_id as string | null) ?? null,
    isSuperAdmin: appUser.is_super_admin === true,
  };
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("Method not allowed. POST a JSON body.", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[TURO-VMAP] Missing Supabase environment configuration");
    return errorResponse("Server is not configured.", 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body must be JSON.", 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- 1. WHO. Not optional, and not derivable from anything else. --------
  const actor = await resolveActor(supabase, req.headers.get("Authorization"));
  if (!actor) {
    return errorResponse(
      "Confirming which car a Turo vehicle is requires a signed-in Drive247 user — this mapping gets a name on it.",
      401,
    );
  }

  // ---- 2. WHICH TENANT. From app_users, never from the body. --------------
  // A super admin carries tenant_id = NULL by design, so they alone may name
  // one; for everyone else the body's `tenantId` is ignored entirely, and a
  // disagreement is refused rather than silently resolved in either direction.
  const claimedTenant = asText(body.tenantId ?? body.tenant_id, 64);
  let tenantId = actor.tenantId;
  if (actor.isSuperAdmin) {
    tenantId = claimedTenant ?? actor.tenantId;
    if (!tenantId) return errorResponse("Super admins must name a `tenantId` for this mapping.", 400);
  } else if (claimedTenant && claimedTenant !== actor.tenantId) {
    return errorResponse("That account is not the one you are signed into.", 403);
  }
  if (!tenantId) return errorResponse("No Drive247 account is associated with this user.", 403);

  // ---- 2b. RETIRE ---------------------------------------------------------
  // useRetireTuroVehicleMapping() posts `action: 'retire'` to this same name.
  //
  // RETIRING NEVER DELETES AND NEVER UNBLOCKS. A mapping is a statement about
  // identity; withdrawing it must not silently un-block a car that is physically
  // out on rent, so every reservation already bound to it keeps its
  // matched_vehicle_id, anything already promoted stays promoted, and any block
  // already placed stays placed until it goes through the one release door.
  // All this does is stop the mapping being applied to FUTURE syncs.
  if (asText(body.action, 20) === "retire") {
    const mappingId = asText(body.mappingId ?? body.mapping_id, 64);
    const reason = asText(body.reason, 500);
    if (!mappingId) return errorResponse("No mapping selected.", 400);

    const nowIso = new Date().toISOString();
    const { data: retired, error: retireError } = await supabase
      .from("turo_vehicle_map")
      .update({
        is_active: false,
        // turo_vehicle_map_retired_iff_inactive: the two must move together.
        retired_at: nowIso,
        confirmation_note: reason,
        updated_at: nowIso,
      })
      .eq("id", mappingId)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .select("id, display_label, vehicle_id");

    if (retireError) {
      console.error("[TURO-VMAP] retire failed:", retireError.message);
      return errorResponse(retireError.message, 400);
    }
    if ((retired ?? []).length === 0) {
      // Already retired, or not this tenant's. Same answer either way.
      return errorResponse("That mapping is not active on this account.", 404);
    }

    console.log(`[TURO-VMAP] tenant ${tenantId}: retired mapping ${mappingId} by ${actor.appUserId}`);
    return jsonResponse({
      ok: true,
      retired: true,
      mapping_id: mappingId,
      message:
        "The mapping was retired. Bookings already matched to that car keep their vehicle, and no availability " +
        "block was released — retiring a mapping says nothing about whether a trip is happening.",
    });
  }

  // ---- 3. THE IDENTITY BEING MAPPED --------------------------------------
  const turoVehicleId = asText(body.turoVehicleId ?? body.turo_vehicle_id, 120);
  const displayLabel = asText(body.displayLabel ?? body.display_label, 200);
  const claimedKey = asText(body.matchKey ?? body.match_key, 260);
  const vehicleId = asText(body.vehicleId ?? body.vehicle_id, 64);
  const plateHint = asText(body.plateHint ?? body.plate_hint, 40);
  const vinHint = asText(body.vinHint ?? body.vin_hint, 40);
  const note = asText(body.confirmationNote ?? body.confirmation_note, 500);
  const aliasLabels = asLabels(body.aliasLabels ?? body.alias_labels);

  if (!vehicleId) return errorResponse("Choose one of your vehicles before confirming.", 400);

  const derivedKey = matchKeyFor(turoVehicleId, displayLabel);
  if (!derivedKey) {
    // turo_vehicle_map_has_identity would refuse this anyway; said in words.
    return errorResponse(
      "This Turo trip carries neither a vehicle id nor a usable label, so there is nothing stable to map. " +
        "Re-sync once the feed returns vehicle details rather than mapping it by hand.",
      400,
    );
  }
  if (claimedKey && claimedKey !== derivedKey) {
    // The queue grouped these trips under one identity and the database would
    // store a different one. Refuse: the operator confirmed a specific car.
    return errorResponse(
      `The Turo identity changed while you were looking at it (you confirmed '${claimedKey}', this data reads as '${derivedKey}'). ` +
        "Nothing was mapped. Reload the queue and confirm again.",
      409,
    );
  }

  // ---- 4. THE VEHICLE MUST BE THEIRS -------------------------------------
  // The composite FK turo_vehicle_map_vehicle_tenant_fkey enforces this too, but
  // a 23503 is not something to show an operator, and RLS is OFF on `vehicles`
  // so this filter is doing real work rather than restating a policy.
  const { data: vehicle, error: vehicleError } = await supabase
    .from("vehicles")
    .select("id, reg")
    .eq("id", vehicleId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (vehicleError) {
    console.error("[TURO-VMAP] vehicle lookup failed:", vehicleError.message);
    return errorResponse("Could not read your fleet.", 500);
  }
  // Deliberately the same answer whether the id is fictional or belongs to
  // another operator: naming the difference would confirm the existence of
  // someone else's vehicle.
  if (!vehicle) return errorResponse("The vehicle you picked is not in this account's fleet.", 404);

  // ---- 5. HAS THIS IDENTITY ALREADY BEEN MAPPED? -------------------------
  const { data: existing, error: existingError } = await supabase
    .from("turo_vehicle_map")
    .select("id, vehicle_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("match_key", derivedKey)
    .maybeSingle();
  if (existingError) {
    console.error("[TURO-VMAP] map lookup failed:", existingError.message);
    return errorResponse("Could not read the existing vehicle mappings.", 500);
  }

  let mappingId: string;
  let reused = false;

  if (existing) {
    // Re-confirming the SAME car reactivates and re-stamps. Re-pointing it at a
    // DIFFERENT car is a separate, heavier act: the old mapping may already have
    // put trips on the old vehicle, and silently moving them is how a car is
    // double-sold. Retire the old mapping first.
    if (existing.vehicle_id !== vehicleId && existing.is_active) {
      return errorResponse(
        "This Turo vehicle is already mapped to a different car. Retire that mapping first — " +
          "bookings already matched to the old car will not move on their own, and moving them silently is how a car gets double-sold.",
        409,
      );
    }
    const { error: reviveError } = await supabase
      .from("turo_vehicle_map")
      .update({
        vehicle_id: vehicleId,
        is_active: true,
        retired_at: null,           // turo_vehicle_map_retired_iff_inactive
        confirmed_by: actor.appUserId,
        confirmed_at: new Date().toISOString(),
        confirmation_note: note,
        plate_hint: plateHint,
        vin_hint: vinHint,
        alias_labels: aliasLabels,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId);
    if (reviveError) {
      console.error("[TURO-VMAP] mapping update failed:", reviveError.message);
      return errorResponse(reviveError.message, 409);
    }
    mappingId = existing.id as string;
    reused = true;
  } else {
    const { data: created, error: insertError } = await supabase
      .from("turo_vehicle_map")
      .insert({
        tenant_id: tenantId,
        turo_vehicle_id: turoVehicleId,
        display_label: displayLabel,
        alias_labels: aliasLabels,
        vehicle_id: vehicleId,
        vin_hint: vinHint,          // HINT ONLY. vehicles.vin is not unique.
        plate_hint: plateHint,      // HINT ONLY. A fragment scraped off a label.
        confirmed_by: actor.appUserId,
        confirmation_note: note,
        // match_key, display_label_norm: GENERATED. Supplying either is an error.
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // turo_vehicle_map_active_label_unique. Two distinct Turo vehicles that
        // render to the same string, or an id-keyed row colliding with a
        // label-keyed one. The index exists precisely so this FAILS LOUDLY
        // instead of a first-match-wins lookup picking one of them.
        return errorResponse(
          "Another active mapping already uses this Turo vehicle name. Two different Turo cars that display the same way " +
            "cannot both be mapped by name — retire the other mapping, or wait until the feed gives these cars distinct ids.",
          409,
        );
      }
      console.error("[TURO-VMAP] mapping insert failed:", insertError.message);
      return errorResponse(insertError.message, 400);
    }
    mappingId = created!.id as string;
  }

  // ---- 6. RE-STAGE THE TRIPS THIS MAPPING ANSWERS ------------------------
  // Only the rows that carry THIS identity, and only from the states §13 lets
  // into 'staged' (pending_match and conflict). A 'promoted' row already owns a
  // real rental and the trigger refuses to move it back; a
  // 'cancellation_candidate' is a question about whether the trip still exists,
  // which a vehicle mapping does not answer.
  const restageBase = () =>
    supabase
      .from("turo_bridge_reservations")
      .update({
        vehicle_map_id: mappingId,
        matched_vehicle_id: vehicleId,
        // A human confirmed it, so 'human' is the only truthful basis. The
        // client sends this; an unrecognised value is corrected rather than
        // written, because the CHECK would reject the whole statement.
        match_basis: MATCH_BASIS.has(asText(body.reservationMatchBasis ?? body.match_basis, 30) ?? "")
          ? (asText(body.reservationMatchBasis ?? body.match_basis, 30) as string)
          : "human",
        vehicle_match_method: (() => {
          const raw = asText(body.evidence, 40) ?? "";
          const mapped = EVIDENCE_TO_METHOD[raw] ?? raw;
          return MATCH_METHOD.has(mapped) ? mapped : "operator";
        })(),
        // 1.0 because a person looked at it — not because a string matched.
        vehicle_match_confidence: 1.0,
        sync_state: "staged",
        state_reason: `vehicle confirmed by ${actor.appUserId}`,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .in("sync_state", ["pending_match", "conflict"]);

  const restage = turoVehicleId
    ? restageBase().eq("turo_vehicle_id", turoVehicleId)
    // No Turo vehicle id in this feed vintage: the normalised label IS the
    // identity. Matched case-insensitively on the raw label rather than
    // re-deriving the norm in SQL, which PostgREST cannot express.
    : restageBase().ilike("vehicle_label", displayLabel ?? "");

  const { data: restaged, error: restageError } = await restage.select("id");

  let restageNote: string | null = null;
  if (restageError) {
    // The mapping is the valuable half and it landed. A failed re-stage costs a
    // second click, never the binding.
    console.error("[TURO-VMAP] re-stage failed:", restageError.message);
    restageNote =
      "The mapping was saved, but the bookings on this car could not be moved to the ready list. " +
      "They will pick it up on the next sync.";
  }

  console.log(
    `[TURO-VMAP] tenant ${tenantId}: '${derivedKey}' -> ${vehicle.reg} ` +
      `(${reused ? "re-confirmed" : "new"}, by ${actor.appUserId}, ${(restaged ?? []).length} bookings staged)`,
  );

  return jsonResponse({
    ok: true,
    mapping_id: mappingId,
    match_key: derivedKey,
    vehicle_reg: vehicle.reg,
    reused,
    // ABSOLUTE, and from our own table. Never "N of M".
    reservations_restaged: (restaged ?? []).length,
    note: restageNote,
    message:
      `Turo's ${displayLabel ?? turoVehicleId} is your ${vehicle.reg}. ` +
      "Every future Turo trip on this car will block that vehicle. Nothing has been imported yet.",
  });
});
