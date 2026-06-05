/**
 * admin-toggle-lead-management — Spec Section 8 + 14.
 *
 * Flips tenant feature flags and seeds default templates on first enable.
 * Requires JWT and a head_admin / admin role on the calling user (RLS gates
 * the tenants table update — service_role here for atomic seed call).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  tenantId?: string;
  leadManagementEnabled?: boolean;
  automationsEnabled?: boolean;
  leadStaleThresholdHours?: number;
  leadAutoLostThresholdHours?: number;
  communicationTone?: "casual" | "friendly" | "professional";
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.tenantId) return errorResponse("tenantId is required");

    // Resolve calling user from JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseUserClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await supabaseUserClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Authorisation: user must be a tenant admin / head_admin / super_admin
    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);
    const isSuper = appUser.is_super_admin === true;
    const isTenantAdmin = appUser.tenant_id === body.tenantId && ["admin", "head_admin"].includes(appUser.role ?? "");
    if (!isSuper && !isTenantAdmin) {
      return errorResponse("Only tenant admins can change these settings", 403);
    }

    // Read previous flag to detect transition
    const { data: prevTenant } = await supabase
      .from("tenants")
      .select("id, lead_management_enabled")
      .eq("id", body.tenantId)
      .maybeSingle();
    if (!prevTenant) return errorResponse("Tenant not found", 404);
    const wasEnabled = prevTenant.lead_management_enabled === true;

    const update: Record<string, unknown> = {};
    if (body.leadManagementEnabled !== undefined) update.lead_management_enabled = body.leadManagementEnabled;
    if (body.automationsEnabled !== undefined) update.automations_enabled = body.automationsEnabled;
    if (body.leadStaleThresholdHours !== undefined) update.lead_stale_threshold_hours = body.leadStaleThresholdHours;
    if (body.leadAutoLostThresholdHours !== undefined) update.lead_auto_lost_threshold_hours = body.leadAutoLostThresholdHours;
    if (body.communicationTone !== undefined) update.communication_tone = body.communicationTone;

    if (Object.keys(update).length > 0) {
      const { error: updateErr } = await supabase.from("tenants").update(update).eq("id", body.tenantId);
      if (updateErr) {
        console.error("admin-toggle-lead-management update error:", updateErr);
        return errorResponse("Failed to save settings", 500);
      }
    }

    // Seed default templates on first enable
    if (body.leadManagementEnabled === true && !wasEnabled) {
      const { error: seedErr } = await supabase.rpc("seed_default_lead_templates", {
        p_tenant_id: body.tenantId,
      });
      if (seedErr) console.error("seed_default_lead_templates non-fatal:", seedErr);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("admin-toggle-lead-management error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
