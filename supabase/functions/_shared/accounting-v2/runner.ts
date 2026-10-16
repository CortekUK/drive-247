/**
 * Accounting sync v2 — drains `accounting_sync_items`.
 *
 * Used by the `accounting-sync-v2` cron worker (every tenant) and by the
 * portal's "Sync now" (one tenant). Items are claimed with SKIP LOCKED, grouped
 * per connection and sent IN ORDER per tenant (invoices, then payments, then
 * refunds, oldest first), one connection at a time so an organisation never
 * sees concurrent calls from us.
 *
 * Outcomes:
 *   sent     → status sent, external_id kept
 *   drop     → nothing to send and nothing was ever sent (e.g. an edit to a
 *              payment from before the connection): the item is removed
 *   rate     → the whole org pauses until the provider says; items stay waiting
 *   auth     → the connection flips to needs_reauth; items stay waiting
 *   anything else → failed, with the provider's own words, retried with
 *              exponential back-off (1 min … 6 h), forever. A money movement is
 *              never given up on; it stays visible as Failed until it goes.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { Engine, type SyncItem } from "./engine.ts";
import { getAccessToken } from "./tokens.ts";
import { type Adapter, type Connection, ProviderError } from "./types.ts";
import { xeroAdapter } from "./xero.ts";
import { zohoAdapter } from "./zoho.ts";

/** Calls per organisation per run — under Xero's 60/min and Zoho's 100/min. */
const CALL_BUDGET = { xero: 45, zoho: 80 } as const;

export const CONNECTION_COLUMNS =
  "id, tenant_id, provider, status, external_org_id, external_org_name, external_org_short_code, external_connection_id, region, api_domain, accounts_server, token_expires_at, connected_at, sync_from, settings";

export function buildAdapter(db: SupabaseClient, conn: Connection, onPause?: (seconds: number) => void): Adapter {
  const token = () => getAccessToken(db, conn);
  const refresh = () => getAccessToken(db, conn, true);
  if (conn.provider === "xero") {
    if (!conn.external_org_id) throw new ProviderError("auth", "No Xero organisation chosen yet.");
    return xeroAdapter({ tenantId: conn.external_org_id, token, refresh, onLowBudget: onPause });
  }
  if (!conn.external_org_id || !conn.api_domain) throw new ProviderError("auth", "No Zoho Books organisation chosen yet.");
  return zohoAdapter({ orgId: conn.external_org_id, apiDomain: conn.api_domain, accountsServer: conn.accounts_server, token, refresh });
}

export function backoffAt(attempts: number): string {
  const minutes = Math.min(360, 2 ** Math.min(attempts, 9));       // 1, 2, 4 … 256, 360
  const jitter = Math.random() * 0.2 * minutes;
  return new Date(Date.now() + (minutes + jitter) * 60_000).toISOString();
}

async function finish(db: SupabaseClient, item: SyncItem, outcome: string, extra: { externalId?: string | null; error?: string; retryAt?: string } = {}) {
  const { error } = await db.rpc("accounting_v2_finish", {
    p_id: item.id,
    p_generation: item.generation,
    p_outcome: outcome,
    p_external_id: extra.externalId ?? null,
    p_error: extra.error ?? null,
    p_retry_at: extra.retryAt ?? null,
    p_description: null,
  });
  if (error) console.error("accounting_v2_finish failed", item.id, error.message);
}

export interface RunResult { sent: number; failed: number; dropped: number; deferred: number; }

/**
 * Process claimed items until done, out of budget, or past the deadline.
 * Anything not reached is released back to waiting straight away.
 */
export async function processItems(
  db: SupabaseClient, items: SyncItem[], deadline: number,
  /** Calls already spent per org this minute, carried across batches by the worker. */
  spent: Map<string, number> = new Map(),
): Promise<RunResult> {
  const result: RunResult = { sent: 0, failed: 0, dropped: 0, deferred: 0 };
  const byConn = new Map<string, SyncItem[]>();
  for (const it of items) {
    const k = `${it.tenant_id}:${it.provider}`;
    byConn.set(k, [...(byConn.get(k) ?? []), it]);
  }

  for (const group of byConn.values()) {
    const { tenant_id, provider } = group[0];
    const budgetKey = `${tenant_id}:${provider}`;
    const already = spent.get(budgetKey) ?? 0;
    const { data: conn } = await db.from("accounting_v2_connections").select(CONNECTION_COLUMNS)
      .eq("tenant_id", tenant_id).eq("provider", provider).maybeSingle();
    let queue = [...group];
    const release = async (why: string, retryAt?: string) => {
      for (const it of queue) await finish(db, it, "retry", { error: why, retryAt: retryAt ?? new Date().toISOString() });
      result.deferred += queue.length;
      queue = [];
    };
    if (!conn || conn.status !== "connected") {
      await release("Waiting for the connection to be restored.");
      continue;
    }

    let pauseSeconds = 0;
    const pause = async (seconds: number) => {
      const until = new Date(Date.now() + seconds * 1000).toISOString();
      await db.from("accounting_v2_connections").update({ paused_until: until }).eq("id", conn.id);
      return until;
    };

    let engine: Engine;
    let adapter: Adapter;
    try {
      adapter = buildAdapter(db, conn as Connection, (s) => { pauseSeconds = Math.max(pauseSeconds, s); });
      engine = new Engine(db, conn as Connection, adapter);
      await engine.init();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ProviderError && e.kind === "rate") await release(msg, await pause(e.retryAfter));
      else if (e instanceof ProviderError && e.kind === "auth") await release(msg);
      else {
        for (const it of queue) await finish(db, it, "failed", { error: msg, retryAt: backoffAt(it.attempts) });
        result.failed += queue.length;
        queue = [];
      }
      continue;
    }

    while (queue.length) {
      if (Date.now() > deadline) {
        await release("Queued — next run.");
        break;
      }
      if (already + adapter.calls() >= CALL_BUDGET[provider]) {
        // This org's share of the minute is used: the rest goes next minute.
        await release("Queued — next run.", new Date(Date.now() + 60_000).toISOString());
        break;
      }
      if (pauseSeconds > 0) {
        await release("Pausing for the provider's rate limit.", await pause(pauseSeconds));
        break;
      }
      const item = queue.shift()!;
      try {
        const out = await engine.process(item);
        await finish(db, item, out.outcome, { externalId: out.externalId ?? null });
        if (out.outcome === "drop") result.dropped++; else result.sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof ProviderError && e.kind === "rate") {
          queue.unshift(item);
          await release(msg, await pause(e.retryAfter));
          break;
        }
        if (e instanceof ProviderError && e.kind === "auth") {
          queue.unshift(item);
          await release(msg);     // getAccessToken has flipped the connection to needs_reauth
          break;
        }
        console.error(`accounting-sync-v2 ${provider} ${item.source_type} ${item.source_id}:`, msg);
        await finish(db, item, "failed", { error: msg.slice(0, 1000), retryAt: backoffAt(item.attempts) });
        result.failed++;
      }
    }

    spent.set(budgetKey, already + adapter.calls());
    await db.from("accounting_v2_connections").update({
      last_sync_at: new Date().toISOString(),
      ...(result.sent > 0 ? { last_error: null } : {}),
    }).eq("id", conn.id).eq("status", "connected");
  }
  return result;
}
