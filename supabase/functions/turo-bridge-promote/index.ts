/**
 * turo-bridge-promote — turns staged Turo trips into real Drive247 rentals.
 *
 * ═══ WHY THIS IS AN EDGE FUNCTION AND NOT A PORTAL INSERT ═══════════════════
 *
 * RLS is OFF on rentals, vehicles, customers, blocked_dates and ledger_entries
 * (pg_class.relrowsecurity = false — 11/10/15/3/0 policies sit there inert;
 * apps/portal/src/hooks/use-calendar-blocks.ts:50-53 already documents this for
 * blocked_dates). A client-side insert from the portal would therefore be a
 * naked cross-tenant write primitive. Promotion runs service-role here, and
 * resolves the caller's tenant from their Supabase JWT via app_users — never
 * from x-tenant-slug, never from the body — then refuses when the staged row's
 * tenant does not match.
 *
 * ═══ THE FOUR THINGS THIS FUNCTION WILL NOT DO ══════════════════════════════
 *
 * 1. IT NEVER CREATES A VEHICLE. vehicles.reg is GLOBALLY unique with no tenant
 *    in the key (constraint vehicles_reg_key; live: 461 rows / 461 distinct
 *    regs). Auto-creating from a Turo plate would either 23505 against another
 *    operator's row or poison a platform-wide namespace. If the car is not in
 *    Drive247, the operator adds it through the normal Vehicles flow first.
 *
 * 2. IT NEVER WRITES blocked_dates. The rental IS the block —
 *    check_rental_overlap already refuses any overlapping booking. Writing a
 *    block as well would double-block, fire trg_fh_blocks, and re-open the
 *    vehicle_id-NULL = TENANT-WIDE-BLOCK hazard (4 such rows exist live). By
 *    never writing that table, the highest-blast-radius mistake in this
 *    integration is designed out rather than guarded against.
 *
 * 3. IT NEVER PROCEEDS WITH A SIDE EFFECT IT CANNOT SUPPRESS. Before writing
 *    anything it calls public.turo_promotion_guards(). If a MANDATORY guard is
 *    missing — the receivables trigger, or the one-email-per-rental platform
 *    notifier — the whole batch is REFUSED with that guard named. Not a partial
 *    import, not a warning: a refusal. "We applied a migration once" is not a
 *    fact an edge function is entitled to assume.
 *
 * 4. IT HAS NO "SYNC DELETES" BRANCH. Nothing here reads absence, so a staged
 *    row vanishing from a later degraded read can never un-promote a rental.
 *    Undoing an import is an explicit, audited operator action (`revert`).
 *
 * ═══ THE SIDE EFFECTS, AND WHAT WOULD HAVE HAPPENED ═════════════════════════
 *
 * rentals carries 11 triggers, 8 of which fire on INSERT. Two reach the outside
 * world and are suppressed by a WHEN clause on `source = 'turo_import'`
 * (turo-bridge-poc/sql/03-foundation-schema.sql §16):
 *
 *   rental_charges_trigger -> generate_rental_charges -> rental_create_charge
 *     -> INSERT INTO ledger_entries (type='Charge'). REAL RECEIVABLES against a
 *     guest we cannot even contact. NOTE: for a trip shorter than one month
 *     duration_months computes to 0 and the loop never runs, so a short-trip
 *     test looks clean. A 31-day Turo trip WOULD raise one. Do not rely on the
 *     accident.
 *
 *   trg_notify_platform_rental -> net.http_post -> platform-rental-notify,
 *     which emails a hardcoded address (that function's index.ts:15, sent at
 *     :164). Its only existing skip is tenants.tenant_type = 'test', which a
 *     real migrating operator is not. 200 trips would be 200 emails.
 *
 * prevent_rental_overlap is deliberately KEPT ON. It is the safety net that
 * stops an import double-selling a car; a 23P01 is caught per row and reported
 * as a conflict, never retried and never worked around by shifting a date.
 *
 * The guest-facing 15-minute cron (send-return-reminders, cron.job 22) selects
 * on `status IN (Active,Approved,Pending) AND return_reminder_sent_at IS NULL`,
 * which a promoted rental matches on every clause. Its `if (!customer.email)
 * continue` at index.ts:110 is ABSENCE-driven and evaporates the day anyone
 * backfills an email, so it is NOT relied on: promotion pre-stamps
 * return_reminder_sent_at so the row is excluded by the query itself.
 *
 * ═══ THE GUEST, PLAINLY ═════════════════════════════════════════════════════
 *
 * A REAL CUSTOMER CANNOT BE CREATED FROM TURO DATA. The host feed gives a
 * display name and nothing contactable. What is created is a PLACEHOLDER
 * CONTACT — name only, email and phone NULL, sms_consent false — and it can
 * never be emailed or SMSed because every notification path in this repo
 * dereferences customers.email first. Promotion never initiates contact with a
 * Turo guest.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const MAX_ROWS = 1000;
const MAX_RENTAL_NUMBER_RETRIES = 5;

/** Tables that prove a rental has been operated on since it was imported. */
const ACTIVITY_TABLES = [
  "ledger_entries", "payments", "rental_agreements", "rental_extensions",
  "rental_reviews", "installment_plans",
] as const;

// ---------------------------------------------------------------------------
function asText(v: unknown, max: number): string | null {
  if (typeof v === "number" || typeof v === "boolean") return String(v).slice(0, max);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
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

/**
 * Plate normalisation. UPPER, non-alphanumerics stripped — this is the ONLY
 * comparison used against vehicles.reg, and it is used for equality only. There
 * is no fuzzy plate matching anywhere in this file: a plate that is one
 * character out is a different car.
 */
function normPlate(v: unknown): string | null {
  const s = asText(v, 40);
  if (!s) return null;
  const n = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return n.length >= 2 ? n : null;
}

/**
 * Mine a plate out of a legacy display string such as
 * "Owner 1 Wagoneer (Jon) (CA #9DUC203)". Opportunistic only: whatever this
 * returns still has to hit an EXACT normalised match against a vehicle in this
 * tenant to be used, otherwise it degrades to a suggestion. Never a guess.
 */
function platesFromLabel(label: string | null): string[] {
  if (!label) return [];
  const out: string[] = [];
  const hash = label.match(/#\s*([A-Za-z0-9\- ]{2,12})/g) ?? [];
  for (const h of hash) {
    const p = normPlate(h.replace("#", ""));
    if (p) out.push(p);
  }
  for (const m of label.match(/\(([^)]{2,20})\)/g) ?? []) {
    const p = normPlate(m.slice(1, -1));
    if (p && /\d/.test(p)) out.push(p);
  }
  return [...new Set(out)];
}

/** A VIN is 17 chars, no I/O/Q. Used ONLY to SUGGEST — never to resolve. */
function vinsFromText(...parts: (string | null)[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (!p) continue;
    for (const m of p.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? []) out.push(m);
  }
  return [...new Set(out)];
}

/** Stable stringify so plan_hash does not change when key order does. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

/** Identical to the resolver in turo-bridge-ingest — see that file's header. */
async function resolvePairing(supabase: SupabaseClient, token: string) {
  const tokenHash = await sha256Hex(token);
  const digest = await supabase.from("turo_bridge_tokens")
    .select("id, tenant_id, revoked_at").eq("token_hash", tokenHash).maybeSingle();
  if (!digest.error) return { pairing: digest.data, hardError: null as string | null };
  if (digest.error.code !== "42703") return { pairing: null, hardError: digest.error.message };
  const plain = await supabase.from("turo_bridge_tokens")
    .select("id, tenant_id, revoked_at").eq("token", token).maybeSingle();
  if (plain.error) return { pairing: null, hardError: plain.error.message };
  return { pairing: plain.data, hardError: null as string | null };
}

// ---------------------------------------------------------------------------
type Staged = {
  id: string; reservation_id: string; source: string; status: string;
  sync_state: string; presence_state: string; guest_name: string | null;
  guest_ref_hint: string | null; vehicle_label: string | null; vehicle_plate: string | null;
  turo_vehicle_id: string | null; turo_guest_id: string | null; turo_status: string | null;
  starts_at: string | null; ends_at: string | null; total_amount: number | null;
  currency: string | null; hold_until: string | null; matched_vehicle_id: string | null;
  vehicle_map_id: string | null; promoted_rental_id: string | null;
};

type Verdict = {
  row_id: string;
  turo_reservation_id: string;
  guest: string | null;
  turo_vehicle_string: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /** 'plate' auto-matches. Everything else needs a per-row human click. */
  vehicle_match: "plate" | "vin" | "label" | "manual" | "none";
  vehicle_id: string | null;
  vehicle_reg: string | null;
  needs_confirmation: boolean;
  rental_status: string | null;
  blocker: string | null;
  will_create: string[];
};

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return errorResponse("Method not allowed. POST a JSON body.", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[TURO-PROMOTE] Missing Supabase environment configuration");
    return errorResponse("Server is not configured.", 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse("Body must be JSON.", 400); }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const action = asText(body.action, 30) ?? "plan";
  const nowIso = new Date().toISOString();

  // ---- WHO IS ASKING ----------------------------------------------------
  // A JWT is REQUIRED, not optional. Every mapping in this feature requires a
  // human, and an audit trail with nobody's name on it is not an audit trail.
  // A pairing token may ALSO be sent; if it is, it must agree.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Sign in to Drive247 to import Turo bookings.", 401);
  }
  const { data: authData, error: authError } = await supabase.auth.getUser(authHeader.slice(7).trim());
  if (authError || !authData?.user) return errorResponse("Sign in to Drive247 to import Turo bookings.", 401);

  const { data: appUser } = await supabase
    .from("app_users")
    .select("id, tenant_id, role, is_active, is_super_admin")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (!appUser || appUser.is_active === false) {
    return errorResponse("Your Drive247 account is not active.", 403);
  }
  const actorId = appUser.id as string;

  // THE ONLY SOURCE OF TENANT IDENTITY. Not a header. Not the body.
  let tenantId = (appUser.tenant_id as string | null) ?? null;

  const token = asText(body.token ?? body.pairing_token, 300);
  if (token) {
    const { pairing, hardError } = await resolvePairing(supabase, token);
    if (hardError) return errorResponse("Could not verify the pairing token.", 500);
    if (!pairing || pairing.revoked_at) return errorResponse("Pairing token not recognised.", 401);
    if (tenantId && pairing.tenant_id !== tenantId) {
      // One Chrome profile, one Turo cookie jar, two Drive247 tenants. The
      // worst outcome available in this system, refused outright.
      return errorResponse(
        "That pairing token belongs to a different Drive247 account than the one you are signed into.",
        403,
      );
    }
    tenantId = tenantId ?? (pairing.tenant_id as string);
  }

  // A super admin carries tenant_id = NULL by design, so they must name the
  // tenant explicitly — and it is validated, not trusted.
  if (!tenantId && appUser.is_super_admin === true) {
    tenantId = asText(body.tenant_id, 64);
    if (!tenantId) return errorResponse("Super admins must name a `tenant_id` for this import.", 400);
  }
  if (!tenantId) return errorResponse("Your account is not attached to a Drive247 tenant.", 403);

  // ---- IS THIS TENANT ALLOWED TO USE THE BRIDGE AT ALL? -----------------
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, slug, company_name, turo_bridge_enabled")
    .eq("id", tenantId).maybeSingle();
  if (tenantError) {
    // 42703 => the flag column is missing, i.e. the appendix has not been
    // applied. Refuse: without §16 the suppression guards are absent too.
    if (tenantError.code === "42703") {
      return errorResponse(
        "The Turo bridge schema is not installed on this database (tenants.turo_bridge_enabled is missing). Apply turo-bridge-poc/sql/03-foundation-schema.sql first.",
        503,
      );
    }
    return errorResponse("Could not read the account.", 500);
  }
  if (!tenant) return errorResponse("Unknown account.", 404);
  if (tenant.turo_bridge_enabled !== true) {
    return errorResponse(
      "The Turo bridge is not switched on for this account. It is off by default so the other operators on this platform cannot reach it.",
      403,
    );
  }

  // =========================================================================
  // ⚠ PREFLIGHT — REFUSE RATHER THAN PROCEED
  //
  // If a mandatory side-effect guard is not installed, importing 200 trips
  // would raise 200 real receivables and send 200 emails to a hardcoded
  // address. There is no partial-credit version of that, so there is no
  // partial-credit branch here.
  // =========================================================================
  const { data: guards, error: guardError } = await supabase.rpc("turo_promotion_guards");
  const guardReport = (guards ?? null) as Record<string, unknown> | null;

  if (guardError || !guardReport) {
    const detail = guardError?.message ?? "no result";
    // 42883 = undefined_function: the appendix has not been applied.
    return jsonResponse({
      ok: false,
      refused: true,
      reason: "guards_unverifiable",
      message:
        "Importing was refused because the safety guards could not be verified. Until they can be, a Turo import could raise real invoices against guests we cannot contact.",
      detail,
      fix: "Apply turo-bridge-poc/sql/03-foundation-schema.sql (section 16 installs the guards and section 16b installs this check).",
    }, 503);
  }

  if (guardReport.safe_to_promote !== true) {
    const missing = Array.isArray(guardReport.missing_mandatory) ? guardReport.missing_mandatory : [];
    // Recorded, not just returned — an operator who closes the tab still needs
    // this to be findable afterwards.
    await supabase.from("turo_bridge_conflicts").insert({
      tenant_id: tenantId,
      reservation_row_id: asText(body.probe_row_id, 64),
      kind: "guard_not_installed",
      severity: "blocking",
      detail: { missing_mandatory: missing, guards: guardReport.guards },
    }).then(() => {}, () => {});   // best effort; a missing row_id makes this fail and that is fine

    return jsonResponse({
      ok: false,
      refused: true,
      reason: "side_effects_not_suppressed",
      missing_guards: missing,
      message:
        "Importing was refused. These bookings would each raise a real invoice, and email an alert to the platform, " +
        "because the safety guards on " + missing.join(", ") + " are not installed on this database. " +
        "Nothing was written.",
      fix: "Apply section 16 of turo-bridge-poc/sql/03-foundation-schema.sql, then try again.",
      guards: guardReport.guards,
    }, 409);
  }

  if (action === "preflight") {
    return jsonResponse({ ok: true, safe_to_promote: true, guards: guardReport.guards });
  }

  // =========================================================================
  // REVERT
  // =========================================================================
  if (action === "revert") {
    return await revertBatch(supabase, tenantId, actorId, asText(body.batch_id, 64), nowIso);
  }

  // =========================================================================
  // PLAN  (and APPLY, which re-runs the plan first)
  // =========================================================================
  const vehicleChoices: Record<string, string> = {};
  const rawChoices = body.vehicle_choices;
  if (rawChoices && typeof rawChoices === "object" && !Array.isArray(rawChoices)) {
    for (const [k, v] of Object.entries(rawChoices as Record<string, unknown>)) {
      const id = asText(v, 64);
      if (id) vehicleChoices[k] = id;
    }
  }
  const only = Array.isArray(body.reservation_row_ids)
    ? new Set((body.reservation_row_ids as unknown[]).map((v) => asText(v, 64)).filter(Boolean) as string[])
    : null;

  // ---- staged rows -------------------------------------------------------
  const { data: stagedRaw, error: stagedError } = await supabase
    .from("turo_bridge_reservations")
    .select(
      "id, reservation_id, source, status, sync_state, presence_state, guest_name, vehicle_label, " +
      "vehicle_plate, turo_vehicle_id, turo_guest_id, turo_status, starts_at, ends_at, total_amount, " +
      "currency, hold_until, matched_vehicle_id, vehicle_map_id, promoted_rental_id",
    )
    .eq("tenant_id", tenantId)
    .order("starts_at", { ascending: true })
    .limit(MAX_ROWS + 1);

  if (stagedError) {
    console.error("[TURO-PROMOTE] staged read failed:", stagedError.message);
    return errorResponse("Could not read the staged bookings.", 500);
  }
  const stagedAll = (stagedRaw ?? []) as unknown as Staged[];
  const stagedTruncated = stagedAll.length > MAX_ROWS;
  let staged = stagedTruncated ? stagedAll.slice(0, MAX_ROWS) : stagedAll;
  if (only) staged = staged.filter((s) => only.has(s.id));

  // ---- vehicles ----------------------------------------------------------
  // This tenant's fleet in full (for tiers 1, 3 and 4) …
  const { data: mine } = await supabase
    .from("vehicles")
    .select("id, reg, vin, make, model, year, status")
    .eq("tenant_id", tenantId)
    .limit(5000);
  const fleet = (mine ?? []) as { id: string; reg: string; vin: string | null; make: string | null; model: string | null; year: number | null }[];

  const byPlate = new Map<string, { id: string; reg: string }>();
  const byVin = new Map<string, string[]>();
  for (const v of fleet) {
    const p = normPlate(v.reg);
    if (p) byPlate.set(p, { id: v.id, reg: v.reg });
    if (v.vin) {
      const k = v.vin.toUpperCase().trim();
      byVin.set(k, [...(byVin.get(k) ?? []), v.id]);
    }
  }

  // … and every plate on the PLATFORM, so tier 2 can detect a plate that
  // belongs to a different operator. vehicles.reg is globally unique with no
  // tenant in the key, so this collision is real and must be a hard stop —
  // never a match, never an auto-create. Only id/tenant_id/reg is read, and
  // the other operator is never named back to the caller.
  const { data: everyPlate } = await supabase
    .from("vehicles").select("id, tenant_id, reg").limit(20000);
  const foreignPlates = new Set<string>();
  for (const v of (everyPlate ?? []) as { id: string; tenant_id: string | null; reg: string }[]) {
    if (v.tenant_id === tenantId) continue;
    const p = normPlate(v.reg);
    if (p) foreignPlates.add(p);
  }

  // ---- build the plan ----------------------------------------------------
  const verdicts: Verdict[] = [];

  for (const row of staged) {
    const v: Verdict = {
      row_id: row.id,
      turo_reservation_id: row.reservation_id,
      guest: row.guest_name,
      turo_vehicle_string: row.vehicle_label ?? row.vehicle_plate ?? row.turo_vehicle_id,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      vehicle_match: "none",
      vehicle_id: null,
      vehicle_reg: null,
      needs_confirmation: true,
      rental_status: null,
      blocker: null,
      will_create: [],
    };

    // --- hard blockers, checked before any matching -----------------------
    if (row.source === "fixture") {
      // Demo data must never become a real booking. This is the whole reason
      // that column exists.
      v.blocker = "This is bundled demo data, not a real Turo booking.";
      verdicts.push(v); continue;
    }
    if (row.promoted_rental_id) {
      v.blocker = "Already imported.";
      verdicts.push(v); continue;
    }
    if (!row.starts_at || !row.ends_at) {
      v.blocker = "Turo did not give us usable start and end times for this trip, so we will not guess them.";
      verdicts.push(v); continue;
    }
    if (!["OBSERVED", "COMPLETED_HOLD"].includes(row.presence_state)) {
      v.blocker = `This booking is ${row.presence_state.toLowerCase().replace(/_/g, " ")} in Turo — importing it would block a car for a trip that may not be happening.`;
      verdicts.push(v); continue;
    }

    // --- THE VEHICLE LADDER ----------------------------------------------
    const chosen = vehicleChoices[row.id];
    if (chosen) {
      const hit = fleet.find((f) => f.id === chosen);
      if (!hit) {
        // A vehicle id from the body that is not in this tenant's fleet. Not
        // explained further — cross-tenant probing gets nothing back.
        v.blocker = "The vehicle you picked is not in this account's fleet.";
        verdicts.push(v); continue;
      }
      v.vehicle_match = "manual"; v.vehicle_id = hit.id; v.vehicle_reg = hit.reg;
      v.needs_confirmation = false;   // the operator IS the confirmation
    } else {
      const plates = [normPlate(row.vehicle_plate), ...platesFromLabel(row.vehicle_label)].filter(Boolean) as string[];

      // T1 — plate, exact, inside this tenant. The ONLY tier that promotes
      //      without a per-row human click.
      const t1 = plates.map((p) => byPlate.get(p)).find(Boolean);
      if (t1) {
        v.vehicle_match = "plate"; v.vehicle_id = t1.id; v.vehicle_reg = t1.reg;
        v.needs_confirmation = false;
      } else if (plates.some((p) => foreignPlates.has(p))) {
        // T2 — HARD STOP. Never match, never create.
        v.blocker = "That number plate is registered to another operator on this platform. Contact support before importing this booking.";
        verdicts.push(v); continue;
      } else {
        // T3 — VIN. SUGGEST ONLY, and only when it is unique inside this
        //      tenant. Live: 400 non-null VINs across 326 distinct values, so
        //      74 vehicles share a VIN with another row. VIN is a hint, never a
        //      join key.
        const vins = vinsFromText(row.vehicle_label, row.vehicle_plate);
        const vinHits = vins.flatMap((k) => byVin.get(k) ?? []);
        if (vinHits.length === 1) {
          const hit = fleet.find((f) => f.id === vinHits[0])!;
          v.vehicle_match = "vin"; v.vehicle_id = hit.id; v.vehicle_reg = hit.reg;
          v.needs_confirmation = true;
        } else {
          // T4 — year/make/model out of the display string. SUGGEST ONLY, and
          //      only when exactly one vehicle matches.
          const label = (row.vehicle_label ?? "").toLowerCase();
          const t4 = fleet.filter((f) =>
            f.make && f.model &&
            label.includes(f.make.toLowerCase()) &&
            label.includes(f.model.toLowerCase()) &&
            (!f.year || label.includes(String(f.year))));
          if (t4.length === 1) {
            v.vehicle_match = "label"; v.vehicle_id = t4[0].id; v.vehicle_reg = t4[0].reg;
            v.needs_confirmation = true;
          }
        }
      }
    }

    if (!v.vehicle_id) {
      // T5 — zero or many. A rental with no vehicle blocks nothing, which
      // defeats the entire purpose of the import, so this is a blocker rather
      // than a silent NULL.
      v.blocker = "We could not tell which of your cars this is. Pick one, or add the car to Drive247 first.";
      verdicts.push(v); continue;
    }

    v.rental_status = rentalStatusFor(row, Date.now());
    v.will_create = ["rental", ...(row.guest_name ? ["placeholder guest"] : [])];
    verdicts.push(v);
  }

  // ---- ABSOLUTE COUNTERS, FROM OUR OWN TABLE ----------------------------
  // Never processed/total, never a percentage, and the word "complete" never
  // appears — a truncated Turo read must not be able to render as 8/8 green.
  const ready = verdicts.filter((v) => !v.blocker && !v.needs_confirmation);
  const needsCar = verdicts.filter((v) => v.blocker?.startsWith("We could not tell"));
  const needsConfirm = verdicts.filter((v) => !v.blocker && v.needs_confirmation);
  const alreadyDone = verdicts.filter((v) => v.blocker === "Already imported.");
  const otherBlocked = verdicts.filter((v) => v.blocker && v.blocker !== "Already imported." && !v.blocker.startsWith("We could not tell"));

  const counts = {
    ready: ready.length,
    need_a_vehicle: needsCar.length,
    need_your_confirmation: needsConfirm.length,
    already_imported: alreadyDone.length,
    cannot_import: otherBlocked.length,
  };

  // The plan hash covers EXACTLY what an apply would act on. A staged row
  // re-synced with new dates, a vehicle reassigned, or a row promoted in
  // another tab all change it — and apply then refuses.
  const planHash = await sha256Hex(canonical({
    tenant_id: tenantId,
    rows: ready.map((v) => ({
      row_id: v.row_id, reservation_id: v.turo_reservation_id, vehicle_id: v.vehicle_id,
      starts_at: v.starts_at, ends_at: v.ends_at, status: v.rental_status, match: v.vehicle_match,
    })).sort((a, b) => a.row_id.localeCompare(b.row_id)),
  }));

  const planPayload = {
    ok: true,
    action: "plan",
    plan_hash: planHash,
    counts,
    rows: verdicts,
    truncated: stagedTruncated,
    truncation_note: stagedTruncated
      ? `More than ${MAX_ROWS} staged bookings exist; this plan covers the first ${MAX_ROWS}. Import these, then plan again.`
      : null,
    acknowledgements_required: [
      { key: "vehicles_confirmed", text: "I have checked that each booking is matched to the right car." },
      { key: "placeholder_guests", text: `${ready.filter((v) => v.will_create.includes("placeholder guest")).length} placeholder guests will be created with no email or phone. They will not be contacted.` },
      { key: "no_invoices", text: "No invoice, charge or receivable will be raised for these bookings." },
    ],
    notes: [
      "Turo collected the money for these trips. Drive247 will not invoice for them, and none of them will appear as money you are owed.",
      "No availability blocks are written — the imported booking itself holds the dates.",
    ],
  };

  if (action === "plan") return jsonResponse(planPayload);
  if (action !== "apply") return errorResponse("`action` must be one of: preflight, plan, apply, revert.", 400);

  // =========================================================================
  // APPLY
  // =========================================================================
  const approvedHash = asText(body.plan_hash, 128);
  if (!approvedHash) return errorResponse("`plan_hash` is required — apply only ever runs a plan a person has looked at.", 400);

  if (approvedHash !== planHash) {
    // ⚠ DRIFT. Approving a stale plan is exactly how the wrong car gets
    //   blocked. Refuse and show what moved.
    return jsonResponse({
      ok: false,
      refused: true,
      reason: "plan_changed",
      message:
        "These bookings have changed since you reviewed them — a sync may have updated dates, or someone may have imported some of them already. " +
        "Nothing was written. Review the new plan and confirm again.",
      approved_plan_hash: approvedHash,
      current_plan_hash: planHash,
      current_counts: counts,
    }, 409);
  }

  const acks = (body.acknowledgements && typeof body.acknowledgements === "object")
    ? body.acknowledgements as Record<string, unknown> : {};
  const missingAcks = planPayload.acknowledgements_required
    .filter((a) => acks[a.key] !== true).map((a) => a.key);
  if (missingAcks.length > 0) {
    return errorResponse(`Please confirm: ${missingAcks.join(", ")}.`, 400);
  }
  if (ready.length === 0) {
    return jsonResponse({ ok: true, action: "apply", nothing_to_do: true, counts });
  }

  // ---- idempotency layer 3: replaying an approved hash returns the ORIGINAL
  //      batch rather than creating a second one.
  const { data: existingBatch } = await supabase
    .from("turo_promotion_batches")
    .select("id, created_at, counts, reverted_at")
    .eq("tenant_id", tenantId).eq("plan_hash", planHash).maybeSingle();

  if (existingBatch && !existingBatch.reverted_at) {
    return jsonResponse({
      ok: true, action: "apply", replayed: true,
      batch_id: existingBatch.id, counts: existingBatch.counts,
      message: "These bookings were already imported by this exact plan. Nothing was imported twice.",
    });
  }

  const { data: batch, error: batchError } = await supabase
    .from("turo_promotion_batches")
    .insert({
      tenant_id: tenantId, actor_app_user_id: actorId, plan_hash: planHash,
      counts, acknowledgements: acks,
    })
    .select("id").single();
  if (batchError || !batch) {
    console.error("[TURO-PROMOTE] could not open a batch:", batchError?.message);
    return errorResponse("Could not start the import.", 500);
  }
  const batchId = batch.id as string;

  const results: Record<string, unknown>[] = [];
  let imported = 0;
  const conflicts: Record<string, unknown>[] = [];

  for (const v of ready) {
    const row = staged.find((s) => s.id === v.row_id)!;

    // ---- 1. the placeholder contact ------------------------------------
    let customerId: string | null = null;
    try {
      customerId = await ensurePlaceholderGuest(supabase, tenantId, row, batchId, nowIso);
    } catch (e) {
      results.push({ reservation_id: row.reservation_id, imported: false, because: `guest: ${(e as Error).message}` });
      continue;
    }

    // ---- 2. the confirmed vehicle mapping -------------------------------
    // confirmed_by is NOT NULL by design: there is no code path to an
    // auto-created mapping. The operator approving this plan IS the human.
    let mapId: string | null = null;
    try {
      mapId = await ensureVehicleMap(supabase, tenantId, row, v, actorId, nowIso);
    } catch (e) {
      results.push({ reservation_id: row.reservation_id, imported: false, because: `vehicle mapping: ${(e as Error).message}` });
      continue;
    }

    // ---- 3. stage the row (pending_match -> staged) ----------------------
    const { error: stageError } = await supabase
      .from("turo_bridge_reservations")
      .update({
        sync_state: "staged",
        matched_vehicle_id: v.vehicle_id,
        vehicle_map_id: mapId,
        match_basis: v.vehicle_match === "plate" ? "label_exact" : "human",
        vehicle_match_method: v.vehicle_match === "plate" ? "plate_exact"
          : v.vehicle_match === "vin" ? "vin_suggested"
          : v.vehicle_match === "label" ? "label_parsed" : "operator",
        vehicle_match_confidence: v.vehicle_match === "plate" ? 1.0 : v.vehicle_match === "manual" ? 1.0 : 0.6,
        turo_bridge_customer_id: null,
        updated_at: nowIso,
      })
      .eq("id", row.id).eq("tenant_id", tenantId);
    if (stageError) {
      results.push({ reservation_id: row.reservation_id, imported: false, because: `staging: ${stageError.message}` });
      continue;
    }

    // ---- 4. the rental ---------------------------------------------------
    const outcome = await insertRental(supabase, {
      tenantId, row, verdict: v, customerId, batchId, nowIso,
    });

    if (!outcome.ok) {
      if (outcome.conflict) {
        // check_rental_overlap said no. That is the safety net working: this
        // car is already sold for these dates. Never retried, never widened,
        // never date-shifted to fit.
        conflicts.push({
          tenant_id: tenantId, reservation_row_id: row.id, vehicle_id: v.vehicle_id,
          kind: "overlap_committed", severity: "blocking",
          overlap_start: row.starts_at, overlap_end: row.ends_at,
          detail: {
            turo_reservation_id: row.reservation_id,
            vehicle_reg: v.vehicle_reg,
            note: "Drive247 already has a booking on this car for these dates, so the Turo trip was not imported. Someone needs to look at this: two people may be expecting the same car.",
          },
        });
        await supabase.from("turo_bridge_reservations")
          .update({ sync_state: "conflict", state_reason: "overlaps an existing Drive247 booking", updated_at: nowIso })
          .eq("id", row.id).eq("tenant_id", tenantId);
      }
      results.push({ reservation_id: row.reservation_id, imported: false, because: outcome.reason });
      continue;
    }

    // ---- 5. mark it promoted --------------------------------------------
    const { error: promoteError } = await supabase
      .from("turo_bridge_reservations")
      .update({
        status: "imported",                    // the legacy import lane
        sync_state: "promoted",
        promoted_rental_id: outcome.rentalId,
        promoted_at: nowIso,
        promoted_by: actorId,
        promotion_batch_id: batchId,
        updated_at: nowIso,
      })
      .eq("id", row.id).eq("tenant_id", tenantId);

    if (promoteError) {
      // The rental exists but we could not record that it does. Say so plainly
      // rather than silently leaving a row that a second apply would duplicate
      // — though rentals_turo_reservation_uniq would catch that too.
      console.error("[TURO-PROMOTE] rental created but not linked:", promoteError.message);
      results.push({
        reservation_id: row.reservation_id, imported: true, rental_id: outcome.rentalId,
        warning: `The booking was created but could not be linked back: ${promoteError.message}`,
      });
      imported++;
      continue;
    }

    imported++;
    results.push({
      reservation_id: row.reservation_id, imported: true,
      rental_id: outcome.rentalId, rental_number: outcome.rentalNumber,
      vehicle_reg: v.vehicle_reg, status: v.rental_status,
    });
  }

  for (const c of conflicts) {
    // ⚠ NOT an upsert. turo_bridge_conflicts_open_unique is a PARTIAL index
    //   (WHERE resolved_at IS NULL) and Postgres will not infer a partial index
    //   as an ON CONFLICT arbiter unless the statement repeats its predicate,
    //   which PostgREST cannot emit — so an upsert here fails with 42P10 every
    //   time, not only on a collision. Insert, and treat an existing OPEN
    //   conflict of the same kind as already-reported.
    const { error } = await supabase.from("turo_bridge_conflicts").insert(c);
    if (error && error.code !== "23505") {
      // A collision we could not record is a collision nobody will be told
      // about — two people expecting the same car. Loud, never fatal.
      console.error("[TURO-PROMOTE] conflict write failed:", error.message);
    }
  }

  // ONE summary notification, replacing the per-rental broadcast that
  // on_rental_created_notify would otherwise have written 200 times.
  await supabase.from("notifications").insert({
    tenant_id: tenantId,
    user_id: null,
    type: "system",
    title: "Turo bookings imported",
    message: `${imported} Turo booking${imported === 1 ? "" : "s"} imported. No invoices were raised — Turo collected the money for these trips.`,
    link: "/turo-bridge",
  }).then(() => {}, (e: unknown) => console.error("[TURO-PROMOTE] summary notification failed:", e));

  await supabase.from("turo_promotion_batches")
    .update({ counts: { ...counts, imported, conflicts: conflicts.length } })
    .eq("id", batchId).eq("tenant_id", tenantId);

  console.log(`[TURO-PROMOTE] batch ${batchId} tenant ${tenantId}: ${imported} imported, ${conflicts.length} conflicts, actor ${actorId}`);

  return jsonResponse({
    ok: true,
    action: "apply",
    batch_id: batchId,
    counts: { ...counts, imported, conflicts: conflicts.length },
    results,
    message:
      `${imported} booking${imported === 1 ? "" : "s"} imported. ` +
      "No invoices were raised and no guests were contacted." +
      (conflicts.length > 0 ? ` ${conflicts.length} could not be imported because the car is already booked — check the conflicts list.` : ""),
  });
});

// ---------------------------------------------------------------------------
/**
 * Turo's own trip state -> our rental status.
 *
 * The 48h hold is load-bearing: a guest can extend up to 24h AFTER a trip ends
 * and Turo auto-accepts, so a trip that ended yesterday may not be over. The
 * status is also the ONLY control over trigger #8
 * (update_vehicle_status_on_rental_change), which flips vehicles.status to
 * 'Rented' on INSERT and ONLY when status = 'Active' — correct for a trip
 * running right now, wrong for anything in the future.
 */
function rentalStatusFor(row: Staged, nowMs: number): string {
  const s = ms(row.starts_at); const e = ms(row.ends_at);
  if (s === null || e === null) return "Pending";
  if (nowMs < s) return "Pending";
  if (nowMs <= e) return "Active";
  if (nowMs < e + 48 * 3600 * 1000) return "Active";   // the extension hold
  return "Closed";
}

/**
 * A placeholder contact. Name only. The shape is not novel — 110 of 517 live
 * customers already have no email.
 *
 * turo_guest_ref doubles as the idempotency key and as the suppression key for
 * customers_create_chat_channel (03 §16), so a ghost guest never gets a support
 * channel nobody can answer.
 */
async function ensurePlaceholderGuest(
  supabase: SupabaseClient, tenantId: string, row: Staged, batchId: string, nowIso: string,
): Promise<string | null> {
  const name = asText(row.guest_name, 160);
  if (!name) return null;   // no name, no placeholder. We do not invent people.

  const ref = row.turo_guest_id
    ? `gid:${row.turo_guest_id}`
    : `nm:${await sha256Hex(`${tenantId}|${name.toLowerCase()}|${row.reservation_id}`)}`.slice(0, 80);

  const { data: existing } = await supabase
    .from("customers").select("id")
    .eq("tenant_id", tenantId).eq("turo_guest_ref", ref).maybeSingle();
  if (existing) return existing.id as string;

  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: tenantId,
      type: "Individual",
      name,
      email: null,
      phone: null,
      sms_consent: false,      // NOT NULL default false. Never flipped here.
      status: "Active",
      turo_guest_ref: ref,
      turo_promotion_batch_id: batchId,
      updated_at: nowIso,
    })
    .select("id").single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("customers").select("id")
        .eq("tenant_id", tenantId).eq("turo_guest_ref", ref).maybeSingle();
      if (raced) return raced.id as string;
    }
    throw new Error(error.message);
  }
  return created!.id as string;
}

/**
 * turo_vehicle_map.confirmed_by is NOT NULL by design — there is no code path
 * to an auto-created mapping anywhere in this system. The operator who approved
 * the plan containing this match is that human, and their id goes on the row.
 */
async function ensureVehicleMap(
  supabase: SupabaseClient, tenantId: string, row: Staged, v: Verdict, actorId: string, nowIso: string,
): Promise<string> {
  const matchKeySource = row.turo_vehicle_id
    ? { turo_vehicle_id: row.turo_vehicle_id, display_label: row.vehicle_label }
    : { turo_vehicle_id: null, display_label: row.vehicle_label ?? row.vehicle_plate ?? row.reservation_id };

  // match_key is GENERATED; find an existing mapping by the same inputs.
  let q = supabase.from("turo_vehicle_map")
    .select("id, vehicle_id, is_active").eq("tenant_id", tenantId);
  q = matchKeySource.turo_vehicle_id
    ? q.eq("turo_vehicle_id", matchKeySource.turo_vehicle_id)
    : q.is("turo_vehicle_id", null).eq("display_label", matchKeySource.display_label);

  const { data: found } = await q.limit(1).maybeSingle();
  if (found) return found.id as string;

  const { data: created, error } = await supabase
    .from("turo_vehicle_map")
    .insert({
      tenant_id: tenantId,
      turo_vehicle_id: matchKeySource.turo_vehicle_id,
      display_label: matchKeySource.display_label,
      vehicle_id: v.vehicle_id,
      // Hints, never join keys, and carried with no index for exactly that reason.
      plate_hint: row.vehicle_plate,
      confirmed_by: actorId,
      confirmed_at: nowIso,
      confirmation_note: `confirmed during Turo import (${v.vehicle_match} match)`,
    })
    .select("id").single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await q.limit(1).maybeSingle();
      if (raced) return raced.id as string;
    }
    throw new Error(error.message);
  }
  return created!.id as string;
}

/**
 * One rental, one statement.
 *
 * rental_number is generated by a BEFORE trigger as 'R-' + the first 6 hex of
 * the row's uuid, under a UNIQUE constraint with NO retry inside the trigger.
 * Over a bulk import the birthday risk is small but a collision would hard-abort
 * the whole batch, so we supply the id ourselves and retry with a fresh one.
 */
async function insertRental(
  supabase: SupabaseClient,
  args: { tenantId: string; row: Staged; verdict: Verdict; customerId: string | null; batchId: string; nowIso: string },
): Promise<{ ok: true; rentalId: string; rentalNumber: string | null } | { ok: false; reason: string; conflict: boolean }> {
  const { tenantId, row, verdict, customerId, batchId, nowIso } = args;

  const startDate = (row.starts_at ?? "").slice(0, 10);
  const endDate = (row.ends_at ?? "").slice(0, 10);
  if (!startDate || !endDate) return { ok: false, reason: "no usable dates", conflict: false };

  for (let attempt = 0; attempt < MAX_RENTAL_NUMBER_RETRIES; attempt++) {
    const id = crypto.randomUUID();
    const { data, error } = await supabase
      .from("rentals")
      .insert({
        id,
        tenant_id: tenantId,
        vehicle_id: verdict.vehicle_id,        // MANDATORY — a NULL blocks nothing
        customer_id: customerId,
        start_date: startDate,
        end_date: endDate,
        // ⚠ NOT a claim. Turo gives a trip TOTAL, not a monthly rate, and there
        //   is no honest derivation. It is written so the figure is not lost,
        //   the charge trigger is suppressed so it is never billed, and
        //   turo_total_amount carries the same number under a name that says
        //   what it is.
        monthly_amount: row.total_amount ?? 0,
        turo_total_amount: row.total_amount,
        payment_status: "fulfilled",           // Turo already collected; we did not
        status: verdict.rental_status,
        approval_status: "approved",
        approved_at: nowIso,
        source: "turo_import",                 // <<< THE SUPPRESSION KEY (03 §16)
        turo_reservation_id: row.reservation_id,
        turo_promoted_at: nowIso,
        turo_promotion_batch_id: batchId,
        turo_vehicle_match: verdict.vehicle_match,
        // POSITIVE suppression of send-return-reminders (cron 22, */15). Its own
        // `if (!customer.email) continue` guard is ABSENCE-driven and evaporates
        // the day anyone backfills an email, so it is not relied on: this
        // pre-stamp excludes the row in the cron's own WHERE clause.
        return_reminder_sent_at: nowIso,
        // delivery_method stays NULL so send-lockbox-scheduled never sees it.
        // auto_extend_enabled / is_pay_as_you_go / has_installment_plan and every
        // deposit_hold_* column are left at their defaults ON PURPOSE — each one
        // is the gate on a cron that would otherwise start running against a
        // guest we cannot contact.
        //
        // document_status stays at its 'pending' default. Turo held its own
        // agreement; claiming 'completed' would be a lie, and the booking
        // appearing in the agreements queue with a Turo badge is honest.
        notes: `Imported from Turo trip ${row.reservation_id}. Payment was collected by Turo; no Drive247 invoice was raised.`,
      })
      .select("id, rental_number").single();

    if (!error) return { ok: true, rentalId: data!.id as string, rentalNumber: (data!.rental_number as string) ?? null };

    // 23P01 exclusion_violation / 23P02 — check_rental_overlap. The car is
    // already sold for these dates. A same-day turnaround lands here too:
    // rentals dates are DATE with an INCLUSIVE end, so a 10:00 handback and a
    // 16:00 pickup on one date read as an overlap. Reported for a human; never
    // silently date-shifted to make it fit.
    if (error.code === "23P01" || error.code === "23P02" || /overlap/i.test(error.message)) {
      return { ok: false, reason: error.message, conflict: true };
    }
    // Only a rental_number collision is worth another spin of the wheel.
    if (error.code === "23505" && /rental_number/.test(error.message)) continue;
    if (error.code === "23505" && /turo_reservation/.test(error.message)) {
      return { ok: false, reason: "already imported", conflict: false };
    }
    return { ok: false, reason: error.message, conflict: false };
  }
  return { ok: false, reason: "could not allocate a unique booking reference", conflict: false };
}

// ---------------------------------------------------------------------------
/**
 * REVERT.
 *
 * DELETEs the rentals rather than setting status='Cancelled'. A cancelled
 * rental stops blocking (check_rental_overlap excludes it) but lingers in the
 * customer's history and in reports as a booking that never existed. The DELETE
 * branch of update_vehicle_status_on_rental_change already resets the vehicle
 * to 'Available', and only when no other Active rental exists on it.
 *
 * The batch row is NEVER deleted. The audit trail outlives the data it
 * describes.
 */
async function revertBatch(
  supabase: SupabaseClient, tenantId: string, actorId: string, batchId: string | null, nowIso: string,
): Promise<Response> {
  if (!batchId) return errorResponse("`batch_id` is required.", 400);

  const { data: batch } = await supabase
    .from("turo_promotion_batches").select("id, reverted_at")
    .eq("id", batchId).eq("tenant_id", tenantId).maybeSingle();
  if (!batch) return errorResponse("Unknown import.", 404);
  if (batch.reverted_at) return jsonResponse({ ok: true, already_reverted: true, batch_id: batchId });

  const { data: rentals } = await supabase
    .from("rentals")
    .select("id, rental_number, updated_at, turo_promoted_at, turo_reservation_id, customer_id")
    .eq("tenant_id", tenantId).eq("turo_promotion_batch_id", batchId);

  const rentalRows = (rentals ?? []) as {
    id: string; rental_number: string | null; updated_at: string; turo_promoted_at: string | null;
    turo_reservation_id: string | null; customer_id: string | null;
  }[];

  // ---- has anybody started working these? -------------------------------
  const blocked: Record<string, unknown>[] = [];
  for (const r of rentalRows) {
    const reasons: string[] = [];
    const promoted = ms(r.turo_promoted_at);
    const touched = ms(r.updated_at);
    // A 2s grace: the promote statement's own triggers stamp updated_at.
    if (promoted !== null && touched !== null && touched > promoted + 2000) {
      reasons.push("it has been edited since it was imported");
    }
    for (const table of ACTIVITY_TABLES) {
      const { count, error } = await supabase
        .from(table).select("rental_id", { count: "exact", head: true }).eq("rental_id", r.id);
      if (error) {
        // Cannot prove it is untouched => treat it as touched. Refusing to
        // revert costs a manual cancellation; reverting a rental that has money
        // attached to it does not have a cheap undo.
        reasons.push(`we could not check ${table}`);
        continue;
      }
      if ((count ?? 0) > 0) reasons.push(`it has ${table.replace(/_/g, " ")}`);
    }
    if (reasons.length > 0) blocked.push({ rental_id: r.id, rental_number: r.rental_number, reasons });
  }

  if (blocked.length > 0) {
    return jsonResponse({
      ok: false,
      refused: true,
      reason: "rentals_in_use",
      message:
        "This import cannot be undone automatically: some of the bookings have been worked on since. " +
        "Nothing was changed. Cancel those bookings by hand, then try again.",
      blocked,
    }, 409);
  }

  const rentalIds = rentalRows.map((r) => r.id);
  let deleted = 0;
  if (rentalIds.length > 0) {
    const { error, count } = await supabase
      .from("rentals").delete({ count: "exact" })
      .eq("tenant_id", tenantId).in("id", rentalIds);
    if (error) {
      console.error("[TURO-PROMOTE] revert delete failed:", error.message);
      return errorResponse("Could not undo the import.", 500);
    }
    deleted = count ?? rentalIds.length;
  }

  // Placeholder guests, ONLY when nothing else references them.
  const { data: guests } = await supabase
    .from("customers").select("id")
    .eq("tenant_id", tenantId).eq("turo_promotion_batch_id", batchId);
  let guestsDeleted = 0;
  for (const g of (guests ?? []) as { id: string }[]) {
    const { count: rentalCount } = await supabase
      .from("rentals").select("id", { count: "exact", head: true }).eq("customer_id", g.id);
    if ((rentalCount ?? 0) > 0) continue;
    const { count: userCount } = await supabase
      .from("customer_users").select("id", { count: "exact", head: true }).eq("customer_id", g.id);
    if ((userCount ?? 0) > 0) continue;
    const { error } = await supabase.from("customers").delete().eq("id", g.id).eq("tenant_id", tenantId);
    if (!error) guestsDeleted++;
  }

  // Back to 'synced' so the trips can be reviewed and imported again. Note the
  // staged rows themselves are NEVER deleted — nothing in this system deletes
  // one, ever.
  const { data: stagedBack } = await supabase
    .from("turo_bridge_reservations")
    .update({
      status: "synced", sync_state: "staged",
      promoted_rental_id: null, promoted_at: null, promoted_by: null,
      promotion_batch_id: null, updated_at: nowIso,
    })
    .eq("tenant_id", tenantId).eq("promotion_batch_id", batchId)
    .select("id");

  await supabase.from("turo_promotion_batches")
    .update({
      reverted_at: nowIso, reverted_by: actorId,
      revert_report: { rentals_deleted: deleted, placeholder_guests_deleted: guestsDeleted },
    })
    .eq("id", batchId).eq("tenant_id", tenantId);

  console.log(`[TURO-PROMOTE] batch ${batchId} reverted by ${actorId}: ${deleted} rentals, ${guestsDeleted} guests`);

  return jsonResponse({
    ok: true,
    action: "revert",
    batch_id: batchId,
    rentals_deleted: deleted,
    placeholder_guests_deleted: guestsDeleted,
    staged_rows_reset: (stagedBack ?? []).length,
    message: `Undone. ${deleted} imported booking${deleted === 1 ? "" : "s"} removed and the cars are free again. The record of the import itself is kept.`,
  });
}
