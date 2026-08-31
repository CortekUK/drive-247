"use client";

import { useQuery } from "@tanstack/react-query";

import { useTenant } from "@/contexts/TenantContext";
import { getSection } from "@/lib/cms/merge";
import { fetchPageSections } from "@/lib/cms/queries";
import type { CmsPageSlug, PageSections } from "@/lib/cms/types";

/**
 * A whole CMS page in ONE query: `cms_pages` joined to `cms_page_sections`,
 * reduced to `section_key -> content`.
 *
 * The shape matters more than it looks. A hook per section would put the home
 * page's eight sections on eight round-trips against the same row; this puts
 * them on one, and every section then reads its key out of the map for free.
 *
 * `seed` is the server render's copy of the same map (see `lib/cms/server.ts`).
 * Passing it makes the browser's first render byte-identical to the HTML it is
 * hydrating, and the live query takes over from there — the same contract
 * `useVehicles` has with `loadFleetSeed`.
 */
export interface UsePageSectionsResult {
  sections: PageSections;
  isLoading: boolean;
  /** Read one key, merged over its typed default. Never returns null. */
  section: <T>(key: string, fallback: T) => T;
}

export function usePageSections(
  slug: CmsPageSlug,
  seed?: PageSections | null,
): UsePageSectionsResult {
  const { tenant } = useTenant();

  const query = useQuery({
    queryKey: ["cms-page", slug, tenant?.id],
    queryFn: () => fetchPageSections(tenant?.id ?? "", slug),
    enabled: !!tenant,
    initialData: seed ?? undefined,
  });

  const sections = query.data ?? {};

  return {
    sections,
    // "Nothing to show yet" is the absence of data, NOT React Query's
    // `isLoading`. With `enabled: !!tenant` the query is idle — not loading —
    // while the tenant resolves on the client, so `isLoading` reports false,
    // then flips true once the fetch starts. A section keyed off that would
    // render its fallback, swap to a skeleton, and only then show the content.
    isLoading: query.data === undefined,
    section: <T,>(key: string, fallback: T): T => getSection(sections, key, fallback),
  };
}

/**
 * Sugar for the common case: one key of one page, typed by its fallback.
 *
 * Reach for `usePageSections` instead when a component needs two or more keys —
 * this calls it per key, and while React Query dedupes the request, the extra
 * subscriptions are pointless.
 */
export function useCmsSection<T>(
  slug: CmsPageSlug,
  key: string,
  fallback: T,
  seed?: PageSections | null,
): { content: T; isLoading: boolean } {
  const { section, isLoading } = usePageSections(slug, seed);
  return { content: section(key, fallback), isLoading };
}
