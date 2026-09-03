/**
 * automation-execute-step — Spec Section 7.5.
 *
 * Internal-only step executor. Reads the run + step config from
 * automations.published_snapshot (NOT the live automation_steps table, so
 * editing a published automation never breaks in-flight runs).
 *
 * Step types:
 *   sms       → invoke send-lead-message channel=sms; record log; advance
 *   email     → invoke send-lead-message channel=email; record log; advance
 *   wait      → set status='waiting', resume_at=NOW()+duration; cron resumes
 *   condition → evaluate expression against entity + context; branch to true/false child
 *   stop      → set status='completed'
 *
 * Conditions: safe whitelist evaluator. No JS eval. Supports:
 *   lead.score_band == 'hot'
 *   lead.purpose == 'uber'
 *   payload.from_stage == 'new'
 *   payload.score >= 70
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Step {
  id: string;
  parent_step_id: string | null;
  order_index: number;
  step_type:
    | "sms"
    | "email"
    | "wait"
    | "condition"
    | "stop"
    | "whatsapp"
    | "move_stage"
    | "assign_staff"
    | "create_task"
    | "webhook"
    | "generate_doc";
  config: Record<string, unknown>;
  branch: "true" | "false" | null;
}

interface Snapshot {
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  steps: Step[];
}

interface Payload {
  runId?: string;
}

function rootOrderedSteps(steps: Step[]): Step[] {
  return steps.filter((s) => !s.parent_step_id).sort((a, b) => a.order_index - b.order_index);
}

function childrenOf(steps: Step[], parentId: string, branch?: "true" | "false"): Step[] {
  return steps
    .filter((s) => s.parent_step_id === parentId && (branch ? s.branch === branch : true))
    .sort((a, b) => a.order_index - b.order_index);
}

function nextStepAfter(steps: Step[], currentId: string): Step | null {
  const current = steps.find((s) => s.id === currentId);
  if (!current) return null;

  // Linear walk for steps with the same parent
  const peers = current.parent_step_id
    ? childrenOf(steps, current.parent_step_id, current.branch ?? undefined)
    : rootOrderedSteps(steps);
  const idx = peers.findIndex((s) => s.id === currentId);
  if (idx >= 0 && idx + 1 < peers.length) return peers[idx + 1];

  // Otherwise climb to parent's next sibling
  if (current.parent_step_id) {
    return nextStepAfter(steps, current.parent_step_id);
  }
  return null;
}

function evaluateExpression(expr: string, entity: Record<string, unknown>, ctx: Record<string, unknown>): boolean {
  // Tokens: <path> <op> <literal>
  const match = expr.match(/^\s*([a-zA-Z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!match) return false;
  const [, path, op, rawLit] = match;
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, { lead: entity, payload: ctx } as Record<string, unknown>);

  let lit: unknown = rawLit;
  if (/^['"].*['"]$/.test(rawLit)) lit = rawLit.slice(1, -1);
  else if (!Number.isNaN(Number(rawLit))) lit = Number(rawLit);
  else if (rawLit === "true") lit = true;
  else if (rawLit === "false") lit = false;
  else if (rawLit === "null") lit = null;

  switch (op) {
    case "==": return value === lit;
    case "!=": return value !== lit;
    case ">": return Number(value) > Number(lit);
    case "<": return Number(value) < Number(lit);
    case ">=": return Number(value) >= Number(lit);
    case "<=": return Number(value) <= Number(lit);
  }
  return false;
}

function durationToMs(d: { value: number; unit: string }): number {
  const v = Number(d.value);
  if (d.unit === "minutes") return v * 60_000;
  if (d.unit === "hours") return v * 60 * 60_000;
  if (d.unit === "days") return v * 24 * 60 * 60_000;
  return v * 60_000;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.runId) return errorResponse("runId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: run, error: runErr } = await supabase
      .from("automation_runs")
      .select("*")
      .eq("id", body.runId)
      .maybeSingle();
    if (runErr || !run) return errorResponse("Run not found", 404);
    if (!["running", "waiting"].includes(run.status)) {
      return jsonResponse({ skipped: true, status: run.status });
    }

    const { data: automation } = await supabase
      .from("automations")
      .select("published_snapshot")
      .eq("id", run.automation_id)
      .maybeSingle();
    const snapshot = (automation?.published_snapshot ?? {}) as Snapshot;
    if (!snapshot.steps || snapshot.steps.length === 0) {
      await supabase.from("automation_runs").update({ status: "failed", error_message: "No steps in snapshot", ended_at: new Date().toISOString() }).eq("id", run.id);
      return errorResponse("Automation snapshot has no steps", 500);
    }

    let step = snapshot.steps.find((s) => s.id === run.current_step_id) ?? rootOrderedSteps(snapshot.steps)[0];
    if (!step) {
      await supabase.from("automation_runs").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", run.id);
      return jsonResponse({ status: "completed" });
    }

    // Load entity (V1: only lead entities)
    let entity: Record<string, unknown> = {};
    if (run.entity_type === "lead") {
      const { data: lead } = await supabase
        .from("leads")
        .select("*")
        .eq("id", run.entity_id)
        .maybeSingle();
      if (lead) entity = lead as Record<string, unknown>;
    }

    let logStatus: "executed" | "skipped" | "failed" = "executed";
    let logOutput: Record<string, unknown> | null = null;
    let logError: string | null = null;
    let advance = true;
    let advanceTo: Step | null = nextStepAfter(snapshot.steps, step.id);

    try {
      switch (step.step_type) {
        case "sms":
        case "email": {
          if (run.entity_type !== "lead") {
            logStatus = "skipped";
            logOutput = { reason: "Non-lead entities not supported in V1" };
            break;
          }
          const { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("lead_id", run.entity_id)
            .maybeSingle();
          if (!conv?.id) {
            logStatus = "failed";
            logError = "No conversation for lead";
            break;
          }
          const cfg = step.config as { templateId?: string; body?: string; subject?: string };
          await supabase.functions.invoke("send-lead-message", {
            body: {
              tenantId: run.tenant_id,
              leadId: run.entity_id,
              conversationId: conv.id,
              channel: step.step_type,
              body: cfg.body ?? "",
              subject: cfg.subject,
              templateId: cfg.templateId,
              systemTriggered: true,
              variables: run.context,
            },
          });
          logOutput = { channel: step.step_type };
          break;
        }
        case "wait": {
          const cfg = step.config as { duration?: { value: number; unit: string } };
          const ms = durationToMs(cfg.duration ?? { value: 1, unit: "hours" });
          const resumeAt = new Date(Date.now() + ms).toISOString();
          await supabase
            .from("automation_runs")
            .update({ status: "waiting", resume_at: resumeAt, current_step_id: step.id })
            .eq("id", run.id);
          logOutput = { resume_at: resumeAt };
          advance = false; // cron resumes later
          break;
        }
        case "condition": {
          const cfg = step.config as { expression?: string };
          const result = cfg.expression ? evaluateExpression(cfg.expression, entity, run.context ?? {}) : false;
          logOutput = { expression: cfg.expression, result };
          const branchKids = childrenOf(snapshot.steps, step.id, result ? "true" : "false");
          if (branchKids.length > 0) {
            advanceTo = branchKids[0];
          } else {
            // Skip past — fall through to next sibling
            advanceTo = nextStepAfter(snapshot.steps, step.id);
          }
          break;
        }
        case "stop": {
          await supabase
            .from("automation_runs")
            .update({ status: "completed", ended_at: new Date().toISOString(), current_step_id: step.id })
            .eq("id", run.id);
          advance = false;
          break;
        }
        case "whatsapp": {
          if (run.entity_type !== "lead") {
            logStatus = "skipped";
            logOutput = { reason: "Non-lead entities not supported in V1" };
            break;
          }
          const { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("lead_id", run.entity_id)
            .maybeSingle();
          if (!conv?.id) {
            logStatus = "failed";
            logError = "No conversation for lead";
            break;
          }
          const cfg = step.config as { templateId?: string; body?: string };
          await supabase.functions.invoke("send-lead-message", {
            body: {
              tenantId: run.tenant_id,
              leadId: run.entity_id,
              conversationId: conv.id,
              channel: "whatsapp",
              body: cfg.body ?? "",
              templateId: cfg.templateId,
              systemTriggered: true,
              variables: run.context,
            },
          });
          logOutput = { channel: "whatsapp" };
          break;
        }
        case "move_stage": {
          if (run.entity_type !== "lead") {
            logStatus = "skipped";
            logOutput = { reason: "move_stage only supports leads" };
            break;
          }
          const cfg = step.config as { to_stage?: string };
          if (!cfg.to_stage) {
            logStatus = "failed";
            logError = "to_stage missing";
            break;
          }
          const { error: stageErr } = await supabase
            .from("leads")
            .update({ stage: cfg.to_stage })
            .eq("id", run.entity_id);
          if (stageErr) {
            logStatus = "failed";
            logError = stageErr.message;
          } else {
            logOutput = { to_stage: cfg.to_stage };
          }
          break;
        }
        case "assign_staff": {
          if (run.entity_type !== "lead") {
            logStatus = "skipped";
            logOutput = { reason: "assign_staff only supports leads" };
            break;
          }
          const cfg = step.config as { user_id?: string; rule?: "round_robin" | "least_loaded" };
          let userId: string | null = cfg.user_id ?? null;
          if (!userId && cfg.rule) {
            // Pull active staff for this tenant
            const { data: candidates } = await supabase
              .from("app_users")
              .select("id")
              .eq("tenant_id", run.tenant_id)
              .in("role", ["admin", "head_admin", "manager", "ops"]);
            if (cfg.rule === "round_robin" && candidates && candidates.length > 0) {
              const idx = Math.floor(Math.random() * candidates.length);
              userId = candidates[idx].id;
            } else if (cfg.rule === "least_loaded" && candidates && candidates.length > 0) {
              const { data: counts } = await supabase
                .from("leads")
                .select("assigned_to")
                .eq("tenant_id", run.tenant_id)
                .in("stage", [
                  "new",
                  "contacted",
                  "docs_requested",
                  "docs_submitted",
                  "docs_verified",
                  "approved",
                  "vehicle_offered",
                  "offer_accepted",
                  "agreement_sent",
                  "agreement_signed",
                  "deposit_paid",
                  "pickup_scheduled",
                ]);
              const load: Record<string, number> = {};
              for (const c of candidates) load[c.id] = 0;
              for (const row of (counts ?? []) as { assigned_to: string | null }[]) {
                if (row.assigned_to && load[row.assigned_to] !== undefined) load[row.assigned_to]++;
              }
              userId = Object.entries(load).sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
            }
          }
          if (!userId) {
            logStatus = "failed";
            logError = "Could not resolve a staff user";
            break;
          }
          await supabase.from("leads").update({ assigned_to: userId }).eq("id", run.entity_id);
          logOutput = { assigned_to: userId };
          break;
        }
        case "create_task": {
          if (run.entity_type !== "lead") {
            logStatus = "skipped";
            logOutput = { reason: "create_task only supports leads" };
            break;
          }
          const cfg = step.config as { body?: string };
          await supabase.from("lead_notes").insert({
            tenant_id: run.tenant_id,
            lead_id: run.entity_id,
            author_id: null,
            body: `📋 Task (from automation): ${cfg.body ?? "Follow up with this lead"}`,
            is_pinned: true,
          });
          logOutput = { task_body: cfg.body };
          break;
        }
        case "webhook": {
          const cfg = step.config as { url?: string; method?: string; body?: unknown; headers?: Record<string, string> };
          if (!cfg.url) {
            logStatus = "failed";
            logError = "url missing";
            break;
          }
          try {
            const r = await fetch(cfg.url, {
              method: cfg.method ?? "POST",
              headers: { "Content-Type": "application/json", ...(cfg.headers ?? {}) },
              body: cfg.body !== undefined ? JSON.stringify(cfg.body) : JSON.stringify({ runId: run.id, entityId: run.entity_id, context: run.context }),
            });
            logOutput = { status: r.status, ok: r.ok };
            if (!r.ok) {
              logStatus = "failed";
              logError = `HTTP ${r.status}`;
            }
          } catch (err) {
            logStatus = "failed";
            logError = err instanceof Error ? err.message : "Webhook error";
          }
          break;
        }
        case "generate_doc": {
          if (run.entity_type !== "lead") {
            logStatus = "skipped";
            logOutput = { reason: "generate_doc only supports leads in V1" };
            break;
          }
          const cfg = step.config as { template_type?: string };
          // V1: only "agreement" supported — proxies to create-boldsign-document.
          if (cfg.template_type === "agreement") {
            const { data: lead } = await supabase
              .from("leads")
              .select("full_name, email, phone, vehicle_id, start_date, end_date")
              .eq("id", run.entity_id)
              .maybeSingle();
            if (lead) {
              const { data: doc, error: docErr } = await supabase.functions.invoke<{ documentId: string }>(
                "create-boldsign-document",
                {
                  body: {
                    tenantId: run.tenant_id,
                    leadId: run.entity_id,
                    customerName: lead.full_name,
                    customerEmail: lead.email,
                    customerPhone: lead.phone,
                    vehicleId: lead.vehicle_id,
                    startDate: lead.start_date,
                    endDate: lead.end_date,
                  },
                },
              );
              if (docErr) {
                logStatus = "failed";
                logError = docErr.message;
              } else {
                logOutput = { documentId: doc?.documentId };
              }
            }
          } else {
            logStatus = "skipped";
            logOutput = { reason: `Unsupported template_type=${cfg.template_type}` };
          }
          break;
        }
      }
    } catch (err) {
      logStatus = "failed";
      logError = err instanceof Error ? err.message : "Unknown step error";
    }

    // Log step result
    await supabase.from("automation_run_logs").insert({
      run_id: run.id,
      step_id: step.id,
      status: logStatus,
      output: logOutput,
      error: logError,
    });

    if (logStatus === "failed") {
      await supabase
        .from("automation_runs")
        .update({ status: "failed", error_message: logError, ended_at: new Date().toISOString() })
        .eq("id", run.id);
      return jsonResponse({ status: "failed" });
    }

    if (!advance) {
      return jsonResponse({ status: step.step_type === "stop" ? "completed" : "waiting" });
    }

    if (advanceTo) {
      await supabase
        .from("automation_runs")
        .update({ status: "running", current_step_id: advanceTo.id })
        .eq("id", run.id);
      // Tail-call into next step (limit avoidance — cron resumes if anything fails)
      supabase.functions.invoke("automation-execute-step", { body: { runId: run.id } }).catch(() => {});
      return jsonResponse({ status: "advanced", nextStepId: advanceTo.id });
    }

    // No more steps — completed
    await supabase
      .from("automation_runs")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", run.id);
    return jsonResponse({ status: "completed" });
  } catch (err) {
    console.error("automation-execute-step error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
