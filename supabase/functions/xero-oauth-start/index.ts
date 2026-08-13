/**
 * xero-oauth-start — Spec §6.
 *
 * Portal "Connect Xero" button calls this. We:
 *   1. Resolve the caller via JWT → find their tenant + role
 *   2. Verify they're admin / head_admin / super_admin
 *   3. Persist a short-lived (10 min) accounting_oauth_state row keyed by a
 *      fresh UUID nonce; the OAuth `state` query param is just the nonce
 *   4. Return the Xero authorize URL — client navigates window.location.href
 *
 * Why a nonce instead of passing tenant_id in state directly:
 *  - We never trust the redirect to carry tenant_id (spec §6.2).
 *  - CSRF protection: state must be unguessable.
 *  - Confused-deputy protection: callback validates the nonce came from us.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { XERO, getRedirectUri } from "../_shared/accounting/oauth-constants.ts";

interface Payload {
  redirectBack?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = req.headers.get("content-length") === "0" ? {} : ((await req.json().catch(() => ({}))) as Payload);

    // Resolve caller via their JWT
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

    const tenantId = appUser.tenant_id;
    if (!tenantId && !appUser.is_super_admin) {
      return errorResponse("No tenant context", 403);
    }
    const isAdmin = ["admin", "head_admin"].includes(appUser.role ?? "");
    if (!appUser.is_super_admin && !isAdmin) {
      return errorResponse("Only admin or head_admin can connect Xero", 403);
    }

    // Persist nonce
    const { data: stateRow, error: stateErr } = await supabase
      .from("accounting_oauth_state")
      .insert({
        tenant_id: tenantId,
        provider: "xero",
        redirect_back: body.redirectBack ?? null,
        initiated_by: appUser.id,
      })
      .select("nonce")
      .single();
    if (stateErr || !stateRow) {
      console.error("xero-oauth-start: failed to persist oauth_state", stateErr);
      return errorResponse("Failed to initiate OAuth", 500);
    }

    const clientId = Deno.env.get("XERO_CLIENT_ID");
    if (!clientId) {
      return errorResponse("Xero is not configured — XERO_CLIENT_ID missing on server", 500);
    }

    const redirectUri = getRedirectUri("xero");
    // Xero's identity server strictly requires RFC 3986 percent-encoding for
    // the `scope` query param — spaces MUST be %20, not + (which is what
    // URLSearchParams.set produces). Building the query string manually
    // sidesteps that gotcha. Other params are safe via URLSearchParams.
    const queryParams: Array<[string, string]> = [
      ["response_type", "code"],
      ["client_id", clientId],
      ["redirect_uri", redirectUri],
      ["scope", XERO.scopes],
      ["state", stateRow.nonce as string],
    ];
    const query = queryParams
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const authorizeUrl = `${XERO.authorizeUrl}?${query}`;

    return jsonResponse({ ok: true, authorizeUrl });
  } catch (err) {
    console.error("xero-oauth-start error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
