/**
 * Finance Sync — Sprint 3 portal hooks.
 *
 * One file holds everything the mapping screen, sync log, failed-row drawer,
 * and per-rental sync stripe need. Bundled to keep import noise low.
 *
 *   useAccountingMappings(provider)
 *   useAccountingAccounts(provider)            — Xero/Zoho chart of accounts
 *   useAccountingTaxRates(provider)            — Xero/Zoho tax rates
 *   useSaveAccountingMappings()                — mutation
 *   useAccountingSyncLog(filters)              — paginated list
 *   useAccountingSyncStats(provider)           — KPI tiles
 *   useRetryAccountingSync()                   — mutation (single or bulk)
 *   useRentalAccountingState(rentalId)         — per-rental sync badges
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { AccountingProvider } from "@/hooks/use-accounting-connection";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountingMappingRow {
  id: string;
  tenant_id: string;
  provider: AccountingProvider;
  event_type: string | null;
  is_payment_account_sentinel: boolean;
  external_account_code: string;
  external_account_name: string | null;
  external_tax_code: string | null;
  external_tax_rate: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExternalAccount {
  code: string;
  name: string;
  type?: string;
  isActive?: boolean;
}
export interface ExternalTaxRate {
  code: string;
  name: string;
  rate?: number;
}

export type SyncStateValue = "pending" | "syncing" | "synced" | "failed" | "skipped";

export interface SyncLogRow {
  id: string;
  financial_event_id: string;
  tenant_id: string;
  provider: AccountingProvider;
  state: SyncStateValue;
  external_invoice_id: string | null;
  external_payment_id: string | null;
  external_credit_note_id: string | null;
  external_contact_id: string | null;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  synced_at: string | null;
  created_at: string;
  // Joined fields
  event?: {
    id: string;
    rental_id: string | null;
    vehicle_id: string | null;
    customer_id: string | null;
    event_type: string;
    amount_cents: number;
    currency: string;
    occurred_at: string;
    description: string | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappings
// ─────────────────────────────────────────────────────────────────────────────

export function useAccountingMappings(provider: AccountingProvider | null) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["accounting-mappings", tenant?.id, provider],
    queryFn: async (): Promise<AccountingMappingRow[]> => {
      if (!tenant?.id || !provider) return [];
      const { data, error } = await supabaseUntyped
        .from("accounting_account_mappings")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("provider", provider)
        .order("event_type", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as AccountingMappingRow[];
    },
    enabled: !!tenant?.id && !!provider,
  });
}

export function useAccountingAccounts(provider: AccountingProvider | null) {
  return useQuery({
    queryKey: ["accounting-accounts", provider],
    queryFn: async (): Promise<ExternalAccount[]> => {
      if (!provider) return [];
      const { data, error } = await supabase.functions.invoke("list-accounting-accounts", {
        body: { provider },
      });
      if (error) {
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return (data as { ok: boolean; accounts: ExternalAccount[] }).accounts ?? [];
    },
    enabled: !!provider,
    staleTime: 5 * 60_000,           // 5 min — accounts rarely change in the provider
  });
}

export function useAccountingTaxRates(provider: AccountingProvider | null) {
  return useQuery({
    queryKey: ["accounting-tax-rates", provider],
    queryFn: async (): Promise<ExternalTaxRate[]> => {
      if (!provider) return [];
      const { data, error } = await supabase.functions.invoke("list-accounting-tax-rates", {
        body: { provider },
      });
      if (error) {
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return (data as { ok: boolean; taxRates: ExternalTaxRate[] }).taxRates ?? [];
    },
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

export interface MappingSavePayload {
  event_type?: string | null;
  is_payment_account_sentinel?: boolean;
  external_account_code: string;
  external_account_name?: string | null;
  external_tax_code?: string | null;
  external_tax_rate?: number | null;
}

export function useSaveAccountingMappings() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (args: { provider: AccountingProvider; mappings: MappingSavePayload[] }) => {
      const { data, error } = await supabase.functions.invoke("save-accounting-mappings", {
        body: args,
      });
      if (error) {
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return data as { ok: boolean; upserted_event_mappings: number; upserted_payment_account: number; errors: string[] };
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["accounting-mappings", tenant?.id, vars.provider] });
      const total = data.upserted_event_mappings + data.upserted_payment_account;
      toast.success(`${total} mapping${total === 1 ? "" : "s"} saved`);
      if (data.errors.length > 0) {
        toast.warning(`${data.errors.length} mapping${data.errors.length === 1 ? "" : "s"} failed — check the console`);
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save mappings"),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync log
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncLogFilters {
  provider: AccountingProvider;
  state?: SyncStateValue | "all";
  /** ISO date or null = no lower bound */
  since?: string | null;
  /** Free-text search — matched against event description + invoice ref */
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useAccountingSyncLog(filters: SyncLogFilters) {
  const { tenant } = useTenant();
  const page = filters.page ?? 0;
  const pageSize = filters.pageSize ?? 25;

  return useQuery({
    queryKey: ["accounting-sync-log", tenant?.id, filters.provider, filters.state ?? "all", filters.since ?? null, filters.search ?? "", page, pageSize],
    queryFn: async (): Promise<{ rows: SyncLogRow[]; total: number }> => {
      if (!tenant?.id) return { rows: [], total: 0 };

      // 1. Fetch sync_state rows WITHOUT the embedded join — the PostgREST
      //    join was hanging the supabase-js client on some browsers.
      //    Also drop `count: exact` — for large tenants the exact count needs
      //    its own COUNT query which can stall behind the data query and
      //    leave the supabase-js client awaiting a Content-Range header
      //    forever. Estimate gets us pagination "good enough" without the stall.
      let query = supabaseUntyped
        .from("financial_event_sync_state")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("provider", filters.provider)
        .order("created_at", { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1);

      if (filters.state && filters.state !== "all") {
        query = query.eq("state", filters.state);
      }
      if (filters.since) {
        query = query.gte("created_at", filters.since);
      }
      if (filters.search && filters.search.length > 0) {
        query = query.or(`external_invoice_id.ilike.%${filters.search}%,last_error.ilike.%${filters.search}%`);
      }

      const { data: stateRows, error } = await query;
      if (error) throw error;

      // 2. Fetch financial_events for these sync rows in a second round-trip.
      const eventIds = (stateRows ?? []).map((r) => (r as { financial_event_id: string }).financial_event_id);
      let eventsById = new Map<string, NonNullable<SyncLogRow["event"]>>();
      if (eventIds.length > 0) {
        const { data: eventsRaw, error: evErr } = await supabaseUntyped
          .from("financial_events")
          .select("id, rental_id, vehicle_id, customer_id, event_type, amount_cents, currency, occurred_at, description")
          .in("id", eventIds);
        if (evErr) throw evErr;
        eventsById = new Map(
          (eventsRaw ?? []).map((e) => [
            (e as { id: string }).id,
            e as NonNullable<SyncLogRow["event"]>,
          ]),
        );
      }

      // 3. Stitch the embed back together so the consumer code is unchanged.
      const rows = (stateRows ?? []).map((r) => {
        const row = r as SyncLogRow & { financial_event_id: string };
        return { ...row, event: eventsById.get(row.financial_event_id) };
      });
      // total is approximated as the page size — pagination falls back to
      // "has next page" via row count check in the UI.
      return { rows, total: rows.length };
    },
    enabled: !!tenant?.id,
  });
}

export function useAccountingSyncStats(provider: AccountingProvider | null) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["accounting-sync-stats", tenant?.id, provider],
    queryFn: async (): Promise<{ synced: number; pending: number; failed: number; skipped: number; total: number }> => {
      if (!tenant?.id || !provider) return { synced: 0, pending: 0, failed: 0, skipped: 0, total: 0 };
      const states: SyncStateValue[] = ["synced", "pending", "failed", "skipped", "syncing"];
      const counts = await Promise.all(
        states.map(async (s) => {
          const { count } = await supabaseUntyped
            .from("financial_event_sync_state")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", tenant.id)
            .eq("provider", provider)
            .eq("state", s);
          return { state: s, count: count ?? 0 };
        }),
      );
      const map = Object.fromEntries(counts.map((c) => [c.state, c.count])) as Record<SyncStateValue, number>;
      const total = states.reduce((s, st) => s + (map[st] ?? 0), 0);
      return {
        synced: map.synced ?? 0,
        pending: (map.pending ?? 0) + (map.syncing ?? 0),
        failed: map.failed ?? 0,
        skipped: map.skipped ?? 0,
        total,
      };
    },
    enabled: !!tenant?.id && !!provider,
    refetchInterval: 60_000,         // refresh every minute so the KPI tiles feel live
  });
}

export function useRetryAccountingSync() {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: async (args: { syncStateId?: string; allFailed?: boolean; skip?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("retry-accounting-sync", { body: args });
      if (error) {
        const ctx = (error as { context?: { response?: Response } }).context;
        if (ctx?.response) {
          const parsed = await ctx.response.clone().json().catch(() => null);
          const msg = parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: string }).error) : null;
          if (msg) throw new Error(msg);
        }
        throw error;
      }
      return data as { ok: boolean; reset: number; newState: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["accounting-sync-log", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["accounting-sync-stats", tenant?.id] });
      qc.invalidateQueries({ queryKey: ["rental-accounting-state"] });
      if (data.newState === "skipped") {
        toast.success(`Marked as skipped — won't sync to provider`);
      } else if (data.reset === 1) {
        toast.success(`Queued for next sync (~2 min)`);
      } else {
        toast.success(`${data.reset} rows queued for next sync`);
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to retry"),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-rental sync state (powers the Accounting stripe on the rental detail page)
// ─────────────────────────────────────────────────────────────────────────────

export function useRentalAccountingState(rentalId: string | null | undefined) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["rental-accounting-state", tenant?.id, rentalId],
    queryFn: async (): Promise<SyncLogRow[]> => {
      if (!tenant?.id || !rentalId) return [];
      const { data, error } = await supabaseUntyped
        .from("financial_event_sync_state")
        .select("*, event:financial_events!inner(id, rental_id, vehicle_id, customer_id, event_type, amount_cents, currency, occurred_at, description)")
        .eq("tenant_id", tenant.id)
        .eq("event.rental_id", rentalId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SyncLogRow[];
    },
    enabled: !!tenant?.id && !!rentalId,
  });
}
