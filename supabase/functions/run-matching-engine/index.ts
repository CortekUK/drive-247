/**
 * run-matching-engine — Spec Section 6.5 + 11.2.
 *
 * Wraps the shared matching helper. JWT-protected. Inputs:
 *   { leadId } — derives MatchInput from the lead row, OR
 *   { ...MatchInput } — direct override (used by the offer-link builder)
 *
 * Phase 3 will plug `ai-rank-matches` inline if tenant has AI enabled.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { runMatchingEngine, type MatchInput } from "../_shared/matching.ts";

interface Payload {
  leadId?: string;
  // OR override:
  tenantId?: string;
  vehicleInterest?: MatchInput["vehicleInterest"];
  startDate?: string;
  endDate?: string;
  rentalType?: MatchInput["rentalType"];
  purpose?: string;
  weeklyBudget?: number;
  depositComfortAmount?: number;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let input: MatchInput | null = null;

    if (body.leadId) {
      const { data: lead, error } = await supabase
        .from("leads")
        .select("id, tenant_id, vehicle_id, vehicle_class, start_date, end_date, rental_type, application_data, source_metadata")
        .eq("id", body.leadId)
        .maybeSingle();
      if (error || !lead) return errorResponse("Lead not found", 404);

      const appData = (lead.application_data ?? {}) as Record<string, unknown>;
      const sourceMeta = (lead.source_metadata ?? {}) as Record<string, unknown>;

      const vehicleInterest: MatchInput["vehicleInterest"] = lead.vehicle_id
        ? { type: "specific", vehicleId: lead.vehicle_id }
        : lead.vehicle_class
          ? { type: "class", class: lead.vehicle_class }
          : { type: "any" };

      input = {
        leadId: lead.id,
        tenantId: lead.tenant_id,
        vehicleInterest,
        startDate: lead.start_date ?? new Date().toISOString().slice(0, 10),
        endDate: lead.end_date ?? new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
        rentalType: (lead.rental_type as MatchInput["rentalType"]) ?? "weekly",
        purpose: String(sourceMeta.purpose ?? appData.purpose ?? ""),
        weeklyBudget: Number(appData.weeklyBudget) || undefined,
        depositComfortAmount: Number(appData.depositComfortAmount) || undefined,
      };
    } else {
      if (!body.tenantId || !body.vehicleInterest || !body.startDate || !body.endDate || !body.rentalType) {
        return errorResponse("Missing required override fields");
      }
      input = {
        leadId: "",
        tenantId: body.tenantId,
        vehicleInterest: body.vehicleInterest,
        startDate: body.startDate,
        endDate: body.endDate,
        rentalType: body.rentalType,
        purpose: body.purpose,
        weeklyBudget: body.weeklyBudget,
        depositComfortAmount: body.depositComfortAmount,
      };
    }

    const result = await runMatchingEngine(supabase as unknown as { from: (t: string) => never }, input);

    // AI rerank pass — best-effort; falls back silently to deterministic order.
    if (result.options.length > 0 && input.leadId) {
      try {
        const { data } = await supabase.functions.invoke<{ rankings: Array<{ optionIndex: number; aiScore: number; acceptanceProbability: number; reasoning?: string }> }>(
          "ai-rank-matches",
          { body: { leadId: input.leadId, matchOptions: result.options } },
        );
        if (data?.rankings) {
          // Merge aiScore + acceptanceProbability + final 60/40 blended score
          for (const r of data.rankings) {
            const opt = result.options[r.optionIndex];
            if (!opt) continue;
            // Augment without breaking the typed shape — added fields per spec §11.2.
            (opt as unknown as { aiScore?: number; acceptanceProbability?: number }).aiScore = r.aiScore;
            (opt as unknown as { aiScore?: number; acceptanceProbability?: number }).acceptanceProbability = r.acceptanceProbability;
            opt.matchScore = Math.round(opt.matchScore * 0.6 + r.aiScore * 0.4);
            if (r.reasoning) opt.reasoning = [...(opt.reasoning ?? []), `AI: ${r.reasoning}`];
          }
          result.options.sort((a, b) => b.matchScore - a.matchScore);
        }
      } catch (err) {
        console.error("ai-rank-matches (non-fatal):", err);
      }
    }

    return jsonResponse(result);
  } catch (err) {
    console.error("run-matching-engine error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
