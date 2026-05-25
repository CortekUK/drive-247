/**
 * Phase 4 — match leads against an idle vehicle for "combined" recommendations.
 *
 * Eligibility:
 *   - Same tenant_id
 *   - Lead stage in (new, contacted, vehicle_offered) — i.e. not converted
 *     and not negotiating-with-someone-else
 *   - Either lead.vehicle_id matches OR lead.vehicle_class matches the
 *     vehicle's category (case-insensitive trim)
 *   - lead.created_at within the last 21 days (still actionable)
 *   - lead.start_date is null OR start_date in [today, today + 21 days]
 *
 * Ranking:
 *   higher = better. Tie-breakers don't matter for V1; we cap at 10.
 *     +30 for an exact vehicle_id match (vs class match)
 *     +20 for being in 'vehicle_offered' stage
 *     +10 for being in 'contacted' stage
 *     +5  for having a phone number (SMS-deliverable)
 *     +5  for having an email (email-deliverable)
 *     +days_recency_bonus (newer leads ranked higher)
 *
 * Caller is expected to pass a service_role-scoped Supabase client so we can
 * read across tenant boundaries when needed (generate cron runs as service).
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

export const ELIGIBLE_LEAD_STAGES = ["new", "contacted", "vehicle_offered"] as const;
export const LEAD_LOOKBACK_DAYS = 21;
export const FUTURE_DATE_WINDOW_DAYS = 21;
export const MATCH_LIMIT = 10;

export interface MatchedLead {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  vehicle_id: string | null;
  vehicle_class: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  score: number;
}

/**
 * Find up to MATCH_LIMIT leads for one vehicle. Returns sorted by descending score.
 */
export async function findMatchingLeads(
  supabase: SupabaseClient,
  args: { tenantId: string; vehicleId: string; vehicleCategory: string | null },
): Promise<MatchedLead[]> {
  const sinceIso = new Date(Date.now() - LEAD_LOOKBACK_DAYS * 86_400_000).toISOString();
  const todayIso = new Date(); todayIso.setUTCHours(0, 0, 0, 0);
  const startDateMin = todayIso.toISOString().slice(0, 10);
  const startDateMax = new Date(todayIso.getTime() + FUTURE_DATE_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);
  const categoryNorm = (args.vehicleCategory ?? "").trim().toLowerCase();

  // We do two queries (vehicle_id match + vehicle_class match) and merge
  // server-side. PostgREST `or()` would let us do it in one query, but the
  // ranking signal "exact vehicle vs class match" is cleaner this way.
  const baseSelect = "id, full_name, email, phone, stage, vehicle_id, vehicle_class, start_date, end_date, created_at";
  const byVehicleP = supabase
    .from("leads")
    .select(baseSelect)
    .eq("tenant_id", args.tenantId)
    .eq("vehicle_id", args.vehicleId)
    .in("stage", ELIGIBLE_LEAD_STAGES as unknown as string[])
    .gte("created_at", sinceIso);
  const byVehicleClassP = categoryNorm
    ? supabase
        .from("leads")
        .select(baseSelect)
        .eq("tenant_id", args.tenantId)
        .ilike("vehicle_class", categoryNorm)
        .in("stage", ELIGIBLE_LEAD_STAGES as unknown as string[])
        .gte("created_at", sinceIso)
    : Promise.resolve({ data: [], error: null });

  const [byVehicle, byVehicleClass] = await Promise.all([byVehicleP, byVehicleClassP]);

  const dedupe = new Map<string, { row: Record<string, unknown>; isExactVehicle: boolean }>();
  for (const r of ((byVehicle as { data: unknown[] | null }).data ?? []) as Array<Record<string, unknown>>) {
    dedupe.set(r.id as string, { row: r, isExactVehicle: true });
  }
  for (const r of ((byVehicleClass as { data: unknown[] | null }).data ?? []) as Array<Record<string, unknown>>) {
    if (!dedupe.has(r.id as string)) {
      dedupe.set(r.id as string, { row: r, isExactVehicle: false });
    }
  }

  const ranked: MatchedLead[] = [];
  for (const { row, isExactVehicle } of dedupe.values()) {
    const startDate = (row.start_date as string | null) ?? null;
    // Filter: if start_date is set, it must overlap our window. start_date=null
    // means "flexible" and is always eligible.
    if (startDate && (startDate < startDateMin || startDate > startDateMax)) continue;

    const stage = (row.stage as string) ?? "";
    let score = 0;
    if (isExactVehicle) score += 30;
    if (stage === "vehicle_offered") score += 20;
    else if (stage === "contacted") score += 10;
    if (row.phone) score += 5;
    if (row.email) score += 5;

    // Recency bonus: 1 point per day fresher (capped at 21d).
    const createdAt = new Date(row.created_at as string).getTime();
    const daysOld = Math.floor((Date.now() - createdAt) / 86_400_000);
    score += Math.max(0, LEAD_LOOKBACK_DAYS - daysOld);

    ranked.push({
      id: row.id as string,
      full_name: (row.full_name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      stage,
      vehicle_id: (row.vehicle_id as string | null) ?? null,
      vehicle_class: (row.vehicle_class as string | null) ?? null,
      start_date: startDate,
      end_date: (row.end_date as string | null) ?? null,
      created_at: row.created_at as string,
      score,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, MATCH_LIMIT);
}

/**
 * Best-effort channel resolution for a single lead. SMS preferred if phone
 * present, else email. Returns null if neither is present.
 */
export function pickChannel(lead: { phone: string | null; email: string | null }): "sms" | "email" | null {
  if (lead.phone && lead.phone.trim().length > 0) return "sms";
  if (lead.email && lead.email.trim().length > 0) return "email";
  return null;
}
