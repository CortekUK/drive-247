/**
 * revenue-optimiser-toggle-mode — Spec §6 Journey A, Phase 1.
 *
 * Tenant admin / head_admin toggles Revenue Optimiser mode:
 *   - observation        (Insights mode, Phase 1)
 *   - recommendations    (Recommendations mode, Phase 2+)
 *   - autopilot          (Autopilot, Phase 3+)
 *   - disabled           (turn off entirely)
 *
 * Side effects on enable:
 *   - Upserts revenue_optimiser_settings row
 *   - Sets tenants.revenue_optimiser_enabled = true
 *   - Stamps calibration_started_at on FIRST enable (subsequent re-enables don't reset it)
 *
 * Auth: JWT — checks the caller is an admin/head_admin of the target tenant.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

type Mode = "observation" | "recommendations" | "autopilot" | "disabled";

interface Payload {
  mode?: Mode;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.mode || !["observation", "recommendations", "autopilot", "disabled"].includes(body.mode)) {
      return errorResponse("Invalid mode. Must be observation | recommendations | autopilot | disabled");
    }

    // Resolve caller from JWT
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

    // Caller must be an admin / head_admin (or super-admin)
    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);

    const isSuper = appUser.is_super_admin === true;
    const isTenantAdmin = ["admin", "head_admin"].includes(appUser.role ?? "");
    if (!isSuper && !isTenantAdmin) {
      return errorResponse("Only admin / head_admin can change Revenue Optimiser mode", 403);
    }
    if (!appUser.tenant_id && !isSuper) {
      return errorResponse("App user has no tenant assigned", 403);
    }

    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("Super-admin must specify a target tenant (V2)", 400);

    const wantEnabled = body.mode !== "disabled";

    // Upsert settings row. Only stamp calibration_started_at on the FIRST enable.
    const { data: existing } = await supabase
      .from("revenue_optimiser_settings")
      .select("tenant_id, calibration_started_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const updates: Record<string, unknown> = {
      enabled: wantEnabled,
      mode: wantEnabled ? body.mode : "observation",
    };
    // Stamp calibration only if never set — preserves the 30-day clock across
    // disable/re-enable cycles so operators can't game the calibration gate.
    if (wantEnabled && existing && !existing.calibration_started_at) {
      updates.calibration_started_at = new Date().toISOString();
    } else if (wantEnabled && !existing) {
      updates.calibration_started_at = new Date().toISOString();
    }

    if (existing) {
      const { error: updErr } = await supabase
        .from("revenue_optimiser_settings")
        .update(updates)
        .eq("tenant_id", tenantId);
      if (updErr) {
        console.error("settings update error:", updErr);
        return errorResponse(updErr.message ?? "Failed to update settings", 500);
      }
    } else {
      const { error: insErr } = await supabase
        .from("revenue_optimiser_settings")
        .insert({ tenant_id: tenantId, ...updates });
      if (insErr) {
        console.error("settings insert error:", insErr);
        return errorResponse(insErr.message ?? "Failed to create settings", 500);
      }
    }

    // Mirror the tenant-level flag so the sidebar / app-wide gating stays in sync
    await supabase
      .from("tenants")
      .update({ revenue_optimiser_enabled: wantEnabled })
      .eq("id", tenantId);

    // Read back
    const { data: settings } = await supabase
      .from("revenue_optimiser_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    return jsonResponse({ ok: true, settings });
  } catch (err) {
    console.error("revenue-optimiser-toggle-mode error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
