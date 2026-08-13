/**
 * zoho-oauth-callback — Sprint 5, Spec §6.
 *
 * Zoho redirects to this URL after the operator clicks "Allow access". Same
 * shape as xero-oauth-callback with three differences:
 *   1. The region was persisted on accounting_oauth_state.metadata.region
 *      by zoho-oauth-start — we read it back here.
 *   2. The token endpoint is region-specific.
 *   3. Org discovery is a separate API call (Zoho doesn't include the org
 *      in the token response). We pick the FIRST org returned and log a
 *      warning if the user has multiple — the org-picker UI is a V2 follow-up.
 *
 * Also runs with verify_jwt=false (set in supabase/config.toml) because Zoho
 * redirects without our session JWT. State nonce validates authenticity.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, errorResponse } from "../_shared/cors.ts";
import { ZOHO, getRedirectUri } from "../_shared/accounting/oauth-constants.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  const location = url.searchParams.get("location"); // Zoho echoes this back

  if (providerError) {
    return redirect(`/settings?tab=accounting&status=error&provider=zoho&reason=${encodeURIComponent(providerError)}`);
  }
  if (!code || !state) {
    return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=missing_params");
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. Validate nonce
    const { data: stateRow } = await supabase
      .from("accounting_oauth_state")
      .select("tenant_id, provider, redirect_back, initiated_by, expires_at, metadata")
      .eq("nonce", state)
      .maybeSingle();
    if (!stateRow) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=invalid_state");
    }
    if (stateRow.provider !== "zoho") {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=state_provider_mismatch");
    }
    if (new Date(stateRow.expires_at).getTime() < Date.now()) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=state_expired");
    }

    // The region the user picked at start time. Zoho also passes `location`
    // back on the redirect — if those disagree, trust ours (the user's pick).
    const meta = (stateRow.metadata as { region?: string } | null) ?? null;
    const region = meta?.region ?? location ?? "com";

    // 2. Exchange code for tokens — region-specific endpoint
    const clientId = Deno.env.get("ZOHO_CLIENT_ID");
    const clientSecret = Deno.env.get("ZOHO_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=server_misconfigured");
    }
    const redirectUri = getRedirectUri("zoho");

    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
    const tokenRes = await fetch(ZOHO.tokenUrl(region), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "unknown");
      console.error("zoho-oauth-callback: token exchange failed", tokenRes.status, errText);
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=token_exchange_failed");
    }
    const tokenJson = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      api_domain?: string;
      token_type?: string;
    };
    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    if (!accessToken) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=no_access_token");
    }
    if (!refreshToken) {
      // Likely the user already authorised this app before and we forgot to
      // pass prompt=consent. The start fn DOES pass prompt=consent so this
      // should be rare — surface it loudly if it happens.
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=no_refresh_token");
    }
    const expiresAt = new Date(Date.now() + (tokenJson.expires_in - 30) * 1000).toISOString();

    // 3. Fetch the user's Zoho organisations
    const orgRes = await fetch(`${ZOHO.organizationsUrl(region)}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, Accept: "application/json" },
    });
    if (!orgRes.ok) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=organisations_lookup_failed");
    }
    const orgJson = await orgRes.json() as {
      code: number;
      organizations?: Array<{ organization_id: string; name: string; country_code?: string }>;
    };
    const orgs = orgJson.organizations ?? [];
    if (orgs.length === 0) {
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=no_organisations");
    }
    if (orgs.length > 1) {
      // V1 limitation per master plan: pick the first one. V2 will surface
      // an org-picker UI. Logged so we know when this triggers.
      console.warn(`zoho-oauth-callback: user has ${orgs.length} orgs, picking first one (${orgs[0].organization_id})`);
    }
    const zohoOrg = orgs[0];

    // 4. Store tokens in Vault + create the connection row
    const { error: storeErr } = await supabase.rpc("accounting_store_tokens", {
      p_tenant_id: stateRow.tenant_id,
      p_provider: "zoho",
      p_access_token: accessToken,
      p_refresh_token: refreshToken,
      p_expires_at: expiresAt,
      p_external_org_id: zohoOrg.organization_id,
      p_external_org_name: zohoOrg.name,
      p_external_region: region,
      p_connected_by: stateRow.initiated_by ?? null,
    });
    if (storeErr) {
      console.error("zoho-oauth-callback: store_tokens failed", storeErr);
      return redirect("/settings?tab=accounting&status=error&provider=zoho&reason=persist_failed");
    }

    // 5. Flip tenant flag
    await supabase
      .from("tenants")
      .update({ integration_zoho_books: true })
      .eq("id", stateRow.tenant_id);

    // 6. Seed default mappings (Sprint 3 helper) — operator lands on a pre-filled
    // mapping screen. Idempotent: if mappings already exist, nothing happens.
    try {
      await supabase.rpc("seed_default_accounting_mappings", {
        p_tenant_id: stateRow.tenant_id,
        p_provider: "zoho",
      });
    } catch (err) {
      console.warn("zoho-oauth-callback: seed_default_accounting_mappings failed (non-fatal):", err);
    }

    // 7. Consume the nonce
    await supabase.from("accounting_oauth_state").delete().eq("nonce", state);

    // 8. Redirect back to portal
    const target = stateRow.redirect_back
      ?? "/settings?tab=accounting&status=success&provider=zoho";
    return redirect(target);
  } catch (err) {
    console.error("zoho-oauth-callback error:", err);
    return redirect(`/settings?tab=accounting&status=error&provider=zoho&reason=${encodeURIComponent(err instanceof Error ? err.message : "unknown")}`);
  }
});

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
