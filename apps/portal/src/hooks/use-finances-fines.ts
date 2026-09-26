"use client";

/**
 * The fines of ONE rental or ONE customer, for `ScopedFinances`.
 *
 * The Finances page's Fines view reads through the fines tab's own hook
 * (`useFinesData`, capped at 1,000 rows, tenant-wide). A rental or a customer
 * needs its own fines instead, read IN FULL: `fetchAllPages` pages the read
 * until it is exhausted, so a customer's list is never a truncated slice.
 *
 * The rows are the fines tab's rows — the same `select`, the same computed
 * fields (lib/finances/fines.ts `fineComputed`, mirrored from and tested
 * against use-fines-data.ts), the same search and status rules — so the list,
 * the side panel and the fines row actions (`useFineRowActions`) treat them
 * exactly as they treat the page's. The key starts `["fines-enhanced"]`, which
 * every fines dialog already invalidates, so a charge, waive or new fine
 * refreshes it with no new wiring.
 *
 * Search and status are applied in memory: one read per scope, and changing a
 * filter never refetches.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import type { EnhancedFine } from "@/hooks/use-fines-data";
import { fetchAllPages } from "@/lib/finances/paging";
import { fineComputed, fineMatchesSearch, fineMatchesStatus, type RawFineRow } from "@/lib/finances/fines";
import type { FinanceScope } from "@/lib/finances/types";

/** The fines tab's own select (hooks/use-fines-data.ts). */
export const SCOPED_FINE_SELECT = `
          *,
          customers!fines_customer_id_fkey(name, email, phone),
          vehicles!fines_vehicle_id_fkey(reg, make, model),
          rentals!fines_rental_id_fkey(rental_number),
          authority_payments(amount)
        `;

export function scopedFinesKey(tenantId: string | undefined, scope: FinanceScope) {
  return ["fines-enhanced", tenantId, "finances-scope", scope.rentalId ?? null, scope.customerId ?? null] as const;
}

/** A read's rows as the fines tab computes them, newest added first. */
export function enhanceScopedFines(rows: RawFineRow[], now: Date = new Date()): EnhancedFine[] {
  return rows
    .map((fine) => ({ ...(fine as object), ...fineComputed(fine, now) }) as unknown as EnhancedFine)
    .sort((a, b) => (String(a.created_at ?? "") < String(b.created_at ?? "") ? 1 : String(a.created_at ?? "") > String(b.created_at ?? "") ? -1 : 0));
}

/**
 * The scope's fines, shaped like `useFinesData`'s result (`data.fines`,
 * `data.serverCount`) so the Fines list renders them unchanged.
 */
export function useScopedFinanceFines(scope: FinanceScope, q: string, status: string | null, enabled = true) {
  const { tenant } = useTenant();
  const rentalId = scope.rentalId || null;
  const customerId = scope.customerId || null;
  const query = useQuery({
    queryKey: scopedFinesKey(tenant?.id, scope),
    enabled: !!tenant && enabled && !!(rentalId || customerId),
    queryFn: async () => {
      if (!tenant) throw new Error("No tenant context available");
      const rows = await fetchAllPages<RawFineRow>("fines", (from, to) => {
        let qb = (supabase as any).from("fines").select(SCOPED_FINE_SELECT).eq("tenant_id", tenant.id);
        if (rentalId) qb = qb.eq("rental_id", rentalId);
        if (customerId) qb = qb.eq("customer_id", customerId);
        return qb.order("id", { ascending: true }).range(from, to);
      });
      return enhanceScopedFines(rows);
    },
    staleTime: 30_000,
  });

  const all = query.data;
  const fines = useMemo(
    () => (all ? all.filter((f) => fineMatchesSearch(f as unknown as RawFineRow, q) && fineMatchesStatus(f, status)) : undefined),
    [all, q, status],
  );

  return {
    data: fines ? { fines, serverCount: fines.length } : undefined,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}
