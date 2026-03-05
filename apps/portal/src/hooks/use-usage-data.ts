import { useMemo } from "react";
import { useESignUsage } from "./use-esign-usage";
import type { UsageCategoryData, UsageEvent, MonthlyAggregate } from "@/lib/usage-categories";

function useESignCategoryData(): UsageCategoryData {
  const {
    currentEvents,
    currentCount,
    currentCost,
    unitCost,
    monthlyAggregates,
    isLoading,
    isLoadingHistory,
  } = useESignUsage();

  const events: UsageEvent[] = useMemo(
    () =>
      currentEvents.map((e) => ({
        id: e.id,
        category: "esign",
        ref: e.rental_ref,
        customerName: e.customer_name,
        unitCost: Number(e.unit_cost),
        currency: e.currency,
        createdAt: e.created_at,
      })),
    [currentEvents]
  );

  const aggregates: MonthlyAggregate[] = useMemo(
    () =>
      monthlyAggregates.map((a) => ({
        month: a.month,
        count: a.count,
        totalCost: a.total_cost,
      })),
    [monthlyAggregates]
  );

  return {
    currentCount,
    currentCost,
    unitCost,
    events,
    monthlyAggregates: aggregates,
    isLoading,
    isLoadingHistory,
  };
}

// Map of category key → hook. Add new categories here.
const CATEGORY_HOOKS: Record<string, () => UsageCategoryData> = {
  esign: useESignCategoryData,
  // Future: sms: useSMSCategoryData,
};

export function useUsageData(): Record<string, UsageCategoryData> {
  // Call all hooks unconditionally (React rules of hooks)
  const esign = CATEGORY_HOOKS.esign();
  // Future: const sms = CATEGORY_HOOKS.sms();

  return useMemo(
    () => ({
      esign,
      // Future: sms,
    }),
    [esign]
  );
}
