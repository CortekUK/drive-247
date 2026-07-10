import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion, type ToolDefinition } from "../_shared/openai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Generates an AI verdict for a Bonzah onboarding submission. Feeds the raw
// submission answers + uploaded-file inventory to gpt-4o with a forced tool call
// so the output is always structured. Writes ai_* columns and appends an
// 'ai_analyzed' event to the submission timeline. Designed to run fire-and-forget
// right after the submission is inserted.
//
// Input: { submissionId }

const VERDICT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "record_bonzah_verdict",
    description:
      "Record a structured underwriting-style verdict for a car rental operator's Bonzah insurance onboarding application.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description:
            "A concise 2-4 sentence internal summary of this operator's application for a Bonzah partner reviewer. Factual, professional.",
        },
        recommendation: {
          type: "string",
          enum: ["approve", "disapprove", "uncertain"],
          description:
            "Overall recommendation. 'approve' if the operator looks legitimate and low-risk; 'disapprove' if there are serious red flags; 'uncertain' if key information is missing or mixed.",
        },
        confidence: {
          type: "number",
          description: "Confidence in the recommendation, 0 to 1.",
        },
        reasons: {
          type: "array",
          items: { type: "string" },
          description: "Short bullet reasons supporting the recommendation.",
        },
        red_flags: {
          type: "array",
          items: { type: "string" },
          description:
            "Specific concerns or missing items a reviewer should check. Empty array if none.",
        },
      },
      required: ["summary", "recommendation", "confidence", "reasons", "red_flags"],
    },
  },
};

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const { submissionId } = await req.json().catch(() => ({}));
    if (!submissionId) return errorResponse("submissionId is required", 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: submission, error: subError } = await supabase
      .from("bonzah_onboarding_submissions")
      .select("*")
      .eq("id", submissionId)
      .single();

    if (subError || !submission) {
      console.error("[summarize-bonzah-submission] load error:", subError);
      return errorResponse("Submission not found", 404);
    }

    // Build a compact inventory of uploaded files.
    const fileUrls = (submission.file_urls ?? {}) as Record<string, Array<{ name?: string }>>;
    const fileInventory = Object.entries(fileUrls)
      .map(([field, files]) => {
        const names = Array.isArray(files) ? files.map((f) => f?.name).filter(Boolean) : [];
        return names.length ? `${field}: ${names.join(", ")}` : `${field}: (none)`;
      })
      .join("\n");

    const answersJson = JSON.stringify(submission.data ?? {}, null, 2);

    const systemPrompt =
      "You are an assistant to a Bonzah insurance partner who reviews car rental operators applying to offer Bonzah coverage. " +
      "Assess the application for legitimacy and risk. Consider ownership clarity, licensing, insurance history, underwriting answers, " +
      "renter screening rigor, and completeness of uploaded documents. Be balanced and never fabricate facts not in the application. " +
      "Always respond by calling the record_bonzah_verdict tool.";

    const userPrompt =
      `Bonzah onboarding application for "${submission.business_trade_name ?? "Unknown"}" ` +
      `(legal name: ${submission.business_legal_name ?? "n/a"}, EIN: ${submission.ein ?? "n/a"}).\n\n` +
      `Quiz: ${submission.quiz_passed ? "PASSED" : "not passed"} ` +
      `(${submission.quiz_score ?? "?"}/${submission.quiz_total ?? "?"}).\n\n` +
      `Uploaded files:\n${fileInventory || "(none)"}\n\n` +
      `Full answers (JSON):\n${answersJson}`;

    const ai = await chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      {
        temperature: 0.2,
        max_tokens: 700,
        tools: [VERDICT_TOOL],
        tool_choice: { type: "function", function: { name: "record_bonzah_verdict" } },
      },
      {
        functionName: "summarize-bonzah-submission",
        tenantId: submission.tenant_id,
        metadata: { submission_id: submissionId },
      },
    );

    const toolCall = ai.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) return errorResponse("AI did not return a structured verdict", 502);

    let parsed: {
      summary?: string;
      recommendation?: string;
      confidence?: number;
      reasons?: string[];
      red_flags?: string[];
    } = {};
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch (e) {
      console.error("[summarize-bonzah-submission] parse error:", e, toolCall.function.arguments);
      return errorResponse("Failed to parse AI verdict", 502);
    }

    const recommendation = ["approve", "disapprove", "uncertain"].includes(
      parsed.recommendation ?? "",
    )
      ? parsed.recommendation
      : "uncertain";
    const generatedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("bonzah_onboarding_submissions")
      .update({
        ai_summary: parsed.summary ?? null,
        ai_recommendation: recommendation,
        ai_confidence: clampConfidence(parsed.confidence),
        ai_reasons: parsed.reasons ?? [],
        ai_red_flags: parsed.red_flags ?? [],
        ai_generated_at: generatedAt,
      })
      .eq("id", submissionId);

    if (updateError) {
      console.error("[summarize-bonzah-submission] update error:", updateError);
      return errorResponse("Failed to save verdict", 500);
    }

    // Append to the submission timeline (service-role write bypasses RLS).
    await supabase.from("bonzah_submission_events").insert({
      submission_id: submissionId,
      tenant_id: submission.tenant_id,
      actor_type: "system",
      event_type: "ai_analyzed",
      note: `AI recommendation: ${recommendation}`,
      metadata: {
        recommendation,
        confidence: clampConfidence(parsed.confidence),
        red_flag_count: (parsed.red_flags ?? []).length,
      },
    });

    return jsonResponse({
      summary: parsed.summary,
      recommendation,
      confidence: clampConfidence(parsed.confidence),
      reasons: parsed.reasons ?? [],
      red_flags: parsed.red_flags ?? [],
      ai_generated_at: generatedAt,
    });
  } catch (error) {
    console.error("[summarize-bonzah-submission] error:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
});
