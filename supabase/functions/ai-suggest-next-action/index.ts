/**
 * ai-suggest-next-action — Spec Section 11.2.
 *
 * Stage-aware next-action proposer using OpenAI (gpt-4o-mini for cost).
 * Returns: { action, confidence, draftMessage?, reasoning? }
 *
 * - Loads lead row + last ~20 messages + time-in-stage
 * - Stage-specific playbook prompt
 * - Caches 5 minutes by leadId + last_activity_at hash (ai_call_logs.payload_hash)
 * - Falls back to deterministic stage suggestion on failure / quota / no API key
 * - Logs to ai_call_logs (separate from openai_usage_logs which the shared helper writes)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { chatCompletion } from "../_shared/openai.ts";

interface Payload {
  leadId?: string;
}

const SUGGESTION_BY_STAGE: Record<string, { action: string; draft: string }> = {
  new: {
    action: "send_welcome",
    draft: "Hi {{first_name}}, thanks for applying! What's the best time to reach you?",
  },
  contacted: {
    action: "send_doc_request",
    draft: "Hi {{first_name}}, please upload your licence and a selfie here: {{doc_upload_link}}",
  },
  docs_requested: {
    action: "send_followup",
    draft: "Hi {{first_name}}, just checking in on those documents — let me know if you need help.",
  },
  docs_submitted: { action: "run_verification", draft: "" },
  docs_verified: { action: "approve_lead", draft: "" },
  docs_failed: { action: "review_failure", draft: "" },
  approved: { action: "send_offer", draft: "" },
  vehicle_offered: {
    action: "send_followup",
    draft: "Hi {{first_name}}, did you have a chance to look at the offer? Happy to swap any of the options.",
  },
  offer_accepted: { action: "send_agreement", draft: "" },
  agreement_sent: {
    action: "send_followup",
    draft: "Hi {{first_name}}, when you have a moment please sign the agreement so we can book your pickup.",
  },
  agreement_signed: { action: "send_payment_link", draft: "" },
  deposit_paid: { action: "schedule_pickup", draft: "" },
  pickup_scheduled: { action: "convert_to_rental", draft: "" },
  converted: { action: "do_nothing", draft: "" },
  waitlist: { action: "do_nothing", draft: "" },
  lost: { action: "do_nothing", draft: "" },
  blacklisted: { action: "do_nothing", draft: "" },
};

async function hashString(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, tenant_id, full_name, stage, stage_updated_at, last_activity_at, score_band, lead_score, application_data, vehicle_class, start_date, end_date")
      .eq("id", body.leadId)
      .maybeSingle();
    if (leadErr || !lead) return errorResponse("Lead not found", 404);

    const stage = String(lead.stage);
    const deterministic = SUGGESTION_BY_STAGE[stage] ?? { action: "do_nothing", draft: "" };

    // Tenant AI quota check
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("ai_monthly_quota")
      .eq("id", String(lead.tenant_id))
      .maybeSingle();
    const quota = (tenantRow as { ai_monthly_quota?: number } | null)?.ai_monthly_quota ?? 1000;
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count: usedCount } = await supabase
      .from("ai_call_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", String(lead.tenant_id))
      .gte("created_at", startOfMonth)
      .eq("status", "ok");
    const overQuota = (usedCount ?? 0) >= quota;

    const payloadHash = await hashString(`${lead.id}|${lead.last_activity_at}|${lead.stage}`);

    // Cache lookup (5-minute window)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from("ai_call_logs")
      .select("response_summary")
      .eq("payload_hash", payloadHash)
      .eq("function_name", "ai-suggest-next-action")
      .gte("created_at", fiveMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cached && (cached as { response_summary?: Record<string, unknown> }).response_summary) {
      return jsonResponse({ ...(cached as { response_summary: Record<string, unknown> }).response_summary, source: "cache" });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    let result: { action: string; confidence: number; draftMessage?: string; reasoning?: string };
    let usedAI = false;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let model: string | undefined;
    const startTs = Date.now();

    if (overQuota || !apiKey) {
      result = {
        action: deterministic.action,
        confidence: 0.6,
        draftMessage: deterministic.draft || undefined,
        reasoning: overQuota
          ? "AI monthly quota reached — deterministic fallback."
          : "AI disabled — deterministic fallback.",
      };
    } else {
      // Resolve the conversation row by lead_id (conversation.id ≠ lead.id).
      const { data: convRow } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", lead.id)
        .maybeSingle();
      const conversationId = (convRow as { id?: string } | null)?.id;

      // Pull recent messages
      const { data: recent } = conversationId
        ? await supabase
            .from("conversation_messages")
            .select("direction, channel, body")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(20)
        : { data: [] as Array<{ direction: string; channel: string; body: string | null }> };

      const transcript = ((recent ?? []) as Array<{ direction: string; channel: string; body: string | null }>)
        .reverse()
        .map((m) => `[${m.direction}/${m.channel}] ${m.body ?? ""}`)
        .join("\n")
        .slice(0, 3000);

      // Pre-compute lead-specific signals — these get fed to GPT in the prompt
      // AND used as a post-hoc multiplier so confidence reflects reality, not
      // just the model's default certainty.
      const now = Date.now();
      const hoursSinceActivity = lead.last_activity_at
        ? Math.max(0, (now - new Date(lead.last_activity_at).getTime()) / 3_600_000)
        : 0;
      const hoursInStage = lead.stage_updated_at
        ? Math.max(0, (now - new Date(lead.stage_updated_at).getTime()) / 3_600_000)
        : 0;
      const inboundCount = ((recent ?? []) as Array<{ direction: string }>).filter((m) => m.direction === "inbound").length;
      const outboundCount = ((recent ?? []) as Array<{ direction: string }>).filter((m) => m.direction === "outbound").length;

      try {
        model = "gpt-4o-mini";
        const completion = await chatCompletion(
          [
            {
              role: "system",
              content:
                "You are a rental operations assistant. Propose the single most useful next action " +
                "for the lead. Reply ONLY in JSON with keys: action (slug: send_welcome, send_doc_request, " +
                "send_followup, run_verification, approve_lead, send_offer, send_agreement, send_payment_link, " +
                "schedule_pickup, mark_lost, convert_to_rental, do_nothing), confidence (0–1), " +
                "draftMessage (optional, concise SMS body), reasoning (one sentence).\n\n" +
                "CONFIDENCE RULES — calibrate based on signals, do NOT default to 0.9:\n" +
                "• 0.85–0.95 only when the next action is unambiguous and the lead is actively engaged " +
                "(recent inbound message OR score=hot OR clear stage trigger like docs_verified).\n" +
                "• 0.55–0.75 when stage is clear but lead is silent (no inbound for 24h+) or score is cold.\n" +
                "• 0.30–0.50 when signals conflict (e.g., uploaded docs but explicitly said unsure) " +
                "or the lead has been silent 48h+ — your suggestion may not work.\n" +
                "• Below 0.30 when you genuinely think mark_lost or do_nothing is honest.",
            },
            {
              role: "user",
              content:
                `Lead: ${lead.full_name}\n` +
                `Stage: ${stage} (in this stage for ${hoursInStage.toFixed(1)}h)\n` +
                `Last activity: ${hoursSinceActivity.toFixed(1)}h ago\n` +
                `Score: ${lead.lead_score ?? "—"} (${lead.score_band ?? "—"})\n` +
                `Inbound messages in transcript: ${inboundCount}; outbound: ${outboundCount}\n` +
                `Recent messages:\n${transcript || "(none — lead has never replied)"}\n\n` +
                `Stage default action: ${deterministic.action}.\n\n` +
                `Calibrate confidence honestly per the rules above. Don't be over-confident.`,
            },
          ],
          { model, max_tokens: 256, temperature: 0.5 },
          { tenantId: String(lead.tenant_id), functionName: "ai-suggest-next-action" },
        );

        const txt = completion.choices?.[0]?.message?.content ?? "";
        const jsonStart = txt.indexOf("{");
        const jsonEnd = txt.lastIndexOf("}");
        const parsed = jsonStart >= 0 && jsonEnd >= 0 ? JSON.parse(txt.slice(jsonStart, jsonEnd + 1)) : null;
        if (parsed?.action) {
          // Post-hoc adjustment — GPT tends to over-default to ~0.9. Apply a
          // signal-based dampening so two leads in the same stage but different
          // engagement levels show different confidence numbers.
          let raw = Number(parsed.confidence ?? 0.7);
          if (!Number.isFinite(raw)) raw = 0.7;
          raw = Math.max(0, Math.min(1, raw));

          let multiplier = 1.0;
          // Silence penalty — every 24h of silence shaves 8% off, max −40%.
          if (hoursSinceActivity > 24) {
            multiplier *= Math.max(0.6, 1 - (hoursSinceActivity - 24) / 24 * 0.08);
          }
          // Score-band hint — risk/cold leads carry inherent uncertainty.
          if (lead.score_band === "risk") multiplier *= 0.7;
          else if (lead.score_band === "cold") multiplier *= 0.85;
          else if (lead.score_band === "hot") multiplier *= 1.05;
          // No inbound ever → operator is talking to a ghost; cap at 0.7.
          const finalConfidence = inboundCount === 0
            ? Math.min(0.7, raw * multiplier)
            : Math.max(0, Math.min(1, raw * multiplier));

          result = {
            action: String(parsed.action),
            confidence: Number(finalConfidence.toFixed(2)),
            draftMessage: parsed.draftMessage ? String(parsed.draftMessage) : undefined,
            reasoning: parsed.reasoning ? String(parsed.reasoning) : undefined,
          };
          usedAI = true;
          inputTokens = completion.usage?.prompt_tokens;
          outputTokens = completion.usage?.completion_tokens;
        } else {
          throw new Error("OpenAI response missing action");
        }
      } catch (err) {
        console.error("ai-suggest-next-action OpenAI error:", err);
        result = {
          action: deterministic.action,
          confidence: 0.5,
          draftMessage: deterministic.draft || undefined,
          reasoning: "AI call failed — deterministic fallback.",
        };
      }
    }

    await supabase.from("ai_call_logs").insert({
      tenant_id: lead.tenant_id,
      function_name: "ai-suggest-next-action",
      lead_id: lead.id,
      model: usedAI ? model : null,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      latency_ms: Date.now() - startTs,
      cache_hit: false,
      status: "ok",
      payload_hash: payloadHash,
      response_summary: result,
    });

    return jsonResponse({ ...result, source: usedAI ? "ai" : "fallback" });
  } catch (err) {
    console.error("ai-suggest-next-action error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
