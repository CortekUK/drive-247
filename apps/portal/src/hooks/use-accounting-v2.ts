"use client";

// ── Accounting sync v2 — portal data ─────────────────────────────────────────
//
// Reads go straight to the three v2 tables under RLS; every write goes through
// the `accounting-v2` edge function. The connections table only grants the
// non-secret columns, so nothing here can select a vault id even by mistake.
//
// ⚠️ ISOLATION. Every query carries `.eq("tenant_id", tenantId)`. RLS is on, but
// its policy also admits super admins (tenant_id NULL), for whom the explicit
// filter is the only thing scoping the read to this tenant (V2_PLAN §5).

import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { throwEdgeError } from "@/lib/edge-error";

export type AccountingProvider = "xero" | "zoho";

export const PROVIDER_NAME: Record<AccountingProvider, string> = { xero: "Xero", zoho: "Zoho Books" };
/** Board card names — the `?open=` deep link the OAuth return lands on. */
export const PROVIDER_CARD: Record<AccountingProvider, string> = { xero: "Xero", zoho: "Zoho" };

export type ConnectionStatus = "pending_org" | "connected" | "disconnected" | "error" | "needs_reauth";

export interface AccountRef { id: string; code?: string | null; name?: string | null }

export interface AccountingSettings {
  card_account?: AccountRef | null;
  manual_account?: AccountRef | null;
  sales_account?: AccountRef | null;
  deposit_account?: AccountRef | null;
  tax_account?: AccountRef | null;
  tax_rate?: { id: string; name?: string | null } | null;
  auto?: string[];
}

export interface AccountingConnection {
  id: string;
  tenant_id: string;
  provider: AccountingProvider;
  status: ConnectionStatus;
  external_org_id: string | null;
  external_org_name: string | null;
  external_org_short_code: string | null;
  available_orgs: { id: string; name: string }[] | null;
  region: string | null;
  api_domain: string | null;
  token_expires_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  sync_from: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  settings: AccountingSettings;
}

export interface SyncItemRow {
  id: string;
  provider: AccountingProvider;
  source_type: "invoice" | "payment" | "refund" | "charge" | "rental_refund";
  source_id: string;
  operation: "sync" | "delete";
  direction: "in" | "out" | "none";
  amount: number;
  currency: string;
  description: string;
  customer_name: string | null;
  invoice_number: string | null;
  occurred_at: string;
  status: "waiting" | "sent" | "failed";
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  updated_at: string;
}

const CONNECTION_COLUMNS =
  "id, tenant_id, provider, status, external_org_id, external_org_name, external_org_short_code, available_orgs, region, api_domain, token_expires_at, connected_at, disconnected_at, sync_from, last_sync_at, last_error, settings";

const ITEM_COLUMNS =
  "id, provider, source_type, source_id, operation, direction, amount, currency, description, customer_name, invoice_number, occurred_at, status, attempts, last_error, sent_at, updated_at";

export const accountingKeys = {
  connections: (tenantId: string) => ["accounting-v2", "connections", tenantId] as const,
  items: (tenantId: string, provider: AccountingProvider) => ["accounting-v2", "items", tenantId, provider] as const,
  marks: (tenantId: string, ids: string) => ["accounting-v2", "marks", tenantId, ids] as const,
  options: (tenantId: string, provider: AccountingProvider) => ["accounting-v2", "options", tenantId, provider] as const,
};

/* ─────────────────────────────── reads ──────────────────────────────────── */

/** Every v2 connection this tenant has (at most one per provider). */
export function useAccountingConnections(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: accountingKeys.connections(tenantId ?? ""),
    queryFn: async (): Promise<AccountingConnection[]> => {
      const { data, error } = await supabaseUntyped
        .from("accounting_v2_connections")
        .select(CONNECTION_COLUMNS)
        .eq("tenant_id", tenantId);
      if (error) throw error;
      return (data ?? []) as AccountingConnection[];
    },
    enabled: !!tenantId,
    staleTime: 30_000,
    // The OAuth round-trip leaves and re-enters this tab.
    refetchOnWindowFocus: true,
  });
}

export function useAccountingConnection(tenantId: string, provider: AccountingProvider) {
  const q = useAccountingConnections(tenantId);
  return { ...q, data: q.data ? (q.data.find((c) => c.provider === provider) ?? null) : undefined };
}

const PAGE = 50;

/** The Sync screen's table: every item, newest first, 50 at a time. */
export function useSyncItems(tenantId: string, provider: AccountingProvider, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: accountingKeys.items(tenantId, provider),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<SyncItemRow[]> => {
      const from = pageParam as number;
      const { data, error } = await supabaseUntyped
        .from("accounting_sync_items")
        .select(ITEM_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("provider", provider)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      return (data ?? []) as SyncItemRow[];
    },
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length * PAGE),
    enabled,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/** Sync state of the given payments (and their refunds), for the invoice drawer. */
export function useSyncMarks(tenantId: string | null | undefined, paymentIds: string[], enabled: boolean) {
  const ids = [...new Set(paymentIds)].sort();
  return useQuery({
    queryKey: accountingKeys.marks(tenantId ?? "", ids.join(",")),
    queryFn: async (): Promise<SyncItemRow[]> => {
      if (ids.length === 0) return [];
      const { data, error } = await supabaseUntyped
        .from("accounting_sync_items")
        .select(ITEM_COLUMNS)
        .eq("tenant_id", tenantId)
        .in("source_type", ["payment", "refund"])
        .eq("operation", "sync")
        .in("source_id", ids);
      if (error) throw error;
      return (data ?? []) as SyncItemRow[];
    },
    enabled: enabled && !!tenantId && ids.length > 0,
    staleTime: 15_000,
  });
}

/**
 * Live: the worker writes items with the service role, so nothing would tell
 * an open Sync screen or drawer. One channel per tenant, filtered — RLS still
 * decides what each subscriber receives.
 */
export function useSyncItemsLive(tenantId: string | null | undefined, enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || !tenantId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`accounting-v2-items-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounting_sync_items", filter: `tenant_id=eq.${tenantId}` },
        () => {
          // A burst of rows (a backfill) is one refetch, not fifty.
          if (timer) return;
          timer = setTimeout(() => {
            timer = null;
            qc.invalidateQueries({ queryKey: ["accounting-v2", "items", tenantId] });
            qc.invalidateQueries({ queryKey: ["accounting-v2", "marks", tenantId] });
          }, 800);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, tenantId, qc]);
}

/* ─────────────────────────────── actions ────────────────────────────────── */

export async function accountingAction<T = Record<string, any>>(
  action: string,
  provider: AccountingProvider,
  tenantSlug: string | null | undefined,
  extra: Record<string, unknown> = {},
): Promise<T> {
  // A super admin has tenant_id NULL, so the slug is how the function finds the
  // tenant — and it is honoured ONLY for a super admin (resolve-tenant.ts).
  const { data, error } = await supabase.functions.invoke("accounting-v2", {
    body: { action, provider, tenantSlug: tenantSlug ?? null, ...extra },
  });
  if (error) await throwEdgeError(error);
  return data as T;
}

export interface AccountOption {
  id: string;
  code: string | null;
  name: string;
  type: string;
  canPay: boolean;
  canSell: boolean;
}

export interface AccountingOptions {
  accounts: AccountOption[];
  taxRates: { id: string; name: string; rate: number | null }[];
  settings: AccountingSettings;
  defaults: Partial<Record<"card_account" | "manual_account" | "sales_account" | "deposit_account" | "tax_account", AccountRef | null>>;
}

/** The provider's chart of accounts and tax rates, for "Where things land". */
export function useAccountingOptions(tenant: { id: string; slug: string }, provider: AccountingProvider, enabled: boolean) {
  return useQuery({
    queryKey: accountingKeys.options(tenant.id, provider),
    queryFn: () => accountingAction<AccountingOptions>("options", provider, tenant.slug),
    enabled,
    staleTime: 5 * 60_000,
    retry: false, // a 401 from the provider is an answer, not a blip
  });
}

/** Invalidate everything v2-accounting for this tenant after a write. */
export function useAccountingInvalidate(tenantId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["accounting-v2"], predicate: (q) => q.queryKey.includes(tenantId) });
}

export function useAccountingMutation<V = void>(
  tenant: { id: string; slug: string },
  provider: AccountingProvider,
  run: (vars: V) => Promise<unknown>,
) {
  const invalidate = useAccountingInvalidate(tenant.id);
  return useMutation({ mutationFn: run, onSettled: () => invalidate() });
}
