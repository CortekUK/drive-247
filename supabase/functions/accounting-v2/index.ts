/**
 * accounting-v2 — the portal's one endpoint for Xero / Zoho Books (v2).
 *
 * POST { action, provider, tenantSlug?, ... } with the operator's JWT.
 *
 *   start          → { authorizeUrl }   begin OAuth (admin)
 *   select_org     { orgId }            pick one of several authorised organisations (admin)
 *   test                                a real lightweight call: Xero Organisation / Zoho organization
 *   options                             chart of accounts + tax rates + the mapping in force
 *   save_settings  { settings }         the account mapping (admin)
 *   disconnect                          revoke at the provider, clear Vault, stop syncing (admin)
 *   retry_failed                        re-queue this provider's failed items now (admin)
 *   backfill       { from }             also sync past transactions from a date (admin)
 *   sync_now                            send this tenant's due items now (admin)
 *
 * Reads (connection status, the Sync table, drawer icons) go straight from the
 * portal to the tables under RLS; nothing here returns a token.
 */
import { errorResponse, handleCors, jsonResponse } from "../_shared/cors.ts";
import { resolveCaller } from "../_shared/accounting-v2/caller.ts";
import {
  clientCreds, isAllowedRedirect, type Provider, redirectUri, XERO, ZOHO, zohoAccountsServer, ZOHO_REGIONS,
} from "../_shared/accounting-v2/config.ts";
import { finalizeOrg, OrgTakenError, OtherProviderError, otherProviderLive, type OrgChoice } from "../_shared/accounting-v2/connect.ts";
import { pickDefaults, resolveSettings } from "../_shared/accounting-v2/engine.ts";
import { buildAdapter, CONNECTION_COLUMNS, processItems } from "../_shared/accounting-v2/runner.ts";
import type { AccountSettings, Connection } from "../_shared/accounting-v2/types.ts";
import { ProviderError } from "../_shared/accounting-v2/types.ts";

const ADMIN_ONLY = new Set(["start", "select_org", "save_settings", "disconnect", "retry_failed", "backfill", "sync_now"]);
const SETTING_KEYS = ["card_account", "manual_account", "sales_account", "deposit_account", "tax_account"] as const;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const action = String(body.action ?? "");
  const provider = body.provider as Provider;
  if (provider !== "xero" && provider !== "zoho") return errorResponse("provider must be xero or zoho", 400);

  const caller = await resolveCaller(req, body);
  if ("error" in caller) return errorResponse(caller.error, caller.status);
  const { db, tenantId } = caller;
  if (ADMIN_ONLY.has(action) && !caller.canManage) {
    return errorResponse("Only an admin or head admin can change the accounting connection.", 403);
  }
  const name = provider === "xero" ? "Xero" : "Zoho Books";

  try {
    if (action === "start") {
      const other = await otherProviderLive(db, tenantId, provider);
      if (other) return errorResponse(new OtherProviderError(other).message, 409);
      const creds = clientCreds(provider);
      if (!creds) return errorResponse(`${name} is not configured on the server yet (client id / secret missing).`, 503);
      const { data: tenant } = await db.from("tenants").select("custom_portal_domain").eq("id", tenantId).maybeSingle();
      const redirectBack = String(body.redirectBack ?? "");
      if (!isAllowedRedirect(redirectBack, (tenant?.custom_portal_domain as string) ?? null)) {
        return errorResponse("That return address is not one of this portal's.", 400);
      }
      const region = provider === "zoho" ? String(body.region ?? "com") : null;
      if (region && !(ZOHO_REGIONS as readonly string[]).includes(region)) return errorResponse("Unknown Zoho data centre.", 400);

      const { data: state, error } = await db.from("accounting_v2_oauth_state").insert({
        tenant_id: tenantId, provider, region, redirect_back: redirectBack, initiated_by: caller.appUserId,
      }).select("nonce").single();
      if (error || !state) return errorResponse("Could not start the connection.", 500);

      // Spaces in `scope` must be %20, not + (Xero rejects +), so build by hand.
      const params: [string, string][] = provider === "xero"
        ? [["response_type", "code"], ["client_id", creds.id], ["redirect_uri", redirectUri("xero")], ["scope", XERO.scopes], ["state", state.nonce]]
        : [["response_type", "code"], ["client_id", creds.id], ["redirect_uri", redirectUri("zoho")], ["scope", ZOHO.scopes],
           ["access_type", "offline"], ["prompt", "consent"], ["state", state.nonce]];
      const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      const base = provider === "xero" ? XERO.authorizeUrl : `${zohoAccountsServer(region!)}/oauth/v2/auth`;
      return jsonResponse({ authorizeUrl: `${base}?${qs}` });
    }

    const { data: connRow } = await db.from("accounting_v2_connections")
      .select(CONNECTION_COLUMNS + ", available_orgs").eq("tenant_id", tenantId).eq("provider", provider).maybeSingle();
    const conn = connRow as unknown as (Connection & { available_orgs: OrgChoice[] | null }) | null;
    if (!conn) return errorResponse(`${name} is not connected.`, 404);

    if (action === "select_org") {
      if (conn.status !== "pending_org") return errorResponse("There is no organisation choice waiting.", 409);
      const org = (conn.available_orgs ?? []).find((o) => o.id === body.orgId);
      if (!org) return errorResponse("That organisation was not one you authorised.", 400);
      try {
        await finalizeOrg(db, conn.id, org);
      } catch (e) {
        if (e instanceof OrgTakenError || e instanceof OtherProviderError) return errorResponse(e.message, 409);
        throw e;
      }
      return jsonResponse({ ok: true });
    }

    if (action === "disconnect") {
      const { data: tok } = await db.rpc("accounting_v2_get_tokens", { p_connection_id: conn.id });
      const refresh = (tok as any[])?.[0]?.refresh_token ?? null;
      const access = (tok as any[])?.[0]?.access_token ?? null;
      try {
        if (provider === "xero" && conn.external_connection_id && access) {
          await fetch(`https://api.xero.com/connections/${conn.external_connection_id}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${access}` },
          }).catch(() => undefined);
        }
        if (conn.external_org_id) await buildAdapter(db, conn).revoke(refresh);
      } catch (e) {
        console.warn("accounting-v2 disconnect: revoke failed (continuing)", e);
      }
      await db.rpc("accounting_v2_clear_tokens", { p_connection_id: conn.id });
      // History stays: items, entity map, settings and sync_from are kept, so a
      // reconnect to the same books carries on and queues what it missed.
      await db.from("accounting_v2_connections").update({
        status: "disconnected", disconnected_at: new Date().toISOString(), available_orgs: null, updated_at: new Date().toISOString(),
      }).eq("id", conn.id);
      return jsonResponse({ ok: true });
    }

    if (action === "retry_failed") {
      const { data, error } = await db.from("accounting_sync_items")
        .update({ status: "waiting", next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("provider", provider).eq("status", "failed").select("id");
      if (error) throw error;
      return jsonResponse({ reset: data?.length ?? 0 });
    }

    if (action === "backfill") {
      const from = new Date(String(body.from ?? ""));
      if (Number.isNaN(from.getTime())) return errorResponse("Choose a start date.", 400);
      if (from.getTime() > Date.now()) return errorResponse("The start date is in the future.", 400);
      const current = conn.sync_from ? new Date(conn.sync_from) : new Date();
      if (from < current) {
        await db.from("accounting_v2_connections").update({ sync_from: from.toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
      }
      const { data: queued, error } = await db.rpc("accounting_v2_reconcile", { p_tenant: tenantId });
      if (error) throw error;
      return jsonResponse({ queued: queued ?? 0, sync_from: (from < current ? from : current).toISOString() });
    }

    // Everything below talks to the provider.
    if (conn.status !== "connected") {
      return errorResponse(conn.status === "needs_reauth" ? `Reconnect ${name} first.` : `${name} is not connected.`, 409);
    }

    if (action === "test") {
      const adapter = buildAdapter(db, conn);
      const org = await adapter.getOrganisation();
      return jsonResponse({ ok: true, organisation: org.name, currency: org.currency ?? null });
    }

    if (action === "options") {
      const adapter = buildAdapter(db, conn);
      const [accounts, taxRates] = await Promise.all([adapter.listAccounts(), adapter.listTaxRates().catch(() => [])]);
      const defaults = pickDefaults(provider, accounts);
      return jsonResponse({
        accounts,
        taxRates,
        settings: conn.settings ?? {},
        defaults: Object.fromEntries(Object.entries(defaults).map(([k, a]) => [k, a ? { id: a.id, code: a.code, name: a.name } : null])),
      });
    }

    if (action === "save_settings") {
      const incoming = (body.settings ?? {}) as AccountSettings;
      const next: AccountSettings = { ...(conn.settings ?? {}) };
      const auto = new Set(next.auto ?? []);
      for (const k of SETTING_KEYS) {
        if (!(k in incoming)) continue;
        const v = incoming[k];
        if (v && typeof v.id === "string") {
          next[k] = { id: v.id, code: v.code ?? null, name: v.name ?? null };
          auto.delete(k);
        } else {
          next[k] = null;    // back to the default, chosen on the next send
          auto.delete(k);
        }
      }
      if ("tax_rate" in incoming) {
        next.tax_rate = incoming.tax_rate?.id ? { id: incoming.tax_rate.id, name: incoming.tax_rate.name ?? null } : null;
      }
      next.auto = [...auto];
      const { error } = await db.from("accounting_v2_connections").update({ settings: next, updated_at: new Date().toISOString() }).eq("id", conn.id);
      if (error) throw error;
      // Fill any reset ones straight away so the screen shows what will be used.
      conn.settings = next;
      await resolveSettings(db, conn, buildAdapter(db, conn)).catch(() => undefined);
      // A failed item may have been waiting on exactly this.
      await db.from("accounting_sync_items").update({ next_attempt_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("provider", provider).eq("status", "failed");
      return jsonResponse({ ok: true });
    }

    if (action === "sync_now") {
      const { data: items, error } = await db.rpc("accounting_v2_claim", { p_limit: 40, p_tenant: tenantId, p_provider: provider });
      if (error) throw error;
      const result = await processItems(db, (items ?? []) as any[], Date.now() + 40_000);
      return jsonResponse(result);
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`accounting-v2 ${action} (${provider}):`, msg);
    const status = e instanceof ProviderError ? (e.kind === "auth" ? 409 : e.kind === "rate" ? 429 : 502) : 500;
    return errorResponse(msg, status);
  }
});
