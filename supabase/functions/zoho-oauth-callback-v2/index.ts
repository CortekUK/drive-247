/**
 * zoho-oauth-callback-v2 — Zoho sends the operator back here after consent.
 * verify_jwt = false; trust comes from the single-use `state` nonce.
 *
 * Multi data centre: Zoho bounces the sign-in to whichever DC owns the account
 * and TELLS us which on the way back (`accounts-server`, `location`). The code
 * is only redeemable there, and the token response's `api_domain` is the API
 * base for that account — both are stored and used from then on; the region
 * the operator picked was only a hint for the first URL.
 */
import { redirectUri, ZOHO, zohoAccountsServer, zohoRegionFromAccountsServer } from "../_shared/accounting-v2/config.ts";
import { serviceClient } from "../_shared/accounting-v2/caller.ts";
import { finalizeOrg, saveGrant } from "../_shared/accounting-v2/connect.ts";
import { requestToken } from "../_shared/accounting-v2/tokens.ts";

const LOCATION_TO_REGION: Record<string, string> = { us: "com", eu: "eu", in: "in", au: "com.au", jp: "jp", sa: "sa", ca: "ca" };

const plain = (msg: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Zoho Books</title><p style="font-family:sans-serif">${msg}</p>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8" },
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const db = serviceClient();
  const nonce = url.searchParams.get("state");
  if (!nonce || !/^[0-9a-f-]{36}$/i.test(nonce)) return plain("This sign-in link is not valid. Start again from Integrations.");

  const { data: state } = await db.from("accounting_v2_oauth_state").delete().eq("nonce", nonce).eq("provider", "zoho")
    .select("tenant_id, redirect_back, initiated_by, expires_at, region").maybeSingle();
  if (!state) return plain("This sign-in link has already been used. Start again from Integrations.");

  const back = (status: string, reason?: string) => {
    const u = new URL(state.redirect_back as string);
    u.searchParams.set("accounting", status);
    u.searchParams.set("provider", "zoho");
    if (reason) u.searchParams.set("reason", reason);
    return Response.redirect(u.toString(), 302);
  };

  try {
    if (new Date(state.expires_at as string).getTime() < Date.now()) return back("error", "state_expired");
    const providerError = url.searchParams.get("error");
    if (providerError) return back("error", providerError);
    const code = url.searchParams.get("code");
    if (!code) return back("error", "missing_params");

    const serverParam = url.searchParams.get("accounts-server");
    const location = (url.searchParams.get("location") ?? "").toLowerCase();
    const region = zohoRegionFromAccountsServer(serverParam) ?? LOCATION_TO_REGION[location] ?? (state.region as string) ?? "com";
    const accountsServer = (serverParam ?? zohoAccountsServer(region)).replace(/\/+$/, "");

    const tokens = await requestToken({ provider: "zoho", accounts_server: accountsServer, region }, {
      grant_type: "authorization_code", code, redirect_uri: redirectUri("zoho"),
    });
    if (!tokens.refresh_token) return back("error", "no_refresh_token");
    const apiDomain = ((tokens as any).api_domain as string | undefined)
      ?? (region === "ca" ? "https://www.zohoapis.ca" : `https://www.zohoapis.${region}`);

    const res = await fetch(`${apiDomain}/books/v3/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}`, Accept: "application/json" },
    });
    const json = await res.json().catch(() => null) as { code?: number; organizations?: Array<{ organization_id: string; name: string }> } | null;
    if (!res.ok || !json || (typeof json.code === "number" && json.code !== 0)) return back("error", "organisations_lookup_failed");
    const orgs = (json.organizations ?? []).map((o) => ({ id: o.organization_id, name: o.name }));
    if (orgs.length === 0) return back("error", "no_organisations");

    const connectionId = await saveGrant(db, {
      tenantId: state.tenant_id as string, provider: "zoho", tokens, userId: (state.initiated_by as string) ?? null,
      scopes: ZOHO.scopes, region, apiDomain, accountsServer, orgs,
    });
    if (orgs.length > 1) return back("choose");
    await finalizeOrg(db, connectionId, orgs[0]);
    return back("connected");
  } catch (e) {
    console.error("zoho-oauth-callback-v2:", e);
    return back("error", e instanceof Error && /Token request rejected/.test(e.message) ? "token_exchange_failed" : "persist_failed");
  }
});
