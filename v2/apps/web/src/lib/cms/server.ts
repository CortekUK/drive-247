import { cache } from "react";
import { headers } from "next/headers";

import { supabase } from "@/integrations/supabase/client";
import { DEV_FALLBACK_TENANT_SLUG, TENANT_HEADER } from "@/lib/constants";

import { getSection } from "./merge";
import {
  fetchFaqs,
  fetchPageSections,
  fetchPromotions,
  fetchTestimonials,
  type PromotionsResult,
} from "./queries";
import type { CmsPageSlug, FaqItem, PageSections, TestimonialItem } from "./types";

/**
 * Server-side CMS loading. NOT a client module — it reads `next/headers` and
 * must only ever be called from a Server Component.
 *
 * Why the sections fetch on the server at all, when there are hooks right next
 * door: marketing copy that only exists after hydration is copy a crawler never
 * sees and a slow connection shows as a flash of placeholder text. The same
 * argument `fleet-seed.ts` makes for the vehicle list applies with more force
 * to the headline of the page.
 *
 * Every loader is wrapped in React's `cache()`, which dedupes by argument for
 * the lifetime of ONE request. The home page renders seven CMS-driven sections
 * and three of them read the `about` page's keys; without this that is three
 * identical queries. With it the whole page costs one tenant lookup plus one
 * query per distinct slug.
 */

export interface CmsTenant {
  id: string;
  currency_code: string | null;
}

/** The slug the middleware resolved for this request. */
export const getTenantSlug = cache(async (): Promise<string | null> => {
  const requestHeaders = await headers();
  return requestHeaders.get(TENANT_HEADER) ?? DEV_FALLBACK_TENANT_SLUG;
});

/**
 * Slug -> tenant. Suspended tenants resolve too, matching `TenantContext` and
 * `fleet-seed`: their site should say "unavailable", not quietly render as an
 * untenanted shell with placeholder copy.
 */
export const resolveTenant = cache(async (): Promise<CmsTenant | null> => {
  const slug = await getTenantSlug();
  if (!slug) return null;

  try {
    const { data, error } = await supabase
      .from("tenants")
      .select("id, currency_code")
      .eq("slug", slug)
      .in("status", ["active", "suspended"])
      .maybeSingle()
      .overrideTypes<CmsTenant, { merge: false }>();

    if (error) {
      console.error("[cms] tenant lookup failed", {
        slug,
        message: error.message,
        code: error.code,
      });
      return null;
    }

    return data ?? null;
  } catch (cause) {
    console.error("[cms] tenant lookup threw", { slug, cause });
    return null;
  }
});

export const loadPageSections = cache(
  async (slug: CmsPageSlug): Promise<PageSections> => {
    const tenant = await resolveTenant();
    if (!tenant) return {};
    return fetchPageSections(tenant.id, slug);
  },
);

/**
 * One section of one page, already merged over its typed default.
 *
 * This is the call almost every section makes. It cannot return null and it
 * cannot return a half-filled object: whatever happens upstream — no tenant, no
 * page row, a page the operator left in draft, a section they never touched —
 * the caller gets a complete `T`.
 */
export async function loadSection<T>(
  slug: CmsPageSlug,
  key: string,
  fallback: T,
): Promise<T> {
  return getSection(await loadPageSections(slug), key, fallback);
}

/**
 * The table-backed loaders return `null`, not `[]`, when there is no tenant to
 * scope to.
 *
 * The distinction is load-bearing downstream: these values are handed to the
 * client hooks as `initialData`, and React Query treats seeded data as fresh.
 * Seeding `[]` after a failed server lookup would therefore convince the
 * browser it already has the answer and suppress the refetch that would have
 * recovered. `null` seeds nothing and lets the client try again.
 */
export const loadTestimonials = cache(async (): Promise<TestimonialItem[] | null> => {
  const tenant = await resolveTenant();
  if (!tenant) return null;
  return fetchTestimonials(tenant.id);
});

export const loadFaqs = cache(async (): Promise<FaqItem[] | null> => {
  const tenant = await resolveTenant();
  if (!tenant) return null;
  return fetchFaqs(tenant.id);
});

export const loadPromotions = cache(async (): Promise<PromotionsResult | null> => {
  const tenant = await resolveTenant();
  if (!tenant) return null;
  return fetchPromotions(tenant.id, tenant.currency_code);
});
