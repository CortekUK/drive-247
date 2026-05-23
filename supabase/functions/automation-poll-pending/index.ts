/**
 * automation-poll-pending — Spec Section 7.5 + 9.3.
 *
 * Every 60 seconds:
 *   1. Pull up to 100 unprocessed events from automation_event_queue.
 *   2. For each, find published automations matching tenant_id + trigger_type.
 *   3. Apply trigger_config filters against the event payload.
 *   4. For each matching automation, create an automation_runs row and kick
 *      automation-execute-step.
 *   5. Mark the event row processed=true.
 *
 * Then:
 *   6. Find up to 100 automation_runs with status='waiting' and resume_at <= NOW().
 *   7. Set status='running' and re-invoke automation-execute-step.
 *
 * Returns { processed, resumed, errors }.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface EventRow {
  id: string;
  tenant_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
}

interface AutomationRow {
  id: string;
  tenant_id: string;
  version: number;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  status: string;
  published_snapshot: { steps?: Array<{ id: string }> } | null;
}

interface RunRow {
  id: string;
  automation_id: string;
  current_step_id: string | null;
}

function matchesFilter(payload: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    if (payload[key] !== expected) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const cronSecret = Deno.env.get("AUTOMATION_CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret !== cronSecret) return errorResponse("Unauthorised", 401);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const summary = { processed: 0, automations_kicked: 0, resumed: 0, errors: [] as string[] };

    // 1. Unprocessed events
    const { data: events } = await supabase
      .from("automation_event_queue")
      .select("*")
      .eq("processed", false)
      .order("created_at", { ascending: true })
      .limit(100);

    for (const event of ((events ?? []) as EventRow[])) {
      try {
        // 2. Matching published automations
        const { data: automations } = await supabase
          .from("automations")
          .select("id, tenant_id, version, trigger_type, trigger_config, status, published_snapshot")
          .eq("tenant_id", event.tenant_id)
          .eq("trigger_type", event.event_type)
          .eq("status", "published");

        for (const automation of ((automations ?? []) as AutomationRow[])) {
          if (!matchesFilter(event.payload, automation.trigger_config)) continue;
          const firstStepId = automation.published_snapshot?.steps?.[0]?.id;
          if (!firstStepId) continue;

          const { data: run, error: runErr } = await supabase
            .from("automation_runs")
            .insert({
              tenant_id: event.tenant_id,
              automation_id: automation.id,
              automation_version: automation.version,
              entity_type: event.entity_type,
              entity_id: event.entity_id,
              status: "running",
              current_step_id: firstStepId,
              triggered_by: "event",
              triggered_by_event: event.event_type,
              context: event.payload,
            })
            .select("id")
            .single();
          if (runErr || !run) {
            summary.errors.push(`run insert: ${runErr?.message ?? "unknown"}`);
            continue;
          }

          // Fire-and-forget — cron will resume if it hangs
          supabase.functions
            .invoke("automation-execute-step", { body: { runId: run.id } })
            .catch((err) => summary.errors.push(`execute-step: ${err}`));

          summary.automations_kicked++;
        }

        await supabase
          .from("automation_event_queue")
          .update({ processed: true, processed_at: new Date().toISOString() })
          .eq("id", event.id);
        summary.processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        summary.errors.push(`event ${event.id}: ${msg}`);
        await supabase
          .from("automation_event_queue")
          .update({ attempts: 0 /* incremented separately */, last_error: msg })
          .eq("id", event.id);
      }
    }

    // 6-7. Resume waiting runs whose resume_at is past
    const nowIso = new Date().toISOString();
    const { data: waiting } = await supabase
      .from("automation_runs")
      .select("id, automation_id, current_step_id")
      .eq("status", "waiting")
      .lte("resume_at", nowIso)
      .limit(100);

    for (const run of ((waiting ?? []) as RunRow[])) {
      await supabase
        .from("automation_runs")
        .update({ status: "running", resume_at: null })
        .eq("id", run.id);
      supabase.functions
        .invoke("automation-execute-step", { body: { runId: run.id } })
        .catch((err) => summary.errors.push(`resume execute-step: ${err}`));
      summary.resumed++;
    }

    return jsonResponse(summary);
  } catch (err) {
    console.error("automation-poll-pending error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
