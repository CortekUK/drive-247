/**
 * revenue-optimiser-autopilot-run — Spec §5 + §13.
 *
 * Daily cron, runs 08:00 UTC — one hour after `revenue-optimiser-generate` so
 * that today's pending recs already exist. For each tenant in
 * `mode='autopilot'`, this fn walks today's pending recs and decides per-rec:
 *
 *   1. Outcome-dependency check
 *      - Vehicle has 2 most-recent outcomes both `negative` → skip + set
 *        revenue_optimiser_rules.paused_until = NOW() + 30 days.
 *      - Vehicle's rule has paused_until > NOW() → skip silently.
 *
 *   2. Rules / bounds check
 *      - Resolve effective rule for this vehicle: prefer vehicle-scoped row,
 *        fall back to category-scoped row, fall back to "no rule".
 *      - Autopilot only acts when the resolved rule has autopilot_enabled=true.
 *        Otherwise the rec is left pending for manual review.
 *      - Clamp the recommended price into [min_price_<tier>, max_price_<tier>]
 *        if both bounds are set. If clamping forces a price *above* the
 *        recommended range or *below* the cost floor, skip + log.
 *
 *   3. Approval threshold gate (Spec §13.6)
 *      - If |delta| > settings.require_approval_above_amount, mark the rec
 *        `status='pending_approval'` and continue. No price change made.
 *
 *   4. A/B framing (Spec §13.8)
 *      - For category-scoped autopilot rules with ≥4 eligible vehicles, half
 *        the category at random becomes the *control* arm (rec NOT applied,
 *        status='dismissed'+dismiss_reason='ab_control'), the other half the
 *        *test* arm (rec applied, applied_source='autopilot').
 *      - One pricing_experiments row per (tenant, category, tier) per day.
 *
 *   5. Apply
 *      - Replays the same logic as `revenue-optimiser-apply` (vehicle UPDATE,
 *        pricing_change_history INSERT, rec UPDATE) but with
 *        `applied_source='autopilot'` + `applied_by=NULL`.
 *
 * The fn is idempotent on (tenant_id, autopilot_run_id) — re-running the cron
 * on the same day won't double-apply because we tag a unique run_id and skip
 * recs already touched in this run.
 */
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const TIER_TO_COLUMN: Record<string, string> = {
  daily: "daily_rent",
  weekly: "weekly_rent",
  monthly: "monthly_rent",
};
const PRIMARY_TIER = "weekly";
/** Category needs ≥ this many recs to be eligible for an A/B split. */
const AB_MIN_CATEGORY_SIZE = 4;
/** Pause-vehicle duration when 2 outcomes in a row are negative. */
const NEGATIVE_OUTCOME_PAUSE_DAYS = 30;
/** A/B experiment runs for 14 days, matching outcome measurement window. */
const AB_EXPERIMENT_DAYS = 14;

interface SettingsRow {
  tenant_id: string;
  enabled: boolean;
  mode: string;
  max_swing_percent: number;
  cost_floor_enabled: boolean;
  require_approval_above_amount: number | null;
}
interface RecRow {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  tier: string;
  current_price: number;
  recommended_price: number;
  projected_revenue_delta_monthly: number | null;
  confidence: string;
  status: string;
}
interface VehicleRow {
  id: string;
  category: string | null;
  daily_rent: number | null;
  weekly_rent: number | null;
  monthly_rent: number | null;
  cost_floor_daily: number | null;
  cost_floor_weekly: number | null;
  cost_floor_monthly: number | null;
}
interface RuleRow {
  id: string;
  tenant_id: string;
  vehicle_id: string | null;
  category: string | null;
  autopilot_enabled: boolean;
  paused_until: string | null;
  min_price_daily: number | null;
  max_price_daily: number | null;
  min_price_weekly: number | null;
  max_price_weekly: number | null;
  min_price_monthly: number | null;
  max_price_monthly: number | null;
}
interface OutcomeRow {
  recommendation_id: string;
  outcome: string;
  measured_at: string;
}

interface Summary {
  tenants_processed: number;
  pending_evaluated: number;
  applied_autopilot: number;
  pending_approval: number;
  vehicle_paused_for_negative_outcomes: number;
  rule_paused_skipped: number;
  rule_missing_skipped: number;
  ab_experiments_started: number;
  ab_control_dismissed: number;
  clamped_to_rule: number;
  cost_floor_blocked: number;
  max_swing_blocked: number;
  errors: string[];
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const runId = crypto.randomUUID();
    const summary: Summary = {
      tenants_processed: 0,
      pending_evaluated: 0,
      applied_autopilot: 0,
      pending_approval: 0,
      vehicle_paused_for_negative_outcomes: 0,
      rule_paused_skipped: 0,
      rule_missing_skipped: 0,
      ab_experiments_started: 0,
      ab_control_dismissed: 0,
      clamped_to_rule: 0,
      cost_floor_blocked: 0,
      max_swing_blocked: 0,
      errors: [],
    };

    const { data: settingsRaw } = await supabase
      .from("revenue_optimiser_settings")
      .select("tenant_id, enabled, mode, max_swing_percent, cost_floor_enabled, require_approval_above_amount")
      .eq("enabled", true)
      .eq("mode", "autopilot");
    const tenants = (settingsRaw ?? []) as SettingsRow[];

    for (const settings of tenants) {
      summary.tenants_processed++;
      try {
        await processTenant(supabase, settings, runId, summary);
      } catch (err) {
        summary.errors.push(`${settings.tenant_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return jsonResponse({ runId, ...summary });
  } catch (err) {
    console.error("revenue-optimiser-autopilot-run error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});

async function processTenant(
  supabase: SupabaseClient,
  settings: SettingsRow,
  runId: string,
  summary: Summary,
) {
  // Today's pending recs for this tenant
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const { data: recsRaw } = await supabase
    .from("pricing_recommendations")
    .select("id, tenant_id, vehicle_id, tier, current_price, recommended_price, projected_revenue_delta_monthly, confidence, status")
    .eq("tenant_id", settings.tenant_id)
    .eq("status", "pending")
    .eq("tier", PRIMARY_TIER)
    .gte("created_at", todayStart.toISOString());
  const recs = (recsRaw ?? []) as RecRow[];
  if (recs.length === 0) return;
  summary.pending_evaluated += recs.length;

  // Vehicles, rules, recent outcomes — fetched in bulk
  const vehicleIds = recs.map((r) => r.vehicle_id);
  const { data: vehRaw } = await supabase
    .from("vehicles")
    .select("id, category, daily_rent, weekly_rent, monthly_rent, cost_floor_daily, cost_floor_weekly, cost_floor_monthly")
    .in("id", vehicleIds);
  const vehicleById = new Map<string, VehicleRow>(
    ((vehRaw ?? []) as VehicleRow[]).map((v) => [v.id, v]),
  );

  const { data: rulesRaw } = await supabase
    .from("revenue_optimiser_rules")
    .select("*")
    .eq("tenant_id", settings.tenant_id);
  const rules = (rulesRaw ?? []) as RuleRow[];
  const ruleByVehicle = new Map<string, RuleRow>();
  const ruleByCategory = new Map<string, RuleRow>();
  for (const r of rules) {
    if (r.vehicle_id) ruleByVehicle.set(r.vehicle_id, r);
    else if (r.category) ruleByCategory.set(r.category, r);
  }

  // Last 2 outcomes per vehicle, ordered by measured_at desc
  const lastTwoOutcomesByVehicle = await loadLast2Outcomes(supabase, settings.tenant_id, vehicleIds);

  // ── Per-rec decision ──
  type Decision =
    | { kind: "skip_paused"; rec: RecRow }
    | { kind: "skip_no_rule"; rec: RecRow }
    | { kind: "skip_negative_outcomes"; rec: RecRow; rule: RuleRow | null }
    | { kind: "pending_approval"; rec: RecRow; targetPrice: number }
    | { kind: "apply"; rec: RecRow; targetPrice: number; vehicle: VehicleRow; rule: RuleRow | null; clamped: boolean };

  const decisions: Decision[] = [];

  for (const rec of recs) {
    const vehicle = vehicleById.get(rec.vehicle_id);
    if (!vehicle) {
      summary.errors.push(`${settings.tenant_id}/${rec.id}: vehicle missing`);
      continue;
    }

    // Resolve effective rule: vehicle > category > none
    const rule = ruleByVehicle.get(vehicle.id) ?? (vehicle.category ? ruleByCategory.get(vehicle.category) : undefined) ?? null;

    if (!rule || !rule.autopilot_enabled) {
      // No autopilot rule → leave pending for manual review
      summary.rule_missing_skipped++;
      decisions.push({ kind: "skip_no_rule", rec });
      continue;
    }
    if (rule.paused_until && new Date(rule.paused_until).getTime() > Date.now()) {
      summary.rule_paused_skipped++;
      decisions.push({ kind: "skip_paused", rec });
      continue;
    }

    // Outcome-dependency: 2 negative in a row → pause vehicle
    const last2 = lastTwoOutcomesByVehicle.get(vehicle.id) ?? [];
    if (last2.length >= 2 && last2[0] === "negative" && last2[1] === "negative") {
      summary.vehicle_paused_for_negative_outcomes++;
      // Find vehicle-scoped rule (create if it doesn't exist) and set paused_until
      await pauseVehicleRule(supabase, settings.tenant_id, vehicle.id, vehicle.category);
      decisions.push({ kind: "skip_negative_outcomes", rec, rule });
      continue;
    }

    // Clamp recommended_price into rule bounds (if both set)
    const minKey = `min_price_${rec.tier}` as keyof RuleRow;
    const maxKey = `max_price_${rec.tier}` as keyof RuleRow;
    const minBound = Number(rule[minKey] ?? 0);
    const maxBound = Number(rule[maxKey] ?? 0);
    let targetPrice = Number(rec.recommended_price);
    let clamped = false;
    if (minBound > 0 && targetPrice < minBound) { targetPrice = minBound; clamped = true; }
    if (maxBound > 0 && targetPrice > maxBound) { targetPrice = maxBound; clamped = true; }
    if (clamped) summary.clamped_to_rule++;

    // Re-validate against tenant-level safety rails after clamping
    const currentPrice = Number(rec.current_price);
    const maxSwingPercent = Number(settings.max_swing_percent ?? 15);
    const minAllowed = currentPrice * (1 - maxSwingPercent / 100);
    const maxAllowed = currentPrice * (1 + maxSwingPercent / 100);
    if (targetPrice < minAllowed || targetPrice > maxAllowed) {
      summary.max_swing_blocked++;
      continue;
    }
    if (settings.cost_floor_enabled !== false) {
      const floor = Number((vehicle as Record<string, unknown>)[`cost_floor_${rec.tier}`] ?? 0);
      if (floor > 0 && targetPrice < floor) {
        summary.cost_floor_blocked++;
        continue;
      }
    }

    // Approval threshold gate — based on |delta from current|, in absolute $.
    const delta = Math.abs(targetPrice - currentPrice);
    const threshold = settings.require_approval_above_amount;
    if (threshold !== null && threshold !== undefined && delta > Number(threshold)) {
      summary.pending_approval++;
      decisions.push({ kind: "pending_approval", rec, targetPrice });
      continue;
    }

    decisions.push({ kind: "apply", rec, targetPrice, vehicle, rule, clamped });
  }

  // ── A/B framing for category-scoped rules ──
  // Group apply-decisions by (rule.category, tier). When a category has ≥4
  // apply decisions, pick half to be the control arm (NOT applied).
  const applyDecisions = decisions.filter((d) => d.kind === "apply") as Extract<Decision, { kind: "apply" }>[];
  const byCategoryTier = new Map<string, Extract<Decision, { kind: "apply" }>[]>();
  for (const d of applyDecisions) {
    const ruleScope = d.rule?.category && !d.rule.vehicle_id ? d.rule.category : null;
    if (!ruleScope) continue;
    const key = `${ruleScope}::${d.rec.tier}`;
    const arr = byCategoryTier.get(key) ?? [];
    arr.push(d);
    byCategoryTier.set(key, arr);
  }

  const controlIds = new Set<string>();
  const experimentByDecision = new Map<string, { experimentId: string; arm: "control" | "test" }>();

  for (const [key, group] of byCategoryTier) {
    if (group.length < AB_MIN_CATEGORY_SIZE) continue;
    const [category, tier] = key.split("::");
    const meanTestPrice = group.reduce((s, g) => s + g.targetPrice, 0) / group.length;
    const meanCurrentPrice = group.reduce((s, g) => s + g.rec.current_price, 0) / group.length;

    const shuffled = [...group].sort(() => Math.random() - 0.5);
    const controlCount = Math.floor(shuffled.length / 2);
    const control = shuffled.slice(0, controlCount);
    const test = shuffled.slice(controlCount);

    // Insert one experiment row per (tenant, category, tier).
    // Vehicle_id on the experiment row is required per Phase 0 schema; we use
    // the *first test-arm* vehicle as a representative — the per-vehicle arm
    // mapping is on each pricing_recommendation.experiment_id|experiment_arm.
    const repVehicleId = test[0]?.vehicle.id ?? control[0]?.vehicle.id;
    if (!repVehicleId) continue;
    const { data: expRow, error: expErr } = await supabase
      .from("pricing_experiments")
      .insert({
        tenant_id: settings.tenant_id,
        vehicle_id: repVehicleId,
        tier,
        control_price: Math.round(meanCurrentPrice * 100) / 100,
        test_price: Math.round(meanTestPrice * 100) / 100,
        ends_at: new Date(Date.now() + AB_EXPERIMENT_DAYS * 86_400_000).toISOString(),
        status: "running",
      })
      .select("id")
      .single();
    if (expErr || !expRow) {
      summary.errors.push(`${settings.tenant_id}: experiment insert failed: ${expErr?.message}`);
      continue;
    }
    summary.ab_experiments_started++;
    for (const d of control) {
      controlIds.add(d.rec.id);
      experimentByDecision.set(d.rec.id, { experimentId: expRow.id as string, arm: "control" });
    }
    for (const d of test) {
      experimentByDecision.set(d.rec.id, { experimentId: expRow.id as string, arm: "test" });
    }
  }

  // ── Execute decisions ──
  for (const d of decisions) {
    try {
      if (d.kind === "skip_paused" || d.kind === "skip_no_rule") continue;
      if (d.kind === "skip_negative_outcomes") {
        // Soft-dismiss the rec since the vehicle is now paused
        await supabase
          .from("pricing_recommendations")
          .update({
            status: "dismissed",
            dismissed_at: new Date().toISOString(),
            dismiss_reason: "autopilot_paused_after_two_negative_outcomes",
            autopilot_run_id: runId,
          })
          .eq("id", d.rec.id);
        continue;
      }
      if (d.kind === "pending_approval") {
        await supabase
          .from("pricing_recommendations")
          .update({
            status: "pending_approval",
            autopilot_run_id: runId,
          })
          .eq("id", d.rec.id);
        continue;
      }

      // d.kind === "apply"
      if (controlIds.has(d.rec.id)) {
        const exp = experimentByDecision.get(d.rec.id);
        await supabase
          .from("pricing_recommendations")
          .update({
            status: "dismissed",
            dismissed_at: new Date().toISOString(),
            dismiss_reason: "ab_control",
            experiment_id: exp?.experimentId ?? null,
            experiment_arm: "control",
            autopilot_run_id: runId,
          })
          .eq("id", d.rec.id);
        summary.ab_control_dismissed++;
        continue;
      }

      await applyOne(supabase, d, runId, experimentByDecision.get(d.rec.id) ?? null);
      summary.applied_autopilot++;
    } catch (err) {
      summary.errors.push(`${d.rec.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Apply one rec: UPDATE vehicle, INSERT audit, UPDATE rec. */
async function applyOne(
  supabase: SupabaseClient,
  d: Extract<{ kind: "apply"; rec: RecRow; targetPrice: number; vehicle: VehicleRow; rule: RuleRow | null; clamped: boolean }, { kind: "apply" }>,
  runId: string,
  experiment: { experimentId: string; arm: "control" | "test" } | null,
) {
  const tierCol = TIER_TO_COLUMN[d.rec.tier];
  if (!tierCol) throw new Error(`Unsupported tier ${d.rec.tier}`);
  const oldPrice = Number((d.vehicle as Record<string, unknown>)[tierCol] ?? d.rec.current_price);

  const { error: vehErr } = await supabase
    .from("vehicles")
    .update({ [tierCol]: d.targetPrice })
    .eq("id", d.vehicle.id);
  if (vehErr) throw new Error(`vehicle update: ${vehErr.message}`);

  await supabase.from("pricing_change_history").insert({
    tenant_id: d.rec.tenant_id,
    vehicle_id: d.vehicle.id,
    tier: d.rec.tier,
    old_price: oldPrice,
    new_price: d.targetPrice,
    change_source: "autopilot",
    recommendation_id: d.rec.id,
    changed_by: null,
    notes: d.clamped ? "Clamped to rule bounds" : null,
  });

  await supabase
    .from("pricing_recommendations")
    .update({
      status: "applied",
      applied_at: new Date().toISOString(),
      applied_by: null,
      applied_price: d.targetPrice,
      applied_source: "autopilot",
      autopilot_run_id: runId,
      experiment_id: experiment?.experimentId ?? null,
      experiment_arm: experiment?.arm ?? null,
    })
    .eq("id", d.rec.id);
}

/** Look up the last 2 outcomes per vehicle in one round-trip. */
async function loadLast2Outcomes(
  supabase: SupabaseClient,
  tenantId: string,
  vehicleIds: string[],
): Promise<Map<string, string[]>> {
  if (vehicleIds.length === 0) return new Map();
  const result = new Map<string, string[]>();
  // Pull all outcomes for these vehicles in the last 60 days; sort + take 2 in-mem
  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: rawO } = await supabase
    .from("pricing_recommendation_outcomes")
    .select("recommendation_id, outcome, measured_at, vehicle_id:recommendation_id")
    .eq("tenant_id", tenantId)
    .gte("measured_at", since)
    .order("measured_at", { ascending: false });
  const outcomes = (rawO ?? []) as unknown as Array<OutcomeRow & { vehicle_id: string }>;
  // The select alias above doesn't actually expose vehicle_id — fall back to fetching it via the recs link:
  if (outcomes.length === 0) return result;
  const recIds = outcomes.map((o) => o.recommendation_id);
  const { data: recsRaw } = await supabase
    .from("pricing_recommendations")
    .select("id, vehicle_id")
    .in("id", recIds);
  const vehById = new Map<string, string>(
    ((recsRaw ?? []) as Array<{ id: string; vehicle_id: string }>).map((r) => [r.id, r.vehicle_id]),
  );
  for (const o of outcomes) {
    const v = vehById.get(o.recommendation_id);
    if (!v || !vehicleIds.includes(v)) continue;
    const arr = result.get(v) ?? [];
    if (arr.length < 2) arr.push(o.outcome);
    result.set(v, arr);
  }
  return result;
}

/** Upsert a vehicle-scoped rule with paused_until set, so future autopilot runs skip. */
async function pauseVehicleRule(
  supabase: SupabaseClient,
  tenantId: string,
  vehicleId: string,
  vehicleCategory: string | null,
) {
  const pausedUntil = new Date(Date.now() + NEGATIVE_OUTCOME_PAUSE_DAYS * 86_400_000).toISOString();
  // Try to update an existing vehicle-scoped rule first
  const { data: existing } = await supabase
    .from("revenue_optimiser_rules")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("revenue_optimiser_rules")
      .update({ paused_until: pausedUntil })
      .eq("id", existing.id);
    return;
  }
  // Otherwise insert a new vehicle-scoped rule (autopilot_enabled=false so it
  // doesn't auto-re-arm). The category column stays NULL because we have a
  // vehicle_id; the CHECK constraint requires mutual exclusivity.
  await supabase.from("revenue_optimiser_rules").insert({
    tenant_id: tenantId,
    vehicle_id: vehicleId,
    autopilot_enabled: false,
    paused_until: pausedUntil,
  });
  // Knowing the category is useful for the surfacing UI, but doesn't belong
  // on a vehicle-scoped rule per the schema's one_scope_only constraint.
  void vehicleCategory;
}
