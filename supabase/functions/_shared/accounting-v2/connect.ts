/**
 * Accounting sync v2 — turning a completed OAuth grant into a live connection.
 *
 * Shared by the two callbacks (one organisation authorised → connect at once)
 * and the `select_org` action (several authorised → the operator picks one).
 *
 * Reconnecting the SAME organisation keeps `sync_from` and the entity map, and
 * runs the reconciler straight away: everything that happened while the
 * connection was down is queued, so nothing is lost by a disconnect. Choosing a
 * DIFFERENT organisation starts afresh — the old map points at objects that do
 * not exist in the new books.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { Provider } from "./config.ts";
import { buildAdapter, CONNECTION_COLUMNS } from "./runner.ts";
import { storeTokens, type TokenSet } from "./tokens.ts";
import type { Connection } from "./types.ts";

export interface OrgChoice { id: string; name: string; connection_id?: string | null }

/** Save the grant (tokens to Vault) and return the connection id. */
export async function saveGrant(db: SupabaseClient, p: {
  tenantId: string; provider: Provider; tokens: TokenSet; userId: string | null; scopes: string;
  region?: string | null; apiDomain?: string | null; accountsServer?: string | null; orgs: OrgChoice[];
}): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await db.from("accounting_v2_connections").upsert({
    tenant_id: p.tenantId,
    provider: p.provider,
    status: "pending_org",
    available_orgs: p.orgs,
    region: p.region ?? null,
    api_domain: p.apiDomain ?? null,
    accounts_server: p.accountsServer ?? null,
    scopes: p.scopes,
    connected_by_user_id: p.userId,
    last_error: null,
    updated_at: now,
  }, { onConflict: "tenant_id,provider" }).select("id").single();
  if (error || !data) throw new Error(`Could not save the connection: ${error?.message}`);
  await storeTokens(db, data.id as string, p.tokens);
  return data.id as string;
}

export async function finalizeOrg(db: SupabaseClient, connectionId: string, org: OrgChoice): Promise<void> {
  const { data: before } = await db.from("accounting_v2_connections").select(CONNECTION_COLUMNS + ", available_orgs")
    .eq("id", connectionId).single();
  const conn = before as unknown as Connection & { available_orgs: OrgChoice[] | null };
  const now = new Date().toISOString();
  const sameOrg = !!conn.external_org_id && conn.external_org_id === org.id;

  if (conn.external_org_id && !sameOrg) {
    // New books: the old ids mean nothing there.
    await db.from("accounting_entity_map").delete().eq("tenant_id", conn.tenant_id).eq("provider", conn.provider);
    await db.from("accounting_sync_items").delete().eq("tenant_id", conn.tenant_id).eq("provider", conn.provider);
  }

  conn.external_org_id = org.id;
  conn.external_org_name = org.name;
  let shortCode: string | null = null;
  let name = org.name;
  try {
    const o = await buildAdapter(db, conn).getOrganisation();
    shortCode = o.shortCode ?? null;
    name = o.name || name;
  } catch (e) {
    console.warn("accounting-v2 finalizeOrg: organisation lookup failed (non-fatal)", e);
  }

  // Xero: one grant can cover several organisations. Drop the ones not chosen
  // so this app holds access only to the books it writes to.
  if (conn.provider === "xero") {
    const others = (conn.available_orgs ?? []).filter((o) => o.id !== org.id && o.connection_id);
    if (others.length) {
      const { getAccessToken } = await import("./tokens.ts");
      const token = await getAccessToken(db, conn).catch(() => null);
      for (const o of others) {
        if (token) {
          await fetch(`https://api.xero.com/connections/${o.connection_id}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${token}` },
          }).catch(() => undefined);
        }
      }
    }
  }

  const { error } = await db.from("accounting_v2_connections").update({
    status: "connected",
    external_org_id: org.id,
    external_org_name: name,
    external_org_short_code: shortCode,
    external_connection_id: org.connection_id ?? null,
    available_orgs: null,
    connected_at: now,
    disconnected_at: null,
    sync_from: sameOrg ? (conn.sync_from ?? now) : now,
    // A different org's mapping is meaningless; the same org keeps its choices.
    ...(sameOrg ? {} : { settings: {} }),
    last_error: null,
    paused_until: null,
    updated_at: now,
  }).eq("id", connectionId);
  if (error) throw new Error(`Could not finish the connection: ${error.message}`);

  // Anything that moved while disconnected is queued now.
  const { error: rErr } = await db.rpc("accounting_v2_reconcile", { p_tenant: conn.tenant_id });
  if (rErr) console.error("accounting-v2 finalizeOrg: reconcile failed", rErr.message);
}
