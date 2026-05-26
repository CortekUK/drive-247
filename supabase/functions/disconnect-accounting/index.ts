/**
 * disconnect-accounting — Spec §6 (disconnect path).
 *
 * Operator clicks "Disconnect" on Settings → Accounting. We:
 *   1. Validate caller is admin/head_admin/super-admin
 *   2. Call accounting_clear_tokens() — deletes vault secrets, marks
 *      accounting_connections.status = 'revoked'
 *   3. Flip tenants.integration_<provider> = FALSE
 *
 * No further syncs run for this tenant+provider until they reconnect. Pending
 * financial_event_sync_state rows are left alone — they'll re-sync if the
 * tenant reconnects the same provider, or stay 'pending' indefinitely until
 * the operator marks them 'skipped' from the failed-row UI.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  provider?: "xero" | "zoho";
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    if (!body.provider || !["xero", "zoho"].includes(body.provider)) {
      return errorResponse("provider is required ('xero' or 'zoho')", 400);
    }
    const provider = body.provider;

    // Resolve caller via JWT
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

    const isAdmin = ["admin", "head_admin"].includes(appUser.role ?? "");
    if (!appUser.is_super_admin && !isAdmin) {
      return errorResponse("Only admin or head_admin can disconnect", 403);
    }
    const tenantId = appUser.tenant_id;
    if (!tenantId) return errorResponse("No tenant context", 403);

    // Wipe vault secrets + flip status to 'revoked'
    const { error: clearErr } = await supabase.rpc("accounting_clear_tokens", {
      p_tenant_id: tenantId,
      p_provider: provider,
      p_new_status: "revoked",
    });
    if (clearErr) {
      console.error("disconnect-accounting: clear_tokens failed", clearErr);
      return errorResponse(clearErr.message ?? "Failed to disconnect", 500);
    }

    // Flip the per-provider tenant flag
    const flagColumn = provider === "xero" ? "integration_xero" : "integration_zoho_books";
    await supabase
      .from("tenants")
      .update({ [flagColumn]: false })
      .eq("id", tenantId);

    return jsonResponse({ ok: true, provider, tenant_id: tenantId });
  } catch (err) {
    console.error("disconnect-accounting error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
