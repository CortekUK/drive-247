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
import { resolveTenantId } from "../_shared/resolve-tenant.ts";
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

    // Resolve the acting tenant. Scoped users are pinned to their own tenant;
    // only super admins (tenant_id = NULL by design) may name one, via the
    // tenantSlug body field or the x-tenant-slug header. See resolve-tenant.ts.
    const tenantResolution = await resolveTenantId(
      supabase, req, appUser,
      (typeof body === "object" && body !== null ? (body as { tenantSlug?: string }).tenantSlug : null) ?? null,
      (typeof body === "object" && body !== null ? (body as { redirectBack?: string }).redirectBack : null) ?? null,
    );
    if (!tenantResolution.tenantId) {
      return errorResponse(tenantResolution.errorMessage ?? "No tenant context", tenantResolution.errorStatus);
    }
    const tenantId = tenantResolution.tenantId;
    const isAdmin = ["admin", "head_admin"].includes(appUser.role ?? "");
    if (!appUser.is_super_admin && !isAdmin) {
      return errorResponse("Only admin or head_admin can connect Xero", 403);
    }

    // Check server configuration BEFORE writing anything — see the matching
    // comment in zoho-oauth-start. Persisting a nonce we already know cannot be
    // redeemed just leaves an orphan row behind on every failed click.
    //
    // The secret is checked here too even though only the callback uses it: a
    // half-configured server would otherwise pass this step, redirect the
    // operator all the way to Xero, and only fail on the way back.
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
    const missing = [
      !clientId ? "XERO_CLIENT_ID" : null,
      !clientSecret ? "XERO_CLIENT_SECRET" : null,
    ].filter(Boolean);
    if (missing.length > 0) {
      return errorResponse(
        `Xero is not configured on the server yet — ${missing.join(" and ")} ` +
        `${missing.length > 1 ? "are" : "is"} missing.`,
        503,
      );
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
