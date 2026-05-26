/**
 * Finance Sync — accounting connection hooks (Sprint 2).
 *
 *   useAccountingConnections()       — list active + historical connections (tenant-safe view)
 *   useActiveAccountingConnection(provider)
 *                                    — convenience selector for one provider's active row
 *   useConnectXero()                 — calls xero-oauth-start → redirects to Xero
 *   useDisconnectAccounting()        — calls disconnect-accounting edge fn
 *
 * Reads come via the `accounting_connections_public` view which excludes
 * secret_id columns. Mutations go through edge functions.
 */
"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export type AccountingProvider = "xero" | "zoho";
export type AccountingConnectionStatus = "active" | "expired" | "revoked" | "error";

export interface AccountingConnectionRow {
  id: string;
  tenant_id: string;
  provider: AccountingProvider;
  status: AccountingConnectionStatus;
  token_expires_at: string | null;
  external_org_id: string;
  external_org_name: string | null;
  external_region: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  connected_by: string | null;
  connected_at: string;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useAccountingConnections() {
  const { tenant } = useTenant();
  const qc = useQueryClient();

  // Sprint 6 patch — subscribe to accounting_connections changes so the
  // "expired" banner refreshes in real time when the token-refresh cron
  // flips status. Without this the portal waits up to React Query's
  // staleTime (60s) before noticing.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabaseUntyped
      .channel(`accounting-connections-${tenant.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accounting_connections",
          filter: `tenant_id=eq.${tenant.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["accounting-connections", tenant.id] });
        },
      )
      .subscribe();
    return () => {
      supabaseUntyped.removeChannel(channel);
    };
  }, [tenant?.id, qc]);

  return useQuery({
    queryKey: ["accounting-connections", tenant?.id],
    queryFn: async (): Promise<AccountingConnectionRow[]> => {
      if (!tenant?.id) return [];
      const { data, error } = await supabaseUntyped
        .from("accounting_connections_public")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("connected_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as AccountingConnectionRow[]);
    },
    enabled: !!tenant?.id,
  });
}

/** The single ACTIVE row for a given provider (or undefined if not connected). */
export function useActiveAccountingConnection(provider: AccountingProvider) {
  const query = useAccountingConnections();
  const active = (query.data ?? []).find((c) => c.provider === provider && c.status === "active");
  return { ...query, data: active ?? null };
}

export function useConnectXero() {
  return useMutation({
    mutationFn: async (args?: { redirectBack?: string }) => {
      const { data, error } = await supabase.functions.invoke("xero-oauth-start", {
        body: { redirectBack: args?.redirectBack ?? null },
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
      const { authorizeUrl } = data as { ok: boolean; authorizeUrl: string };
      if (!authorizeUrl) throw new Error("No authorize URL returned");
      // Hand off to Xero — operator returns via the callback.
      window.location.href = authorizeUrl;
      return { redirected: true };
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start Xero connection"),
  });
}

/** Zoho regions — six data centres, operator picks at connect time. */
export type ZohoRegion = "com" | "eu" | "in" | "com.au" | "jp" | "sa";

export function useConnectZoho() {
  return useMutation({
    mutationFn: async (args: { region: ZohoRegion; redirectBack?: string }) => {
      const { data, error } = await supabase.functions.invoke("zoho-oauth-start", {
        body: { region: args.region, redirectBack: args.redirectBack ?? null },
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
      const { authorizeUrl } = data as { ok: boolean; authorizeUrl: string };
      if (!authorizeUrl) throw new Error("No authorize URL returned");
      window.location.href = authorizeUrl;
      return { redirected: true };
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start Zoho connection"),
  });
}

export function useDisconnectAccounting() {
  const qc = useQueryClient();
  const { tenant, refetchTenant } = useTenant();
  return useMutation({
    mutationFn: async (provider: AccountingProvider) => {
      const { data, error } = await supabase.functions.invoke("disconnect-accounting", {
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
      return data as { ok: boolean; provider: AccountingProvider };
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ["accounting-connections", tenant?.id] });
      await refetchTenant?.();
      toast.success(`Disconnected from ${data.provider === "xero" ? "Xero" : "Zoho Books"}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to disconnect"),
  });
}
