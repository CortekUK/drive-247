/**
 * automation-publish — Spec Section 7.4.
 *
 * Snapshots the current draft into automations.published_snapshot and
 * increments version. Edits after publish go back to draft and the old
 * snapshot keeps powering in-flight runs.
 *
 * Authorisation: spec §13 — only admin / head_admin / super_admin can publish.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  automationId?: string;
}

interface StepRow {
  id: string;
  automation_id: string;
  parent_step_id: string | null;
  order_index: number;
  step_type: "sms" | "email" | "wait" | "condition" | "stop";
  config: Record<string, unknown>;
  branch: "true" | "false" | null;
}

function validate(steps: StepRow[]): string | null {
  if (steps.length === 0) return "Automation must have at least one step";
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    if (s.parent_step_id && !ids.has(s.parent_step_id)) {
      return `Orphan step (missing parent): ${s.id}`;
    }
    if (s.step_type === "condition") {
      const tBranch = steps.find((c) => c.parent_step_id === s.id && c.branch === "true");
      const fBranch = steps.find((c) => c.parent_step_id === s.id && c.branch === "false");
      if (!tBranch || !fBranch) {
        return "Condition must have both true and false branches";
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.automationId) return errorResponse("automationId is required");

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);

    const { data: automation } = await supabase
      .from("automations")
      .select("id, tenant_id, version, status, trigger_type, trigger_config")
      .eq("id", body.automationId)
      .maybeSingle();
    if (!automation) return errorResponse("Automation not found", 404);

    const isSuper = appUser.is_super_admin === true;
    const isTenantAdmin = appUser.tenant_id === automation.tenant_id && ["admin", "head_admin"].includes(appUser.role ?? "");
    if (!isSuper && !isTenantAdmin) {
      return errorResponse("Only admin / head_admin can publish automations", 403);
    }

    const { data: steps } = await supabase
      .from("automation_steps")
      .select("id, automation_id, parent_step_id, order_index, step_type, config, branch")
      .eq("automation_id", automation.id);

    const stepRows = (steps ?? []) as StepRow[];
    const errMsg = validate(stepRows);
    if (errMsg) return errorResponse(errMsg, 400);

    const snapshot = {
      trigger_type: automation.trigger_type,
      trigger_config: automation.trigger_config,
      steps: stepRows,
    };

    const newVersion = automation.status === "published" ? automation.version + 1 : Math.max(1, automation.version || 1);

    const { error } = await supabase
      .from("automations")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        published_snapshot: snapshot,
        version: newVersion,
        updated_by: appUser.id,
      })
      .eq("id", automation.id);
    if (error) {
      console.error("automation-publish update error:", error);
      return errorResponse("Failed to publish", 500);
    }

    return jsonResponse({ ok: true, version: newVersion });
  } catch (err) {
    console.error("automation-publish error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
