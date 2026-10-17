/**
 * xero-oauth-callback-v2 — Xero sends the operator back here after consent.
 * verify_jwt = false: Xero's redirect carries no JWT. Trust comes from the
 * single-use `state` nonce minted by `accounting-v2` (start), which binds the
 * redirect to one tenant and expires after 30 minutes.
 *
 * Unlike v1's callback, EVERY outcome — success or failure — returns to the
 * page the operator started from (`?accounting=…&provider=xero`), so a failure
 * is never lost on a hidden Settings tab.
 *
 * After consent: GET /connections lists the organisations the operator
 * authorised. One → connected now. Several → `pending_org`, and the portal
 * shows the picker.
 */
import { XERO, redirectUri } from "../_shared/accounting-v2/config.ts";
import { serviceClient } from "../_shared/accounting-v2/caller.ts";
import { finalizeOrg, OrgTakenError, saveGrant, takenOrgIds } from "../_shared/accounting-v2/connect.ts";
import { requestToken } from "../_shared/accounting-v2/tokens.ts";

const plain = (msg: string, status = 400) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>Xero</title><p style="font-family:sans-serif">${msg}</p>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8" },
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const db = serviceClient();
  const nonce = url.searchParams.get("state");
  if (!nonce || !/^[0-9a-f-]{36}$/i.test(nonce)) return plain("This sign-in link is not valid. Start again from Integrations.");

  // Single use: deleted as it is read.
  const { data: state } = await db.from("accounting_v2_oauth_state").delete().eq("nonce", nonce).eq("provider", "xero")
    .select("tenant_id, redirect_back, initiated_by, expires_at").maybeSingle();
  if (!state) return plain("This sign-in link has already been used. Start again from Integrations.");

  const back = (status: string, reason?: string) => {
    const u = new URL(state.redirect_back as string);
    u.searchParams.set("accounting", status);
    u.searchParams.set("provider", "xero");
    if (reason) u.searchParams.set("reason", reason);
    return Response.redirect(u.toString(), 302);
  };

  try {
    if (new Date(state.expires_at as string).getTime() < Date.now()) return back("error", "state_expired");
    const providerError = url.searchParams.get("error");
    if (providerError) return back("error", providerError === "access_denied" ? "access_denied" : providerError);
    const code = url.searchParams.get("code");
    if (!code) return back("error", "missing_params");

    const tokens = await requestToken({ provider: "xero", accounts_server: null, region: null }, {
      grant_type: "authorization_code", code, redirect_uri: redirectUri("xero"),
    });
    if (!tokens.refresh_token) return back("error", "no_refresh_token");

    const res = await fetch(XERO.connectionsUrl, { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" } });
    if (!res.ok) return back("error", "organisations_lookup_failed");
    const conns = (await res.json()) as Array<{ id: string; tenantId: string; tenantName: string; tenantType: string }>;
    const orgs = conns.filter((c) => c.tenantType === "ORGANISATION")
      .map((c) => ({ id: c.tenantId, name: c.tenantName, connection_id: c.id }));
    if (orgs.length === 0) return back("error", "no_organisations");
    // Books already connected to another company are not offered. If that
    // leaves nothing, this tenant's existing connection is left untouched.
    const taken = await takenOrgIds(db, "xero", state.tenant_id as string, orgs.map((o) => o.id));
    const free = orgs.filter((o) => !taken.has(o.id));
    if (free.length === 0) return back("error", "org_taken");

    const connectionId = await saveGrant(db, {
      tenantId: state.tenant_id as string, provider: "xero", tokens, userId: (state.initiated_by as string) ?? null,
      scopes: XERO.scopes, orgs: free,
    });
    if (orgs.length > 1) return back("choose");
    await finalizeOrg(db, connectionId, free[0]);
    return back("connected");
  } catch (e) {
    if (e instanceof OrgTakenError) return back("error", "org_taken");
    console.error("xero-oauth-callback-v2:", e);
    return back("error", e instanceof Error && /Token request rejected/.test(e.message) ? "token_exchange_failed" : "persist_failed");
  }
});
