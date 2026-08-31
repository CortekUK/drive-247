"use client";

import { useQuery } from "@tanstack/react-query";

import { useTenant } from "@/contexts/TenantContext";
import { EMPTY_PROMOTIONS, fetchPromotions, type PromotionsResult } from "@/lib/cms/queries";

/**
 * The tenant's promotions, already flattened into card props.
 *
 * `configured` rides along because an empty list is ambiguous and the two
 * meanings want opposite screens: a tenant who has never created a promotion
 * should see the designed offers, a tenant whose campaigns have all ended
 * should see their own "check back soon" copy. See `PromotionsResult`.
 *
 * The tenant's `currency_code` is passed through because a fixed-amount
 * discount is money, and this platform is not dollars-only.
 */
export interface UsePromotionsResult extends PromotionsResult {
  isLoading: boolean;
}

export function usePromotions(seed?: PromotionsResult | null): UsePromotionsResult {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["promotions", tenant?.id, tenant?.currency_code],
    queryFn: () => fetchPromotions(tenant?.id ?? "", tenant?.currency_code ?? null),
    enabled: !!tenant,
    initialData: seed ?? undefined,
  });

  const result = query.data ?? EMPTY_PROMOTIONS;

  // The absence of data, not React Query's `isLoading` — see `use-cms.ts`.
  return { ...result, isLoading: query.data === undefined };
}
