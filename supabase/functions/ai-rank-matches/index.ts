/**
 * ai-rank-matches — Spec Section 6.5 + 11.2.
 *
 * Inputs:  { leadId, matchOptions: MatchOption[] }
 * Outputs: per-option { optionIndex, aiScore (0–100), acceptanceProbability (0–1), reasoning }
 *
 * Uses OpenAI gpt-4o-mini via shared helper. Caches by leadId + hash(matchOptions)
 * for 5 minutes. Falls back to deterministic order (aiScore = matchScore) on
 * failure / no API key.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion } from "../_shared/openai.ts";

interface MatchOption {
  kind: string;
  vehicles: Array<{ vehicleId: string; name: string; class: string; weeklyRate: number; available: string }>;
  matchScore: number;
  totalPrice: number;
  budgetFit: string;
  reasoning?: string[];
}

interface Payload {
  leadId?: string;
  matchOptions?: MatchOption[];
}

async function hashString(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.leadId) return errorResponse("leadId is required");
    if (!body.matchOptions?.length) return jsonResponse({ rankings: [] });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: lead } = await supabase
      .from("leads")
      .select("id, tenant_id, full_name, application_data, score_band, lead_score, vehicle_class, start_date, end_date")
      .eq("id", body.leadId)
      .maybeSingle();
    if (!lead) return errorResponse("Lead not found", 404);

    const payloadHash = await hashString(`${body.leadId}|${JSON.stringify(body.matchOptions)}`);
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

    // Cache lookup
    const { data: cached } = await supabase
      .from("ai_call_logs")
      .select("response_summary")
      .eq("payload_hash", payloadHash)
      .eq("function_name", "ai-rank-matches")
      .gte("created_at", fiveMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached && (cached as { response_summary?: { rankings?: unknown[] } }).response_summary) {
      return jsonResponse({ ...(cached as { response_summary: Record<string, unknown> }).response_summary, source: "cache" });
    }

    // Tenant quota
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("ai_monthly_quota")
      .eq("id", String(lead.tenant_id))
      .maybeSingle();
    const quota = (tenantRow as { ai_monthly_quota?: number } | null)?.ai_monthly_quota ?? 1000;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count: used } = await supabase
      .from("ai_call_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", String(lead.tenant_id))
      .gte("created_at", startOfMonth);
    const overQuota = (used ?? 0) >= quota;

    const apiKey = Deno.env.get("OPENAI_API_KEY");

    // Deterministic fallback
    const fallback = body.matchOptions.map((opt, idx) => ({
      optionIndex: idx,
      aiScore: opt.matchScore,
      acceptanceProbability: Math.min(1, Math.max(0.1, opt.matchScore / 100)),
      reasoning: "Heuristic ranking — AI unavailable.",
    }));

    if (overQuota || !apiKey) {
      await supabase.from("ai_call_logs").insert({
        tenant_id: lead.tenant_id,
        function_name: "ai-rank-matches",
        lead_id: lead.id,
        model: null,
        latency_ms: 0,
        cache_hit: false,
        status: "ok",
        payload_hash: payloadHash,
        response_summary: { rankings: fallback, source: "fallback" },
      });
      return jsonResponse({ rankings: fallback, source: "fallback" });
    }

    const appData = (lead.application_data ?? {}) as Record<string, unknown>;
    const profile = [
      `Lead: ${lead.full_name}`,
      `Score: ${lead.lead_score ?? "—"} (${lead.score_band ?? "—"})`,
      `Purpose: ${String(appData.purpose ?? "—")}`,
      `Weekly budget: ${appData.weeklyBudget ?? "—"}`,
      `Requested class: ${lead.vehicle_class ?? "any"}`,
      `Dates: ${lead.start_date ?? "—"} → ${lead.end_date ?? "—"}`,
    ].join("\n");
    const optionsText = body.matchOptions
      .map((opt, idx) => {
        const v = opt.vehicles[0];
        return `${idx}: ${v?.name ?? "?"} (${opt.kind}, score ${opt.matchScore}, $${opt.totalPrice}, avail=${v?.available}, budgetFit=${opt.budgetFit})`;
      })
      .join("\n");

    const startTs = Date.now();
    let rankings = fallback;
    const model = "gpt-4o-mini";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      const completion = await chatCompletion(
        [
          {
            role: "system",
            content:
              "You rank vehicle options for a rental lead. Reply ONLY with a JSON object " +
              '{ "rankings": [{ "optionIndex": int, "aiScore": int 0-100, "acceptanceProbability": float 0-1, "reasoning": "one short sentence" }] }. ' +
              "Higher aiScore = more likely the lead will accept. Consider price fit, vehicle closeness, availability.",
          },
          { role: "user", content: `${profile}\n\nOptions:\n${optionsText}` },
        ],
        { model, max_tokens: 1024, temperature: 0.3 },
        { tenantId: String(lead.tenant_id), functionName: "ai-rank-matches" },
      );
      const txt = completion.choices?.[0]?.message?.content ?? "";
      const start = txt.indexOf("{");
      const end = txt.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(txt.slice(start, end + 1));
        if (Array.isArray(parsed.rankings)) {
          rankings = parsed.rankings.map((r: { optionIndex: number; aiScore: number; acceptanceProbability: number; reasoning?: string }) => ({
            optionIndex: Number(r.optionIndex ?? 0),
            aiScore: Math.max(0, Math.min(100, Number(r.aiScore ?? 0))),
            acceptanceProbability: Math.max(0, Math.min(1, Number(r.acceptanceProbability ?? 0))),
            reasoning: r.reasoning ?? "",
          }));
        }
      }
      inputTokens = completion.usage?.prompt_tokens;
      outputTokens = completion.usage?.completion_tokens;
    } catch (err) {
      console.error("ai-rank-matches OpenAI error:", err);
    }

    await supabase.from("ai_call_logs").insert({
      tenant_id: lead.tenant_id,
      function_name: "ai-rank-matches",
      lead_id: lead.id,
      model,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      latency_ms: Date.now() - startTs,
      cache_hit: false,
      status: "ok",
      payload_hash: payloadHash,
      response_summary: { rankings, source: "ai" },
    });

    return jsonResponse({ rankings, source: "ai" });
  } catch (err) {
    console.error("ai-rank-matches error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
