/**
 * zoho-oauth-start — Sprint 5, Spec §6.
 *
 * Same shape as xero-oauth-start but with one extra wrinkle: Zoho's authorize
 * + token URLs are region-specific. The portal collects the region from the
 * operator via the ZohoRegionSelector modal and passes it as { region }.
 *
 * We persist the region on the oauth_state row so the callback (which is the
 * SAME callback URL regardless of region — Zoho redirects back to whichever
 * we passed) knows which data centre to hit when exchanging the code.
 *
 * The state nonce protects against CSRF + tenant-confusion the same way Xero's does.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { ZOHO, getRedirectUri } from "../_shared/accounting/oauth-constants.ts";

interface Payload {
  region?: string;       // 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'sa'
  redirectBack?: string;
}

const ALLOWED_REGIONS = new Set(["com", "eu", "in", "com.au", "jp", "sa"]);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const region = (body.region ?? "com").toLowerCase();
    if (!ALLOWED_REGIONS.has(region)) {
      return errorResponse(`Invalid region '${region}'. Must be one of: ${[...ALLOWED_REGIONS].join(", ")}`, 400);
    }

    // Resolve caller
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
    if (!appUser.is_super_admin && !["admin", "head_admin"].includes(appUser.role ?? "")) {
      return errorResponse("Only admin or head_admin can connect Zoho", 403);
    }

    // Persist nonce + the picked region so the callback can find the right data centre.
    const { data: stateRow, error: stateErr } = await supabase
      .from("accounting_oauth_state")
      .insert({
        tenant_id: tenantId,
        provider: "zoho",
        redirect_back: body.redirectBack ?? null,
        initiated_by: appUser.id,
        metadata: { region },
      })
      .select("nonce")
      .single();
    if (stateErr || !stateRow) {
      console.error("zoho-oauth-start: failed to persist oauth_state", stateErr);
      return errorResponse("Failed to initiate OAuth", 500);
    }

    const clientId = Deno.env.get("ZOHO_CLIENT_ID");
    if (!clientId) {
      return errorResponse("Zoho is not configured — ZOHO_CLIENT_ID missing on server", 500);
    }

    const redirectUri = getRedirectUri("zoho");
    const url = new URL(ZOHO.authorizeUrl(region));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", ZOHO.scopes);
    url.searchParams.set("access_type", "offline");      // mandatory for refresh tokens
    url.searchParams.set("prompt", "consent");           // force consent so we get a refresh_token even on re-auth
    url.searchParams.set("state", stateRow.nonce as string);

    return jsonResponse({ ok: true, authorizeUrl: url.toString(), region });
  } catch (err) {
    console.error("zoho-oauth-start error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
