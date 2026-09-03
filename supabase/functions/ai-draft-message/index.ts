/**
 * ai-draft-message — Spec Section 11.2.
 *
 * Inputs:  { leadId, intent, customPrompt? }
 *           intent ∈ welcome | doc_request | approval | offer | followup | decline | custom
 * Outputs: { subject?, body, channelHint }
 *
 * Uses OpenAI gpt-4o-mini + tenants.communication_tone (casual / friendly / professional).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion } from "../_shared/openai.ts";

type Intent = "welcome" | "doc_request" | "approval" | "offer" | "followup" | "decline" | "custom";

interface Payload {
  leadId?: string;
  intent?: Intent;
  customPrompt?: string;
  channelHint?: "sms" | "email" | "whatsapp";
}

async function hashString(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const INTENT_PROMPTS: Record<Intent, string> = {
  welcome: "a warm welcome confirming we received the application and will follow up shortly",
  doc_request: "a polite request for the lead to upload their driver licence and a selfie",
  approval: "an approval message telling them we'd love to rent to them and we'll send a vehicle offer next",
  offer: "an introduction to the vehicle offer link we're sending",
  followup: "a low-pressure check-in for an unresponsive lead",
  decline: "a polite decline without explanation",
  custom: "follow the operator's exact customPrompt",
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.leadId) return errorResponse("leadId is required");
    if (!body.intent) return errorResponse("intent is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: lead } = await supabase
      .from("leads")
      .select("id, tenant_id, full_name, stage, vehicle_class, start_date, end_date, application_data, score_band")
      .eq("id", body.leadId)
      .maybeSingle();
    if (!lead) return errorResponse("Lead not found", 404);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("company_name, communication_tone")
      .eq("id", String(lead.tenant_id))
      .maybeSingle();

    const tone = ((tenant as { communication_tone?: string } | null)?.communication_tone ?? "friendly") as "casual" | "friendly" | "professional";
    const tenantName = (tenant as { company_name?: string | null } | null)?.company_name ?? "our team";
    const firstName = String(lead.full_name).split(" ")[0];
    const channelHint = body.channelHint ?? (body.intent === "offer" || body.intent === "approval" ? "email" : "sms");

    const payloadHash = await hashString(`draft|${body.leadId}|${body.intent}|${body.customPrompt ?? ""}|${channelHint}|${lead.stage}`);

    // 5-min cache lookup
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: cached } = await supabase
      .from("ai_call_logs")
      .select("response_summary")
      .eq("payload_hash", payloadHash)
      .eq("function_name", "ai-draft-message")
      .gte("created_at", fiveMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached && (cached as { response_summary?: Record<string, unknown> }).response_summary) {
      return jsonResponse({ ...(cached as { response_summary: Record<string, unknown> }).response_summary, source: "cache" });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const startTs = Date.now();

    if (!apiKey) {
      const fallback = {
        body: `Hi ${firstName}, ${INTENT_PROMPTS[body.intent]}. — ${tenantName}`,
        channelHint,
      };
      await supabase.from("ai_call_logs").insert({
        tenant_id: lead.tenant_id,
        function_name: "ai-draft-message",
        lead_id: lead.id,
        latency_ms: Date.now() - startTs,
        status: "ok",
        payload_hash: payloadHash,
        response_summary: fallback,
      });
      return jsonResponse({ ...fallback, source: "fallback" });
    }

    let result: { body: string; subject?: string; channelHint: string } = { body: "", channelHint };
    const model = "gpt-4o-mini";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      const promptIntent = body.intent === "custom" && body.customPrompt
        ? body.customPrompt
        : INTENT_PROMPTS[body.intent];

      const completion = await chatCompletion(
        [
          {
            role: "system",
            content:
              `You draft outbound messages for a vehicle-rental operator. Tone: ${tone}. ` +
              `Tenant: ${tenantName}. Channel: ${channelHint}. ` +
              (channelHint === "email"
                ? `Reply ONLY with JSON: { "subject": "...", "body": "..." }. Body is a short email body (3–5 sentences max).`
                : `Reply ONLY with JSON: { "body": "..." }. Body is a short SMS-friendly message (1–2 sentences, under 280 chars).`) +
              ` Use {{first_name}} for the lead's first name. Use {{tenant_name}} for the operator's name. Avoid filler.`,
          },
          {
            role: "user",
            content:
              `Lead first name: ${firstName}\nStage: ${lead.stage}\nScore: ${lead.score_band ?? "—"}\n` +
              `Vehicle interest: ${lead.vehicle_class ?? "any"}\nDates: ${lead.start_date ?? "—"} → ${lead.end_date ?? "—"}\n\n` +
              `Draft ${promptIntent}.`,
          },
        ],
        { model, max_tokens: 400, temperature: 0.7 },
        { tenantId: String(lead.tenant_id), functionName: "ai-draft-message" },
      );
      const txt = completion.choices?.[0]?.message?.content ?? "";
      const start = txt.indexOf("{");
      const end = txt.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(txt.slice(start, end + 1));
        if (parsed.body) {
          result = {
            body: String(parsed.body),
            subject: parsed.subject ? String(parsed.subject) : undefined,
            channelHint,
          };
        }
      }
      inputTokens = completion.usage?.prompt_tokens;
      outputTokens = completion.usage?.completion_tokens;
    } catch (err) {
      console.error("ai-draft-message OpenAI error:", err);
      result = {
        body: `Hi {{first_name}}, ${INTENT_PROMPTS[body.intent]}. — {{tenant_name}}`,
        subject: channelHint === "email" ? "From {{tenant_name}}" : undefined,
        channelHint,
      };
    }

    await supabase.from("ai_call_logs").insert({
      tenant_id: lead.tenant_id,
      function_name: "ai-draft-message",
      lead_id: lead.id,
      model,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      latency_ms: Date.now() - startTs,
      status: "ok",
      payload_hash: payloadHash,
      response_summary: result,
    });

    return jsonResponse({ ...result, source: "ai" });
  } catch (err) {
    console.error("ai-draft-message error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
