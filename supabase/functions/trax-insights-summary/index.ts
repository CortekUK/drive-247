// trax-insights-summary
//
// Trax's written review of an operator's money, for the v2 Insights page
// ("Trax summary" tab, northwind-gated in the portal).
//
// The portal sends the FACTS it already shows on the page — the receipt, the
// months, the cars, the mix, who owes what — built from the same read the
// operator is looking at, so the prose can never disagree with the numbers
// beside it (their own category rules and corrections included). This
// function decides only the WORDS: headings, findings, and actions.
//
// Tenant: always the caller's own (`app_users.tenant_id`). A super admin, who
// has no tenant of their own, may name one. The facts carry no ids.
//
// The model picks which of five fixed charts sits beside each section; the
// portal draws them from real data. A model is never asked to draw a number.
//
// New function (V2_PLAN §7): nothing else calls it. JWT verified by default.
// Self-contained (no ../_shared) so it deploys cleanly on its own.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-slug",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const VISUALS = ["money_in_out", "running_profit", "profit_by_car", "revenue_mix", "owed_by_age"] as const;
const TONES = ["strong", "steady", "watch", "concern"] as const;
const IMPACTS = ["high", "medium", "low"] as const;
const WHENS = ["today", "this week", "this month"] as const;

const MODEL = Deno.env.get("TRAX_INSIGHTS_MODEL") ?? "gpt-4.1";

const SYSTEM = `You are Trax, the AI built into Drive247, the platform car-rental operators run their business on. The operator has asked you for a full business review — the kind a sharp business analyst would hand a client after spending a day inside their books. Go through EVERYTHING in the facts: money, pricing, every car, bookings and demand, customers, cash and collections, costs, risk. Be specific, thorough and useful. You speak to the operator directly, in the first person ("I went through…", "your Corolla…"), warm, plain, confident. Never use emojis. Never use markdown symbols (no #, *, **, backticks) — the page does the formatting.

You are given FACTS as JSON. Rules for numbers:
- Use only figures in the facts, or simple arithmetic on them (sums, differences, shares, averages, per-car or per-day figures). State results, not working.
- Money in the operator's currency with thousands separators, whole units ($23,848). Percentages as whole numbers unless small.
- Name the cars, customers, months, weekdays and booking sources the facts name. Prefer one precise sentence to three vague ones.
- If something is unknown, missing or zero, say so plainly and say what recording it would unlock. You may name a likely cause as a possibility ("this may be…"), never as a fact.
- Definitions: "took in" = everything charged; "never yours" = sales tax + refundable deposits; "spent" = running costs; "kept" = took in − gave back − never yours − spent; car purchases are capital, outside kept; "still owed" is as of today. Utilisation = rented car-days ÷ available car-days. Attach rate = share of rentals that carried that charge.

Think like an analyst who knows car rental economics: revenue per available car-day, revenue per rented day, utilisation targets (healthy operators run 60–80%), idle-car carrying cost, fleet right-sizing, weekday vs weekend demand, rental length mix, extension and add-on attach, repeat-customer value, customer concentration risk, collection speed and bad-debt risk, deposits and tax as liabilities, seasonality and momentum.

Return STRICT JSON only, exactly this shape:
{
  "headline": string,              // one-sentence verdict, max 18 words
  "tone": "strong" | "steady" | "watch" | "concern",
  "summary": string,               // the executive summary: 3–5 sentences, the state of the business and the 2–3 things that matter most
  "sections": [                    // 8 to 10 sections, in THIS order, skipping only an area the facts say nothing about:
                                   // "Overall health", "Revenue and momentum", "Pricing", "Fleet performance", "Utilisation and idle time",
                                   // "Bookings and demand", "Customers and loyalty", "Cash and collections", "Costs", "Risk"
    {
      "heading": string,            // a specific finding as the heading, e.g. "Three cars carry 80% of what you keep"
      "area": string,               // which of the ten areas above
      "rating": "strong" | "fair" | "weak",
      "metric": { "label": string, "value": string } | null,   // the one number that sums the area up, e.g. {"label":"Utilisation","value":"10%"}
      "visual": "money_in_out" | "running_profit" | "profit_by_car" | "revenue_mix" | "owed_by_age" | null,
      "paragraphs": string[],       // 2–3 paragraphs of 3–5 sentences: what the numbers say, why it matters, what good looks like
      "bullets": string[]           // 4–7 concrete findings, each one sentence with a number and a name where possible
    }
  ],
  "swot": {
    "strengths": string[],          // 3–4 each, one sentence, specific
    "weaknesses": string[],
    "opportunities": string[],
    "threats": string[]
  },
  "plan": {                         // a 30/60/90-day plan
    "days30": string[],             // 3–4 steps each, imperative, specific
    "days60": string[],
    "days90": string[]
  },
  "actions": [                     // 5 to 8 things to do NOW, most valuable first
    { "title": string, "detail": string, "impact": "high" | "medium" | "low", "when": "today" | "this week" | "this month", "estimate": string | null }
  ],
  "watch": string[],               // 3–5 things to watch next period
  "customer_pick": { "customer": string, "why": string } | null   // from facts.topCustomers ONLY, exact name; one warm sentence with a number
}

Use each visual at most once, on the sections where a chart genuinely helps (at least three).`;

function str(v: unknown, max = 600): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}
function strs(v: unknown, n: number, max = 400): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];
}
function pick<T extends readonly string[]>(v: unknown, list: T, fallback: T[number] | null): T[number] | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

/** Keep only the shape the portal renders; drop anything else the model adds. */
function clean(parsed: any) {
  const used = new Set<string>();
  return {
    headline: str(parsed?.headline, 200),
    tone: pick(parsed?.tone, TONES, "steady"),
    summary: str(parsed?.summary, 1600),
    sections: (Array.isArray(parsed?.sections) ? parsed.sections : []).slice(0, 10).map((s: any) => {
      let visual = pick(s?.visual, VISUALS, null);
      if (visual && used.has(visual)) visual = null;
      if (visual) used.add(visual);
      return {
        heading: str(s?.heading, 140),
        area: str(s?.area, 60),
        rating: pick(s?.rating, ['strong', 'fair', 'weak'] as const, 'fair'),
        metric:
          s?.metric && typeof s.metric === 'object' && str(s.metric.value, 40)
            ? { label: str(s.metric.label, 40), value: str(s.metric.value, 40) }
            : null,
        visual,
        paragraphs: strs(s?.paragraphs, 3, 1200),
        bullets: strs(s?.bullets, 7, 320),
      };
    }).filter((s: any) => s.heading),
    swot: {
      strengths: strs(parsed?.swot?.strengths, 4, 260),
      weaknesses: strs(parsed?.swot?.weaknesses, 4, 260),
      opportunities: strs(parsed?.swot?.opportunities, 4, 260),
      threats: strs(parsed?.swot?.threats, 4, 260),
    },
    plan: {
      days30: strs(parsed?.plan?.days30, 4, 220),
      days60: strs(parsed?.plan?.days60, 4, 220),
      days90: strs(parsed?.plan?.days90, 4, 220),
    },
    actions: (Array.isArray(parsed?.actions) ? parsed.actions : []).slice(0, 8).map((a: any) => ({
      title: str(a?.title, 140),
      detail: str(a?.detail, 500),
      impact: pick(a?.impact, IMPACTS, "medium"),
      when: pick(a?.when, WHENS, "this week"),
      estimate: str(a?.estimate, 60) || null,
    })).filter((a: any) => a.title),
    watch: strs(parsed?.watch, 5, 240),
    customer_pick:
      parsed?.customer_pick && typeof parsed.customer_pick === 'object' && str(parsed.customer_pick.customer, 120)
        ? { customer: str(parsed.customer_pick.customer, 120), why: str(parsed.customer_pick.why, 300) }
        : null,
  };
}

async function logUsage(row: Record<string, unknown>) {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/openai_usage_logs`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch (_) {
    // usage logging never fails the request
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing authorization header" }, 401);

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: appUser } = await admin
      .from("app_users")
      .select("id, tenant_id, is_super_admin, is_active")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!appUser || (!appUser.is_super_admin && !appUser.is_active)) return json({ error: "Not allowed" }, 403);

    const body = await req.json().catch(() => ({}));
    // Super admins have tenant_id NULL; they may name a tenant. Nobody else may.
    const tenantId: string | null = appUser.is_super_admin
      ? (typeof body?.tenantId === "string" ? body.tenantId : appUser.tenant_id)
      : appUser.tenant_id;
    if (!tenantId) return json({ error: "No tenant context" }, 400);

    /* ── One review a week, per business ───────────────────────────────────
     * The latest saved review is both what the portal shows and the clock
     * for the limit. Super admins may regenerate any time, for support. */
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const { data: latestRow } = await admin
      .from("trax_insights_reports")
      .select("id, months, period_from, period_to, summary, facts_key, model, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const latest = latestRow
      ? {
          summary: latestRow.summary,
          generatedAt: latestRow.created_at,
          factsKey: latestRow.facts_key,
          months: latestRow.months,
          periodFrom: latestRow.period_from,
          periodTo: latestRow.period_to,
        }
      : null;
    const nextAvailableAt = latestRow && !appUser.is_super_admin
      ? new Date(new Date(latestRow.created_at).getTime() + WEEK_MS).toISOString()
      : null;
    const locked = !!nextAvailableAt && new Date(nextAvailableAt).getTime() > Date.now();

    if (body?.action === "latest") {
      return json({ latest, nextAvailableAt: locked ? nextAvailableAt : null });
    }
    if (locked) {
      return json(
        {
          error: "You've had this week's review. I'll write your next one on " +
            new Date(nextAvailableAt!).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + ".",
          latest,
          nextAvailableAt,
        },
        429,
      );
    }

    const facts = body?.facts;
    if (!facts || typeof facts !== "object") return json({ error: "Missing facts" }, 400);
    const factsText = JSON.stringify(facts);
    if (factsText.length > 120_000) return json({ error: "Facts too large" }, 413);

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) return json({ error: "AI is not configured" }, 500);

    const started = Date.now();
    const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.35,
        max_tokens: 9000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `FACTS:\n${factsText}` },
        ],
      }),
    });

    if (!ai.ok) {
      const errText = await ai.text();
      await logUsage({
        tenant_id: tenantId,
        function_name: "trax-insights-summary",
        endpoint: "chat/completions",
        model: MODEL,
        status: "error",
        duration_ms: Date.now() - started,
        error_message: `${ai.status}: ${errText.slice(0, 500)}`,
      });
      return json({ error: "I couldn't reach my writing model just now. Please try again in a minute." }, 502);
    }

    const out = await ai.json();
    const usage = out.usage || {};
    await logUsage({
      tenant_id: tenantId,
      function_name: "trax-insights-summary",
      endpoint: "chat/completions",
      model: MODEL,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      // gpt-4.1: $2 / 1M in, $8 / 1M out.
      cost_usd: ((usage.prompt_tokens || 0) * 2 + (usage.completion_tokens || 0) * 8) / 1_000_000,
      status: "success",
      duration_ms: Date.now() - started,
    });

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(out.choices?.[0]?.message?.content ?? "{}");
    } catch (_) {
      return json({ error: "I wrote something I couldn't read back. Please try again." }, 502);
    }

    const summary = clean(parsed);
    if (!summary.headline || summary.sections.length === 0) {
      return json({ error: "I came back with too little to show. Please try again." }, 502);
    }

    const months = [3, 6, 12].includes(Number(body?.months)) ? Number(body.months) : 12;
    const period = (facts as any)?.period ?? {};
    const { data: saved, error: saveError } = await admin
      .from("trax_insights_reports")
      .insert({
        tenant_id: tenantId,
        months,
        period_from: typeof period.from === "string" ? period.from : new Date().toISOString().slice(0, 10),
        period_to: typeof period.to === "string" ? period.to : new Date().toISOString().slice(0, 10),
        summary,
        facts_key: typeof body?.factsKey === "string" ? body.factsKey.slice(0, 64) : null,
        model: MODEL,
        created_by: appUser.is_super_admin ? null : appUser.id,
      })
      .select("created_at")
      .single();
    if (saveError) console.error("trax-insights-summary save", saveError);

    const generatedAt = saved?.created_at ?? new Date().toISOString();
    return json({
      summary,
      generatedAt,
      model: MODEL,
      months,
      nextAvailableAt: appUser.is_super_admin ? null : new Date(new Date(generatedAt).getTime() + WEEK_MS).toISOString(),
    });
  } catch (error) {
    console.error("trax-insights-summary", error);
    return json({ error: (error as Error).message || "Internal error" }, 500);
  }
});
