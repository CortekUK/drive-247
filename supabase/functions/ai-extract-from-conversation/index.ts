/**
 * ai-extract-from-conversation — Spec Section 11.2.
 *
 * Inputs:  { leadId, conversationId?, sinceMessageId? }
 * Outputs: extractions: Array<{ field, value, confidence, evidence }>
 *
 * Only returns updates with confidence ≥ 0.7. Uses OpenAI gpt-4o-mini.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion } from "../_shared/openai.ts";

interface Payload {
  leadId?: string;
  conversationId?: string;
  sinceMessageId?: string;
}

const EXTRACTABLE_FIELDS = [
  "yearsDriving",
  "purpose",
  "weeklyBudget",
  "depositComfortAmount",
  "neededByDate",
  "rideshareTier",
  "rideshareAccountActive",
  "rentalLengthTarget",
  "vehicleClass",
  "hasViolations",
];

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: lead } = await supabase
      .from("leads")
      .select("id, tenant_id, application_data")
      .eq("id", body.leadId)
      .maybeSingle();
    if (!lead) return errorResponse("Lead not found", 404);

    // Resolve conversation
    let conversationId = body.conversationId;
    if (!conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", body.leadId)
        .maybeSingle();
      conversationId = (conv as { id?: string } | null)?.id;
    }
    if (!conversationId) return jsonResponse({ extractions: [] });

    // Load up to 50 most recent messages
    const { data: messages } = await supabase
      .from("conversation_messages")
      .select("id, direction, channel, body")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(50);

    const recent = ((messages ?? []) as Array<{ id: string; direction: string; channel: string; body: string | null }>).reverse();
    if (recent.length === 0) return jsonResponse({ extractions: [] });

    const transcript = recent
      .map((m) => `[${m.direction === "inbound" ? "lead" : "staff"}/${m.channel}] ${m.body ?? ""}`)
      .join("\n")
      .slice(0, 6000);

    const startTs = Date.now();
    const payloadHash = await hashString(`extract|${body.leadId}|${recent[recent.length - 1]?.id}`);
    const apiKey = Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      await supabase.from("ai_call_logs").insert({
        tenant_id: lead.tenant_id,
        function_name: "ai-extract-from-conversation",
        lead_id: lead.id,
        latency_ms: Date.now() - startTs,
        status: "ok",
        payload_hash: payloadHash,
        response_summary: { extractions: [] },
      });
      return jsonResponse({ extractions: [], source: "fallback" });
    }

    const currentData = (lead.application_data ?? {}) as Record<string, unknown>;

    let extractions: Array<{ field: string; value: unknown; confidence: number; evidence: string }> = [];
    const model = "gpt-4o-mini";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    try {
      const completion = await chatCompletion(
        [
          {
            role: "system",
            content:
              `You extract structured rental-application fields from a lead conversation. ` +
              `Allowed fields: ${EXTRACTABLE_FIELDS.join(", ")}. ` +
              `Reply ONLY with JSON: { "extractions": [{ "field": "...", "value": ..., "confidence": 0–1, "evidence": "quoted phrase" }] }. ` +
              `Only include fields with confidence ≥ 0.7. Skip fields already populated unless the lead clearly updated them.`,
          },
          {
            role: "user",
            content: `Current application_data:\n${JSON.stringify(currentData)}\n\nConversation:\n${transcript}`,
          },
        ],
        { model, max_tokens: 1024, temperature: 0.2 },
        { tenantId: String(lead.tenant_id), functionName: "ai-extract-from-conversation" },
      );
      const txt = completion.choices?.[0]?.message?.content ?? "";
      const start = txt.indexOf("{");
      const end = txt.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(txt.slice(start, end + 1));
        if (Array.isArray(parsed.extractions)) {
          extractions = parsed.extractions
            .filter((e: { field: string; confidence: number }) =>
              EXTRACTABLE_FIELDS.includes(e.field) && Number(e.confidence) >= 0.7
            )
            .map((e: { field: string; value: unknown; confidence: number; evidence?: string }) => ({
              field: e.field,
              value: e.value,
              confidence: Number(e.confidence),
              evidence: e.evidence ?? "",
            }));
        }
      }
      inputTokens = completion.usage?.prompt_tokens;
      outputTokens = completion.usage?.completion_tokens;
    } catch (err) {
      console.error("ai-extract-from-conversation OpenAI error:", err);
    }

    await supabase.from("ai_call_logs").insert({
      tenant_id: lead.tenant_id,
      function_name: "ai-extract-from-conversation",
      lead_id: lead.id,
      model,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      latency_ms: Date.now() - startTs,
      status: "ok",
      payload_hash: payloadHash,
      response_summary: { extractions },
    });

    return jsonResponse({ extractions, source: "ai" });
  } catch (err) {
    console.error("ai-extract-from-conversation error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
