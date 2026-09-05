"use client";

import { useQuery } from "@tanstack/react-query";

import { useTenant } from "@/contexts/TenantContext";
import { fetchTestimonials } from "@/lib/cms/queries";
import type { TestimonialItem } from "@/lib/cms/types";

/**
 * The tenant's customer quotes, from the `testimonials` table.
 *
 * One source feeds two very different bands: the two-up quote cards on
 * home/about/fleet and the five-across wall on /reviews. Both read this hook
 * and slice it themselves rather than each keeping its own copy — the operator
 * writes a testimonial once and it appears in both places.
 */
export interface UseTestimonialsResult {
  testimonials: TestimonialItem[];
  isLoading: boolean;
}

export function useTestimonials(
  seed?: readonly TestimonialItem[] | null,
): UseTestimonialsResult {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["testimonials", tenant?.id],
    queryFn: () => fetchTestimonials(tenant?.id ?? ""),
    enabled: !!tenant,
    initialData: seed ? [...seed] : undefined,
  });

  return {
    testimonials: query.data ?? [],
    // The absence of data, not React Query's `isLoading` — see `use-cms.ts`.
    isLoading: query.data === undefined,
  };
}
