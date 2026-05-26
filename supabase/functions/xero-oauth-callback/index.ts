/**
 * xero-oauth-callback — Spec §6.
 *
 * Xero redirects the user here after they click "Allow access". This fn:
 *   1. Validates the `state` query param against the accounting_oauth_state nonce
 *   2. Exchanges code → access_token + refresh_token via Xero's token endpoint
 *   3. Calls GET /connections to fetch the user's tenantId + org name
 *   4. Persists tokens in Vault via accounting_store_tokens()
 *   5. Flips tenants.integration_xero = TRUE
 *   6. Redirects back to /settings?tab=accounting&status=success&provider=xero
 *
 * NOTE: this fn runs with verify_jwt = false (set in supabase/config.toml)
 * because Xero redirects without our session JWT. The state nonce is what
 * authenticates the round-trip.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, errorResponse } from "../_shared/cors.ts";
import { XERO, getRedirectUri } from "../_shared/accounting/oauth-constants.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    return redirect(`/settings?tab=accounting&status=error&provider=xero&reason=${encodeURIComponent(providerError)}`);
  }
  if (!code || !state) {
    return redirect("/settings?tab=accounting&status=error&provider=xero&reason=missing_params");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. Validate nonce
    const { data: stateRow } = await supabase
      .from("accounting_oauth_state")
      .select("tenant_id, provider, redirect_back, initiated_by, expires_at")
      .eq("nonce", state)
      .maybeSingle();
    if (!stateRow) {
      return redirect("/settings?tab=accounting&status=error&provider=xero&reason=invalid_state");
    }
    if (stateRow.provider !== "xero") {
      return redirect("/settings?tab=accounting&status=error&provider=xero&reason=state_provider_mismatch");
    }
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      return redirect("/settings?tab=accounting&status=error&provider=xero&reason=state_expired");
    }

    // 2. Exchange code for tokens
    const clientId = Deno.env.get("XERO_CLIENT_ID");
    const clientSecret = Deno.env.get("XERO_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return redirect("/settings?tab=accounting&status=error&provider=xero&reason=server_misconfigured");
    }
    const redirectUri = getRedirectUri("xero");
    const tokenForm = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    const basicAuth = btoa(`${clientId}:${clientSecret}`);

    const tokenRes = await fetch(XERO.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenForm.toString(),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "unknown");
      console.error("xero-oauth-callback: token exchange failed", tokenRes.status, errText);
      return redirect(`/settings?tab=accounting&status=error&provider=xero&reason=token_exchange_failed`);
    }
    const tokenJson = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;       // seconds
      token_type: string;
      scope: string;
    };
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    const expiresAt = new Date(Date.now() + (tokenJson.expires_in - 30) * 1000).toISOString();

    // 3. Fetch Xero connections list — gives us the tenantId + org name
    const connRes = await fetch(XERO.connectionsUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!connRes.ok) {
      return redirect("/settings?tab=accounting&status=error&provider=xero&reason=connections_lookup_failed");
    }
    const connList = await connRes.json() as Array<{
      id: string;
      authEventId: string;
      tenantId: string;
      tenantType: string;
      tenantName: string;
      createdDateUtc: string;
      updatedDateUtc: string;
    }>;
    if (!Array.isArray(connList) || connList.length === 0) {
      return redirect("/settings?tab=accounting&status=error&provider=xero&reason=no_organisations");
    }
    // V1: pick the first connection. V2: org picker UI.
    const xeroOrg = connList[0];

    // 4. Persist tokens in Vault + connection row
    const { error: storeErr } = await supabase.rpc("accounting_store_tokens", {
      p_tenant_id: stateRow.tenant_id,
      p_provider: "xero",
      p_access_token: accessToken,
      p_refresh_token: refreshToken,
      p_expires_at: expiresAt,
      p_external_org_id: xeroOrg.tenantId,
      p_external_org_name: xeroOrg.tenantName,
      p_external_region: null,
      p_connected_by: stateRow.initiated_by ?? null,
    });
    if (storeErr) {
      console.error("xero-oauth-callback: store_tokens failed", storeErr);
      return redirect("/settings?tab=accounting&status=error&provider=xero&reason=persist_failed");
    }

    // 5. Flip tenant flag
    await supabase
      .from("tenants")
      .update({ integration_xero: true })
      .eq("id", stateRow.tenant_id);

    // 5b. Seed default per-event-type mappings per spec §13.2 — operator
    // arrives on the mapping screen with sensible defaults already chosen.
    // Idempotent: if mappings already exist, nothing inserted.
    try {
      await supabase.rpc("seed_default_accounting_mappings", {
        p_tenant_id: stateRow.tenant_id,
        p_provider: "xero",
      });
    } catch (err) {
      console.warn("xero-oauth-callback: seed_default_accounting_mappings failed (non-fatal):", err);
    }

    // 6. Consume the nonce
    await supabase.from("accounting_oauth_state").delete().eq("nonce", state);

    // 7. Redirect back to the portal
    const target = stateRow.redirect_back
      ?? "/settings?tab=accounting&status=success&provider=xero";
    return redirect(target);
  } catch (err) {
    console.error("xero-oauth-callback error:", err);
    return redirect(`/settings?tab=accounting&status=error&provider=xero&reason=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`);
  }
});

/**
 * Defense-in-depth: if a caller forgot to set redirect_back, fall back to
 * PORTAL_BASE_URL so we never emit a relative path that the browser would
 * resolve against the Supabase function host (yields "requested path is
 * invalid").
 */
function redirect(location: string): Response {
  let resolved = location;
  if (resolved.startsWith("/")) {
    const portalBase = (Deno.env.get("PORTAL_BASE_URL") ?? "").replace(/\/$/, "");
    if (portalBase) {
      resolved = `${portalBase}${location}`;
    }
  }
  return new Response(null, {
    status: 302,
    headers: { Location: resolved },
  });
}
