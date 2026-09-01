/**
 * trax-price-why — the friendly "Why?" narrative for a Trax price suggestion.
 *
 * Math already decided the number (public.trax_price_suggest RPC). This function
 * ONLY turns that structured breakdown into 2-3 sentences in Trax's voice,
 * addressed to the operator by name. It never invents numbers — it is handed the
 * facts and asked to explain them.
 *
 * Body: { breakdown, userName?, vehicleLabel? }
 *   breakdown = the exact JSON returned by trax_price_suggest (with a confident
 *               suggestion, i.e. confidence !== 'none').
 * Returns: { reasoning: string }
 */
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion } from "../_shared/openai.ts";

const money = (n: unknown) =>
  typeof n === "number" ? `$${Math.round(n)}` : `$${n}`;

const TIER_WORD: Record<string, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

const MATCH_WORD: Record<string, string> = {
  make_model_year: "near-identical vehicles (same make, model and year)",
  make_model: "the same make and model",
  make: "the same brand",
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const { breakdown, userName, vehicleLabel } = await req.json();

    if (!breakdown || typeof breakdown !== "object") {
      return errorResponse("Missing breakdown", 400);
    }
    if (breakdown.confidence === "none" || !breakdown.suggested_price) {
      return jsonResponse({
        reasoning:
          "There aren't enough comparable vehicles across the network yet to suggest a confident price for this one.",
      });
    }

    const comps = breakdown.comps ?? {};
    const util = breakdown.utilization ?? {};
    const tier = TIER_WORD[breakdown.tier] ?? breakdown.tier;
    const matched = MATCH_WORD[breakdown.tier_used] ?? "comparable vehicles";
    const name = (typeof userName === "string" && userName.trim()) || "there";
    const label =
      (typeof vehicleLabel === "string" && vehicleLabel.trim()) ||
      [breakdown.year, breakdown.make, breakdown.model].filter(Boolean).join(" ");

    // Deterministic fact sheet — the model may only paraphrase these, not add to them.
    const facts = [
      `Operator first name: ${name}`,
      `Vehicle: ${label}`,
      `Rate tier: ${tier}`,
      `Current ${tier} price: ${money(breakdown.current_price)}`,
      `Suggested ${tier} price: ${money(breakdown.suggested_price)} (${breakdown.direction}, ${breakdown.delta_pct}% vs current)`,
      `Confidence: ${breakdown.confidence}`,
      `Comparable set: ${comps.count} ${matched} across the Drive247 network`,
      `Network ${tier} range: ${money(comps.p25)}–${money(comps.p75)}, median ${money(comps.median)}`,
      `This vehicle's utilisation (last 90 days): ${util.booked_days_90d} booked days (${Math.round((util.ratio ?? 0) * 100)}%), level "${util.level}"`,
    ].join("\n");

    const system =
      "You are Trax, Drive247's pricing assistant. You explain a price suggestion to a fleet operator in a warm, concise, confident voice. " +
      "Rules: address the operator by their first name once; keep it to 2-3 short sentences; use ONLY the numbers in the fact sheet (never invent figures); " +
      "explain WHY the suggested price makes sense by referencing the network comparables and the vehicle's utilisation; " +
      "if confidence is 'low', gently acknowledge the comparable set is small; do not use markdown, bullet points, or headings — plain sentences only.";

    const res = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: `Fact sheet:\n${facts}\n\nWrite the explanation now.` },
      ],
      { temperature: 0.5, max_tokens: 220 },
      { functionName: "trax-price-why" },
    );

    const reasoning =
      res.choices?.[0]?.message?.content?.trim() ||
      `${name}, based on ${comps.count} ${matched} across the network (median ${money(comps.median)} ${tier}), ${money(breakdown.suggested_price)} looks like the right ${tier} price for your ${label}.`;

    return jsonResponse({ reasoning });
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : "Failed to generate explanation",
      500,
    );
  }
});
