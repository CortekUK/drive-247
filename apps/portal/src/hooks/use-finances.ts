"use client";

/**
 * Finances — one hook for the whole page (docs/FINANCES_DESIGN.md §8.1).
 *
 *   const { stats, attention, bills, receipts, upcoming, plansAvailable,
 *           isLoading, error, refetch } = useFinances(filters, scope);
 *
 * One query reads every row the scope needs (hooks/use-finances-data.ts); the
 * model is built from it (lib/finances/model.ts) and the filter bar is applied
 * in memory (lib/finances/filters.ts) — changing a filter never refetches.
 *
 * Conventions: the key is `["finances", tenant.id, rentalId, customerId, plans]`
 * (invalidate `["finances"]` after any money action); the query runs only when
 * the tenant is known AND the `finances` v2 area is on for it, and waits for the
 * payment-plan probe to settle so it knows whether the plan tables exist. An
 * error is an error: `stats` is undefined and `error` is set — never a zero.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useV2 } from "@/lib/v2-context";
import { usePaymentPlansFeature } from "@/hooks/use-payment-plan";
import { loadFinanceData, type FinanceClient } from "@/hooks/use-finances-data";
import { buildFinanceModel } from "@/lib/finances/model";
import { fineSettledDays } from "@/lib/finances/fines";
import { selectFinances } from "@/lib/finances/filters";
import { tenantToday } from "@/lib/finances/period";
import type {
  AttentionItem,
  BillRow,
  FinanceContext,
  FinanceFilters,
  FinanceModel,
  FinanceScope,
  FinanceSeries,
  FinanceStats,
  ReceiptRow,
  UpcomingRow,
} from "@/lib/finances/types";

export function financesKey(tenantId: string | undefined, scope: FinanceScope | undefined, plansAvailable: boolean) {
  return ["finances", tenantId, scope?.rentalId ?? null, scope?.customerId ?? null, plansAvailable ? "plans" : "no-plans"] as const;
}

/** The raw rows for a scope. Most callers want `useFinances`. */
export function useFinanceData(scope?: FinanceScope) {
  const { tenant } = useTenant();
  // The `finances` v2 area (lib/v2.ts): northwind by slug only.
  const financesOn = useV2("finances");
  const plans = usePaymentPlansFeature();
  const plansAvailable = plans.enabled;
  const query = useQuery({
    queryKey: financesKey(tenant?.id, scope, plansAvailable),
    enabled: !!tenant && financesOn && !plans.isLoading,
    queryFn: () => loadFinanceData(supabaseUntyped as unknown as FinanceClient, tenant!.id, scope ?? {}, plansAvailable),
    staleTime: 30_000,
    // Coming back from a Stripe tab should show what the webhook did.
    refetchOnWindowFocus: true,
  });
  return { query, financesOn, plansAvailable, plansLoading: plans.isLoading };
}

export interface UseFinancesResult {
  stats: FinanceStats | undefined;
  attention: AttentionItem[];
  bills: BillRow[];
  receipts: ReceiptRow[];
  upcoming: UpcomingRow[];
  plansAvailable: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  /** added — the unfiltered model (every bill, receipt and occurrence in scope), for side panels. */
  model: FinanceModel | undefined;
  /** added — today in the tenant's timezone, the day every date rule was evaluated against. */
  today: string;
  /**
   * added — the charts: collected per day/week (+ refunds), outstanding ageing,
   * next-7-days upcoming. Each sums to its stat (lib/finances/series.ts).
   */
  series: FinanceSeries | undefined;
  /**
   * added — fine id → the day money paid its charge off (lib/finances/fines.ts
   * `fineSettledDays`), for "Fines paid" on fines the payment trigger marked
   * Paid without a `resolved_at`. Empty until the rows are read.
   */
  fineSettledDays: ReadonlyMap<string, string>;
}

const EMPTY: never[] = [];
const NO_SETTLED_DAYS: ReadonlyMap<string, string> = new Map();

export function useFinances(filters: FinanceFilters, scope?: FinanceScope): UseFinancesResult {
  const { tenant } = useTenant();
  const { query, financesOn, plansLoading } = useFinanceData(scope);

  const timeZone = tenant?.timezone ?? null;
  const currency = tenant?.currency_code || "USD";
  const today = tenantToday(timeZone);

  const model = useMemo<FinanceModel | undefined>(() => {
    if (!query.data) return undefined;
    const ctx: FinanceContext = { today, timeZone, currency };
    return buildFinanceModel(query.data, ctx);
  }, [query.data, today, timeZone, currency]);

  // Filters arrive as a fresh object on most renders; key the selection on
  // their content instead of their identity.
  const filterKey = JSON.stringify(filters ?? null);
  const selection = useMemo(
    () => (model ? selectFinances(model, filters, today) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, filterKey, today],
  );

  const settledDays = useMemo(() => (query.data ? fineSettledDays(query.data) : NO_SETTLED_DAYS), [query.data]);

  const error = (query.error as Error | null) ?? null;
  const ok = !!selection && !error;
  return {
    stats: ok ? selection!.stats : undefined,
    attention: ok ? model!.attention : EMPTY,
    bills: ok ? selection!.bills : EMPTY,
    receipts: ok ? selection!.receipts : EMPTY,
    upcoming: ok ? selection!.upcoming : EMPTY,
    // The loader's verdict once it has read (the feature probe can say
    // "available" on a database without the tables — see use-finances-data.ts).
    plansAvailable: query.data ? query.data.plansAvailable === true : false,
    isLoading: !!tenant && financesOn && (plansLoading || query.isLoading),
    error,
    refetch: () => {
      void query.refetch();
    },
    model: ok ? model : undefined,
    today,
    series: ok ? selection!.series : undefined,
    fineSettledDays: settledDays,
  };
}
