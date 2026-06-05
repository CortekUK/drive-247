// generate-expense-summary
// Produces a short, cached AI summary of a tenant's expenses for one tab/scope
// (overall | business | vehicle) and upserts it into expense_ai_summaries.
// Self-contained (no ../_shared imports) so it deploys cleanly via MCP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type Scope = "overall" | "business" | "vehicle";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-tenant-slug",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Best-effort usage log (mirrors _shared/openai.ts), never throws.
async function logUsage(row: Record<string, unknown>): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/openai_usage_logs`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch (_) {
    // ignore
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const scope: Scope = (["overall", "business", "vehicle"].includes(body?.scope)
      ? body.scope
      : "overall") as Scope;

    // Resolve tenant from the authenticated user (don't trust the client),
    // except super admins who may target a specific tenant via the body.
    const { data: appUser } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("No app user found", 403);
    const tenantId: string | null = appUser.is_super_admin
      ? (body?.tenantId ?? appUser.tenant_id)
      : appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 400);

    let q = supabase
      .from("vehicle_expenses")
      .select("amount, category, expense_at, expense_date, vehicle_id, vehicle:vehicles(reg, make, model)")
      .eq("tenant_id", tenantId);
    if (scope === "business") q = q.is("vehicle_id", null);
    if (scope === "vehicle") q = q.not("vehicle_id", "is", null);

    const { data: rows, error } = await q;
    if (error) {
      console.error("Error fetching expenses:", error);
      return errorResponse("Failed to fetch expenses", 500);
    }

    const items = (rows || []) as any[];
    const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
    const count = items.length;

    if (count === 0) {
      await supabase.from("expense_ai_summaries").upsert(
        {
          tenant_id: tenantId,
          scope,
          summary: "",
          source_count: 0,
          source_total: 0,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,scope" }
      );
      return jsonResponse({ summary: "", source_count: 0, source_total: 0 });
    }

    // Distribution — by vehicle for the vehicle tab, otherwise by category.
    const byKey = new Map<string, number>();
    for (const e of items) {
      const key =
        scope === "vehicle"
          ? (e.vehicle
              ? `${e.vehicle.reg ?? "Vehicle"} (${e.vehicle.make ?? ""} ${e.vehicle.model ?? ""})`.trim()
              : "Unknown vehicle")
          : (e.category || "Uncategorised");
      byKey.set(key, (byKey.get(key) || 0) + Number(e.amount || 0));
    }
    const topBreakdown = [...byKey.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${money(v)}`)
      .join("; ");

    // Month-over-month trend (last two months present).
    const byMonth = new Map<string, number>();
    for (const e of items) {
      const d = new Date(e.expense_at || e.expense_date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      byMonth.set(key, (byMonth.get(key) || 0) + Number(e.amount || 0));
    }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let trendLine = "";
    if (months.length >= 2) {
      const prev = months[months.length - 2][1];
      const last = months[months.length - 1][1];
      const pct = prev > 0 ? Math.round(((last - prev) / prev) * 100) : null;
      trendLine = pct === null
        ? `Latest month total: ${money(last)}.`
        : `Latest month ${money(last)} vs previous ${money(prev)} (${pct >= 0 ? "+" : ""}${pct}%).`;
    }

    const scopeLabel =
      scope === "overall" ? "all expenses (vehicle + business)" :
      scope === "business" ? "business / overhead expenses" : "vehicle-related expenses";

    const systemPrompt =
      "You are a finance assistant for a car-rental operator. Write a concise, factual 2-3 sentence summary of the operator's expenses for internal staff. Highlight the biggest spend areas and any month-over-month trend. Plain English, no bullet points, no preamble, do not invent numbers.";
    const userPrompt =
      `Scope: ${scopeLabel}.\n` +
      `Total spend: ${money(total)} across ${count} expense(s).\n` +
      `Top breakdown — ${topBreakdown}.\n` +
      (trendLine ? `Trend — ${trendLine}\n` : "") +
      `Write the summary.`;

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return errorResponse("OPENAI_API_KEY not set", 500);

    const model = "gpt-4o-mini";
    const startedAt = Date.now();
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      await logUsage({
        tenant_id: tenantId,
        function_name: "generate-expense-summary",
        endpoint: "chat/completions",
        model,
        status: "error",
        duration_ms: Date.now() - startedAt,
        error_message: `${aiRes.status}: ${errText.slice(0, 500)}`,
        metadata: { scope },
      });
      return errorResponse("AI request failed", 502);
    }

    const aiData = await aiRes.json();
    const usage = aiData.usage || {};
    // USD per 1M tokens for gpt-4o-mini.
    const cost =
      ((usage.prompt_tokens || 0) * 0.15 + (usage.completion_tokens || 0) * 0.6) / 1_000_000;
    await logUsage({
      tenant_id: tenantId,
      function_name: "generate-expense-summary",
      endpoint: "chat/completions",
      model,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      cost_usd: cost,
      status: "success",
      duration_ms: Date.now() - startedAt,
      metadata: { scope },
    });

    const summaryText =
      aiData.choices?.[0]?.message?.content?.trim() || "Unable to generate summary.";

    const { error: upsertError } = await supabase.from("expense_ai_summaries").upsert(
      {
        tenant_id: tenantId,
        scope,
        summary: summaryText,
        source_count: count,
        source_total: total,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,scope" }
    );
    if (upsertError) {
      console.error("Error upserting summary:", upsertError);
      return errorResponse("Failed to save summary", 500);
    }

    return jsonResponse({
      summary: summaryText,
      source_count: count,
      source_total: total,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error generating expense summary:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
});
