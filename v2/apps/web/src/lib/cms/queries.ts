import { supabase } from "@/integrations/supabase/client";

import {
  formatDiscount,
  formatValidUntil,
  promoAccent,
  promoImage,
  splitPromoTitle,
} from "./format";
import type {
  CmsPageSlug,
  FaqItem,
  PageSections,
  PromoItem,
  TestimonialItem,
} from "./types";

/**
 * The four reads that back every CMS-driven section, written once and shared by
 * the server loaders and the React Query hooks.
 *
 * Sharing them is not tidiness. The server render and the client refetch feed
 * the SAME markup; if they mapped rows differently — a different badge, a
 * different order — React would discard the server HTML on hydration. One
 * mapper per source makes that impossible by construction.
 *
 * None of these throw. A CMS outage must degrade a section to its designed
 * fallback copy, never to an error boundary that eats the rest of the page.
 */

/* ------------------------------------------------------------ page sections */

interface SectionRow {
  section_key: string;
  content: unknown;
  /** Pending edit from the portal's visual editor; only selected in draft mode. */
  draft_content?: unknown;
  is_visible: boolean | null;
  display_order: number | null;
}

interface PageRow {
  id: string;
  slug: string;
  cms_page_sections: SectionRow[] | null;
}

/**
 * ONE round-trip per page slug: the page row and every section it owns, via a
 * PostgREST embed. Eight sections on the home page are eight keys of one
 * response, not eight requests.
 *
 * `status = 'published'` is enforced here rather than in the caller — a draft
 * page is content the operator has explicitly not released, and no section
 * should be able to opt out of that.
 */
export async function fetchPageSections(
  tenantId: string,
  slug: CmsPageSlug,
  options: {
    /**
     * Visual-editor mode: read each section's pending `draft_content` over its
     * live `content`, and include the page even when it is not published. The
     * public site NEVER passes this — see `isEditMode` in server.ts.
     */
    draft?: boolean;
  } = {},
): Promise<PageSections> {
  const columns = options.draft
    ? "section_key, content, draft_content, is_visible, display_order"
    : "section_key, content, is_visible, display_order";
  try {
    let query = supabase
      .from("cms_pages")
      .select(`id, slug, cms_page_sections(${columns})`)
      .eq("tenant_id", tenantId)
      .eq("slug", slug);
    if (!options.draft) query = query.eq("status", "published");

    const { data, error } = await query
      .limit(1)
      .maybeSingle()
      .overrideTypes<PageRow, { merge: false }>();

    if (error) {
      console.error("[cms] page query failed", {
        slug,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return {};
    }

    return sectionsFromRows(data?.cms_page_sections ?? null);
  } catch (cause) {
    console.error("[cms] page query threw", { slug, cause });
    return {};
  }
}

/** Visible sections only, in `display_order`, keyed by `section_key`. */
export function sectionsFromRows(rows: SectionRow[] | null): PageSections {
  if (!rows) return {};

  const ordered = [...rows]
    // `is_visible` is nullable; a row that predates the column is visible.
    .filter((row) => row.is_visible !== false)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  const map: Record<string, unknown> = {};
  for (const row of ordered) {
    // `draft_content` is only present on the row when it was selected (edit
    // mode) AND the operator has a pending edit; otherwise the live content.
    map[row.section_key] = row.draft_content ?? row.content;
  }
  return map;
}

/* ------------------------------------------------------------- testimonials */

interface TestimonialRow {
  id: string;
  author: string;
  company_name: string | null;
  review: string;
  stars: number | null;
  created_at: string | null;
}

/**
 * `testimonials` has neither `display_order` nor `is_active` — checked against
 * the live schema, not assumed — so the only stable ordering is the one the
 * operator created them in.
 */
export async function fetchTestimonials(tenantId: string): Promise<TestimonialItem[]> {
  try {
    const { data, error } = await supabase
      .from("testimonials")
      .select("id, author, company_name, review, stars, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true, nullsFirst: false })
      .limit(48)
      .overrideTypes<TestimonialRow[], { merge: false }>();

    if (error) {
      console.error("[cms] testimonials query failed", {
        message: error.message,
        code: error.code,
      });
      return [];
    }

    return (data ?? [])
      .filter((row) => row.review.trim() !== "")
      .map((row) => ({
        id: row.id,
        quote: row.review,
        author: row.author,
        source: (row.company_name ?? "").trim(),
        stars: row.stars ?? 5,
      }));
  } catch (cause) {
    console.error("[cms] testimonials query threw", cause);
    return [];
  }
}

/* ---------------------------------------------------------------------- faqs */

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  display_order: number | null;
}

export async function fetchFaqs(tenantId: string): Promise<FaqItem[]> {
  try {
    const { data, error } = await supabase
      .from("faqs")
      .select("id, question, answer, display_order")
      .eq("tenant_id", tenantId)
      // `is_active` is nullable, so `.eq(..., true)` would silently drop every
      // row written before the column existed. `not.is.false` keeps them.
      .not("is_active", "is", false)
      .order("display_order", { ascending: true, nullsFirst: false })
      .limit(50)
      .overrideTypes<FaqRow[], { merge: false }>();

    if (error) {
      console.error("[cms] faqs query failed", {
        message: error.message,
        code: error.code,
      });
      return [];
    }

    return (data ?? [])
      .filter((row) => row.question.trim() !== "")
      .map((row) => ({ id: row.id, question: row.question, answer: row.answer }));
  } catch (cause) {
    console.error("[cms] faqs query threw", cause);
    return [];
  }
}

/* --------------------------------------------------------------- promotions */

interface PromotionRow {
  id: string;
  title: string;
  description: string;
  discount_type: string;
  discount_value: number;
  start_date: string;
  end_date: string;
  image_url: string | null;
  is_active: boolean | null;
}

/**
 * Promotions, plus the one bit the card grid cannot infer from an empty list:
 * whether the operator has ANY promotions at all.
 *
 * Without it, "this tenant has never used promotions" and "this tenant's four
 * promotions all ended last week" both arrive as `[]`, and the section has to
 * pick one wrong answer for both — designed fallback offers for the operator
 * who ran a campaign, or an empty page for the one who never has.
 */
export interface PromotionsResult {
  items: PromoItem[];
  /** The tenant has promotion rows, whether or not any are currently running. */
  configured: boolean;
}

export const EMPTY_PROMOTIONS: PromotionsResult = { items: [], configured: false };

export async function fetchPromotions(
  tenantId: string,
  currencyCode: string | null,
): Promise<PromotionsResult> {
  try {
    const { data, error } = await supabase
      .from("promotions")
      .select("id, title, description, discount_type, discount_value, start_date, end_date, image_url, is_active")
      .eq("tenant_id", tenantId)
      .order("start_date", { ascending: true, nullsFirst: false })
      .limit(24)
      .overrideTypes<PromotionRow[], { merge: false }>();

    if (error) {
      console.error("[cms] promotions query failed", {
        message: error.message,
        code: error.code,
      });
      return EMPTY_PROMOTIONS;
    }

    const rows = data ?? [];
    const now = Date.now();

    const live = rows.filter((row) => {
      if (row.is_active === false) return false;
      const ends = Date.parse(row.end_date);
      const starts = Date.parse(row.start_date);
      if (!Number.isNaN(ends) && ends < now) return false;
      if (!Number.isNaN(starts) && starts > now) return false;
      return true;
    });

    return {
      configured: rows.length > 0,
      items: live.map((row, index) => promoItemFromRow(row, index, currencyCode)),
    };
  } catch (cause) {
    console.error("[cms] promotions query threw", cause);
    return EMPTY_PROMOTIONS;
  }
}

function promoItemFromRow(
  row: PromotionRow,
  index: number,
  currencyCode: string | null,
): PromoItem {
  const { badge, label } = splitPromoTitle(row.title);
  return {
    id: row.id,
    badge,
    label,
    discount: formatDiscount(row.discount_type, row.discount_value, currencyCode),
    caption: row.description,
    validUntil: formatValidUntil(row.end_date),
    image: promoImage(row.image_url, index),
    // The table has no alt-text column. The promo's own name is a truer
    // description of the artwork than a generic "promotion image".
    imageAlt: row.title,
    accent: promoAccent(index),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Blog
 * ═════════════════════════════════════════════════════════════════════════ */

export interface BlogPostSummary {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featuredImageUrl: string | null;
  authorName: string | null;
  publishedAt: string | null;
  readingTimeMinutes: number | null;
}

export interface BlogPostFull extends BlogPostSummary {
  content: string;
  metaTitle: string | null;
  metaDescription: string | null;
  noindex: boolean;
}

/* Only `published` rows, always. A draft is the operator's working copy — the
   Portal list shows Northwind's one post as Draft, and it must not be public
   simply because the site knows how to render posts now. */
const PUBLIC_POST_COLUMNS =
  "id, title, slug, excerpt, featured_image_url, author_name, published_at, reading_time_minutes";

interface PostRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  featured_image_url: string | null;
  author_name: string | null;
  published_at: string | null;
  reading_time_minutes: number | null;
  content?: string;
  meta_title?: string | null;
  meta_description?: string | null;
  noindex?: boolean;
}

function toSummary(row: PostRow): BlogPostSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    featuredImageUrl: row.featured_image_url,
    authorName: row.author_name,
    publishedAt: row.published_at,
    readingTimeMinutes: row.reading_time_minutes,
  };
}

export async function fetchBlogPosts(tenantId: string): Promise<BlogPostSummary[]> {
  try {
    const { data, error } = await supabase
      .from("blog_posts")
      .select(PUBLIC_POST_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(48)
      .overrideTypes<PostRow[], { merge: false }>();

    if (error) {
      console.error("[cms] blog list query failed", {
        message: error.message,
        code: error.code,
      });
      return [];
    }

    return (data ?? []).map(toSummary);
  } catch (cause) {
    console.error("[cms] blog list threw", cause);
    return [];
  }
}

export async function fetchBlogPost(
  tenantId: string,
  slug: string,
): Promise<BlogPostFull | null> {
  try {
    const { data, error } = await supabase
      .from("blog_posts")
      .select(`${PUBLIC_POST_COLUMNS}, content, meta_title, meta_description, noindex`)
      // Tenant AND slug: slugs are only unique within a tenant, so dropping the
      // tenant filter would serve one operator's post on another's domain.
      .eq("tenant_id", tenantId)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle()
      .overrideTypes<PostRow, { merge: false }>();

    if (error || !data) {
      if (error) {
        console.error("[cms] blog post query failed", {
          slug,
          message: error.message,
          code: error.code,
        });
      }
      return null;
    }

    return {
      ...toSummary(data),
      content: data.content ?? "",
      metaTitle: data.meta_title ?? null,
      metaDescription: data.meta_description ?? null,
      noindex: data.noindex === true,
    };
  } catch (cause) {
    console.error("[cms] blog post threw", cause);
    return null;
  }
}
