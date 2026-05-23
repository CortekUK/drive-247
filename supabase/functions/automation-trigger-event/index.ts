/**
 * automation-trigger-event — Spec Section 7.5.
 *
 * Inserts an event into automation_event_queue. Idempotent in spirit — the
 * poller dedupes on (event_type, entity_id, created_at). Callable from:
 *   - App code (any portal mutation or edge function via supabase.functions.invoke)
 *   - DB triggers (via the notify_automation_event SQL function)
 *
 * The manual trigger path (event_type='manual') also creates an automation_run
 * directly for the specified automation_id so the operator gets immediate
 * feedback in the workspace.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  tenantId?: string;
  eventType?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  /** Required when eventType='manual' */
  automationId?: string;
  triggeredByUserId?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.tenantId) return errorResponse("tenantId is required");
    if (!body.eventType) return errorResponse("eventType is required");
    if (!body.entityType) return errorResponse("entityType is required");
    if (!body.entityId) return errorResponse("entityId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Insert into queue (same path as DB-trigger emissions)
    const { error: queueErr } = await supabase.from("automation_event_queue").insert({
      tenant_id: body.tenantId,
      event_type: body.eventType,
      entity_type: body.entityType,
      entity_id: body.entityId,
      payload: body.payload ?? {},
    });
    if (queueErr) {
      console.error("automation-trigger-event queue insert error:", queueErr);
      return errorResponse("Failed to enqueue event", 500);
    }

    // Manual trigger → spin up a run immediately for the specified automation
    if (body.eventType === "manual" && body.automationId) {
      const { data: automation } = await supabase
        .from("automations")
        .select("id, version, status, published_snapshot, tenant_id")
        .eq("id", body.automationId)
        .eq("tenant_id", body.tenantId)
        .maybeSingle();
      if (!automation || automation.status !== "published") {
        return errorResponse("Automation not published", 400);
      }
      const snapshot = (automation.published_snapshot ?? {}) as { steps?: Array<{ id: string }> };
      const firstStepId = snapshot.steps?.[0]?.id;
      if (!firstStepId) return errorResponse("Automation has no steps", 400);

      const { data: run, error: runErr } = await supabase
        .from("automation_runs")
        .insert({
          tenant_id: body.tenantId,
          automation_id: automation.id,
          automation_version: automation.version,
          entity_type: body.entityType,
          entity_id: body.entityId,
          status: "running",
          current_step_id: firstStepId,
          triggered_by: "manual",
          triggered_by_user: body.triggeredByUserId ?? null,
          context: body.payload ?? {},
        })
        .select("id")
        .single();
      if (runErr || !run) {
        console.error("automation-trigger-event run insert error:", runErr);
        return errorResponse("Failed to start run", 500);
      }

      // Kick off step executor (fire-and-forget; cron polls handle retries)
      supabase.functions
        .invoke("automation-execute-step", { body: { runId: run.id } })
        .catch((err) => console.error("execute-step kick-off failed:", err));

      return jsonResponse({ enqueued: true, runId: run.id });
    }

    return jsonResponse({ enqueued: true });
  } catch (err) {
    console.error("automation-trigger-event error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
