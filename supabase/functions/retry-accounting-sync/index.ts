/**
 * retry-accounting-sync — Spec §14.
 *
 * Operator clicks "Retry" on a failed row in the sync log. We flip the
 * sync_state row back to 'pending' so the next cron tick of
 * process-accounting-sync picks it up immediately. attempts counter is
 * preserved (so we don't loop forever on a still-broken row).
 *
 * Supports two modes:
 *   - { syncStateId } — retry one specific row
 *   - { allFailed: true } — retry every 'failed' row for this tenant (bulk)
 *
 * Bulk path is admin-only; single-row retry requires the same.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  syncStateId?: string;
  allFailed?: boolean;
  /** Optional second mode: mark a row as 'skipped' (do-not-sync). */
  skip?: boolean;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    if (!body.syncStateId && !body.allFailed) {
      return errorResponse("either syncStateId or allFailed=true is required", 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return errorResponse("Unauthorised", 401);

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
    if (!appUser.is_super_admin && !["admin", "head_admin"].includes(appUser.role ?? "")) {
      return errorResponse("Only admin or head_admin can retry syncs", 403);
    }
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    const newState = body.skip ? "skipped" : "pending";

    if (body.syncStateId) {
      const { data: existing } = await supabase
        .from("financial_event_sync_state")
        .select("id, tenant_id, state")
        .eq("id", body.syncStateId)
        .maybeSingle();
      if (!existing) return errorResponse("Sync row not found", 404);
      if (!appUser.is_super_admin && existing.tenant_id !== tenantId) {
        return errorResponse("Not your tenant's sync row", 403);
      }
      if (existing.state === "synced") {
        return errorResponse("Cannot retry a synced row", 409);
      }
      const { error } = await supabase
        .from("financial_event_sync_state")
        .update({
          state: newState,
          next_attempt_at: null,
          last_error: body.skip ? "Marked skipped by operator" : null,
          last_error_code: body.skip ? "SKIPPED" : null,
        })
        .eq("id", body.syncStateId);
      if (error) return errorResponse(error.message, 500);
      return jsonResponse({ ok: true, reset: 1, newState });
    }

    // Bulk: reset all failed rows for this tenant
    const { count, error } = await supabase
      .from("financial_event_sync_state")
      .update({
        state: "pending",
        next_attempt_at: null,
        last_error: null,
        last_error_code: null,
      }, { count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("state", "failed");
    if (error) return errorResponse(error.message, 500);
    return jsonResponse({ ok: true, reset: count ?? 0, newState: "pending" });
  } catch (err) {
    console.error("retry-accounting-sync error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
