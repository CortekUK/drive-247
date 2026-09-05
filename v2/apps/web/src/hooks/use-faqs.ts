"use client";

import { useQuery } from "@tanstack/react-query";

import { useTenant } from "@/contexts/TenantContext";
import { fetchFaqs } from "@/lib/cms/queries";
import type { FaqItem } from "@/lib/cms/types";

/**
 * The tenant's FAQs, active ones only, in the order they arranged them.
 *
 * `is_active` is filtered in the query rather than here: an operator who
 * retires a question expects it gone from the page, and shipping it to the
 * browser and hiding it in JS would still put it in the HTML.
 */
export interface UseFaqsResult {
  faqs: FaqItem[];
  isLoading: boolean;
}

export function useFaqs(seed?: readonly FaqItem[] | null): UseFaqsResult {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["faqs", tenant?.id],
    queryFn: () => fetchFaqs(tenant?.id ?? ""),
    enabled: !!tenant,
    initialData: seed ? [...seed] : undefined,
  });

  return {
    faqs: query.data ?? [],
    // The absence of data, not React Query's `isLoading` — see `use-cms.ts`.
    isLoading: query.data === undefined,
  };
}
