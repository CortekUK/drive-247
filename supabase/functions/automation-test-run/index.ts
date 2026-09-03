/**
 * automation-test-run — Spec Section 7.3 (Test mode).
 *
 * Inputs:  { automationId, leadId }
 * Outputs: timeline: Array<{ stepIndex, stepType, action, preview, waitMs?, branch? }>
 *
 * Simulates the automation against a real lead WITHOUT dispatching real messages,
 * updating stages, calling webhooks, or persisting runs. Reuses the engine's
 * step resolution + variable rendering by re-implementing them locally (we
 * deliberately don't write to automation_runs / lead_activity / outbound APIs).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Step {
  id: string;
  parent_step_id: string | null;
  order_index: number;
  step_type: string;
  config: Record<string, unknown>;
  branch: "true" | "false" | null;
}

interface Snapshot {
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  steps: Step[];
}

interface Payload {
  automationId?: string;
  leadId?: string;
}

interface TimelineEntry {
  stepIndex: number;
  stepType: string;
  action: string;
  preview: string;
  waitMs?: number;
  branch?: "true" | "false";
  skipped?: boolean;
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
  const peers = current.parent_step_id
    ? childrenOf(steps, current.parent_step_id, current.branch ?? undefined)
    : rootOrderedSteps(steps);
  const idx = peers.findIndex((s) => s.id === currentId);
  if (idx >= 0 && idx + 1 < peers.length) return peers[idx + 1];
  if (current.parent_step_id) return nextStepAfter(steps, current.parent_step_id);
  return null;
}

function renderVars(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function evalExpr(expr: string, entity: Record<string, unknown>, ctx: Record<string, unknown>): boolean {
  const m = expr.match(/^\s*([a-zA-Z0-9_.]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
  if (!m) return false;
  const [, path, op, rawLit] = m;
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

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.automationId) return errorResponse("automationId is required");
    if (!body.leadId) return errorResponse("leadId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: automation } = await supabase
      .from("automations")
      .select("id, tenant_id, status, published_snapshot")
      .eq("id", body.automationId)
      .maybeSingle();
    if (!automation) return errorResponse("Automation not found", 404);

    // Prefer the published snapshot; if none, build a transient snapshot from draft steps.
    let snapshot = (automation.published_snapshot ?? null) as Snapshot | null;
    if (!snapshot) {
      const { data: steps } = await supabase
        .from("automation_steps")
        .select("id, parent_step_id, order_index, step_type, config, branch")
        .eq("automation_id", automation.id);
      snapshot = {
        trigger_type: "",
        trigger_config: {},
        steps: (steps ?? []) as Step[],
      };
    }
    if (!snapshot.steps || snapshot.steps.length === 0) {
      return jsonResponse({ timeline: [], note: "No steps to simulate." });
    }

    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", body.leadId)
      .eq("tenant_id", automation.tenant_id)
      .maybeSingle();
    if (!lead) return errorResponse("Lead not found for this tenant", 404);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("company_name")
      .eq("id", automation.tenant_id)
      .maybeSingle();

    const vars: Record<string, string | number> = {
      first_name: String(lead.full_name ?? "").split(" ")[0],
      full_name: lead.full_name ?? "",
      phone: lead.phone ?? "",
      email: lead.email ?? "",
      vehicle: lead.vehicle_class ?? "",
      start_date: lead.start_date ?? "",
      end_date: lead.end_date ?? "",
      tenant_name: tenant?.company_name ?? "",
    };

    const timeline: TimelineEntry[] = [];
    let stepCursor: Step | null = rootOrderedSteps(snapshot.steps)[0] ?? null;
    let stepIndex = 0;
    let safety = 0;

    while (stepCursor && safety++ < 50) {
      const cfg = stepCursor.config as Record<string, unknown>;
      let action = "";
      let preview = "";
      let waitMs: number | undefined;
      let branch: "true" | "false" | undefined;
      let advanceTo: Step | null = nextStepAfter(snapshot.steps, stepCursor.id);

      switch (stepCursor.step_type) {
        case "sms":
        case "whatsapp": {
          action = stepCursor.step_type === "sms" ? "Would send SMS" : "Would send WhatsApp";
          let bodyTxt = (cfg.body as string) ?? "";
          if (cfg.templateId) {
            const { data: tpl } = await supabase
              .from("lead_message_templates")
              .select("body")
              .eq("id", String(cfg.templateId))
              .maybeSingle();
            if (tpl?.body) bodyTxt = tpl.body;
          }
          preview = renderVars(bodyTxt, vars);
          break;
        }
        case "email": {
          action = "Would send Email";
          let bodyTxt = (cfg.body as string) ?? "";
          let subj = (cfg.subject as string) ?? "";
          if (cfg.templateId) {
            const { data: tpl } = await supabase
              .from("lead_message_templates")
              .select("body, subject")
              .eq("id", String(cfg.templateId))
              .maybeSingle();
            if (tpl?.body) bodyTxt = tpl.body;
            if (tpl?.subject) subj = tpl.subject;
          }
          preview = `Subject: ${renderVars(subj, vars)}\n\n${renderVars(bodyTxt, vars)}`;
          break;
        }
        case "wait": {
          action = "Would wait";
          const d = cfg.duration as { value: number; unit: string } | undefined;
          const v = Number(d?.value ?? 1);
          const u = d?.unit ?? "hours";
          const mul = u === "minutes" ? 60_000 : u === "hours" ? 3_600_000 : 86_400_000;
          waitMs = v * mul;
          preview = `${v} ${u}`;
          break;
        }
        case "condition": {
          const expr = (cfg.expression as string) ?? "";
          const result = expr ? evalExpr(expr, lead as Record<string, unknown>, {}) : false;
          action = "Would evaluate condition";
          branch = result ? "true" : "false";
          preview = `${expr} → ${result}`;
          const kids = childrenOf(snapshot.steps, stepCursor.id, branch);
          if (kids.length > 0) advanceTo = kids[0];
          break;
        }
        case "stop":
          action = "Stop";
          preview = "End of run";
          advanceTo = null;
          break;
        case "move_stage":
          action = "Would move stage";
          preview = `${lead.stage} → ${cfg.to_stage}`;
          break;
        case "assign_staff":
          action = "Would assign staff";
          preview = String(cfg.rule ?? cfg.user_id ?? "round_robin");
          break;
        case "create_task":
          action = "Would create task";
          preview = renderVars((cfg.body as string) ?? "Follow up with this lead", vars);
          break;
        case "webhook":
          action = "Would call webhook";
          preview = `${cfg.method ?? "POST"} ${cfg.url}`;
          break;
        case "generate_doc":
          action = "Would generate document";
          preview = String(cfg.template_type ?? "agreement");
          break;
        default:
          action = "Unknown step type";
          preview = stepCursor.step_type;
      }

      timeline.push({ stepIndex: stepIndex++, stepType: stepCursor.step_type, action, preview, waitMs, branch });
      if (stepCursor.step_type === "stop") break;
      stepCursor = advanceTo;
    }

    return jsonResponse({ timeline });
  } catch (err) {
    console.error("automation-test-run error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
