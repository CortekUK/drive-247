"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { format, isAfter, isBefore } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useBlogPost, useBlogPosts, useBlogCategories, type BlogPost } from "@/hooks/useBlogPosts";
import { defaultPromotionsContent, mergeWithDefaults, usePageContent } from "@/hooks/usePageContent";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { createCompanyNameReplacer } from "@/utils/tenantName";
import { Icon } from "./icons";
import { useRootTheme } from "./theme-toggle";
import { Reveal } from "./reveal";
import { CBP, type CbpContent } from "./use-site-content";

/* ========================================================================== *
 * Promotions, FAQ and Blog.
 *
 * These are the existing site's three content features re-skinned — not
 * reimplemented. The data comes from the same tables (`promotions`, `faqs`,
 * `blog_posts`, `blog_categories`), through the same hooks (`useBlogPosts`,
 * `useBlogPost`, `useBlogCategories`, `usePageContent`), under the same rules:
 *
 *   · promotions — every row for the tenant, filtered and sorted client-side,
 *                  with the CMS "how it works", "empty state" and "terms"
 *                  sections below the grid
 *   · faq        — active FAQs in `display_order`
 *   · blog       — published posts only, 9 to a page, category filter, and the
 *                  tenant's `blog_enabled` switch gating both routes
 *
 * Everything an operator edits in the portal already drives these pages; there
 * is no new field, table or workflow here, and nothing about any one operator
 * is written into the code.
 * ========================================================================== */

/* ---------------------------------------------------------------- shared -- */

function EmptyState({
  icon, title, children, action,
}: {
  icon: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="cbp-card mx-auto flex max-w-[34rem] flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="text-[15px] font-bold text-[var(--ink)]">{title}</p>
      {children && <p className="text-[13.5px] leading-relaxed text-[var(--body)]">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function CardSkeletons({ n = 6 }: { n?: number }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} className="cbp-card overflow-hidden">
          <div className="cbp-skeleton aspect-[16/9] w-full !rounded-none" />
          <div className="flex flex-col gap-2 p-5">
            <div className="cbp-skeleton h-4 w-4/5" />
            <div className="cbp-skeleton h-3 w-full" />
            <div className="cbp-skeleton h-3 w-3/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Card art. The gradient sits behind every image rather than only replacing a
    missing one, so an operator's dead image URL degrades to the placeholder
    instead of a broken-image glyph. */
const gradientFill = { background: "linear-gradient(150deg, var(--grad-from), var(--grad-to))" };
const hideBrokenImage = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = "none";
};

/* ========================================================================== */
/* PROMOTIONS                                                                 */
/* ========================================================================== */

interface Promotion {
  id: string;
  title: string;
  description: string;
  discount_type: string;
  discount_value: number;
  start_date: string | null;
  end_date: string | null;
  promo_code: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

type PromoStatus = "active" | "scheduled" | "expired" | "inactive";

/**
 * The same status rule the existing page and the portal both apply: the
 * operator's `is_active` switch first, then the date window.
 */
const promoStatus = (p: Promotion): PromoStatus => {
  const now = new Date();
  if (!p.is_active) return "inactive";
  if (p.end_date && isAfter(now, new Date(p.end_date))) return "expired";
  if (p.start_date && isBefore(now, new Date(p.start_date))) return "scheduled";
  return "active";
};

const validity = (p: Promotion, long = false) => {
  const full = long ? "MMMM d, yyyy" : "MMM d, yyyy";
  if (p.start_date && p.end_date) {
    return `${format(new Date(p.start_date), long ? "MMMM d" : "MMM d")} – ${format(new Date(p.end_date), full)}`;
  }
  if (p.end_date) return `Valid until ${format(new Date(p.end_date), full)}`;
  return "Available now — no expiry";
};

const discountLabel = (p: Promotion) =>
  p.discount_type === "percentage" ? `${p.discount_value}% OFF` : `$${p.discount_value} OFF`;

export function PromotionsPage({ c }: { c: CbpContent }) {
  const { tenant } = useTenant();
  const [statusFilter, setStatusFilter] = useState<"all" | PromoStatus>("all");
  const [sortBy, setSortBy] = useState<"newest" | "ending_soon">("newest");
  const [selected, setSelected] = useState<Promotion | null>(null);

  // The CMS sections for this page, read through the existing hook and merged
  // with the existing defaults, so the portal keeps editing the same content it
  // always did. `rename` swaps the platform's placeholder company name for this
  // tenant's — the same treatment the existing page gives its SEO strings.
  const { data: rawContent } = usePageContent("promotions");
  const content = mergeWithDefaults(rawContent, defaultPromotionsContent);
  const rename = useMemo(() => createCompanyNameReplacer(c.name), [c.name]);

  const { data: promotions = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["cbp-promotions", tenant?.id],
    enabled: !!tenant?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Promotion[]> => {
      const { data, error } = await supabase
        .from("promotions")
        .select("*")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Promotion[];
    },
  });

  const shown = useMemo(() => {
    const list = promotions.filter(p => statusFilter === "all" || promoStatus(p) === statusFilter);
    return [...list].sort((a, b) => {
      if (sortBy === "ending_soon") {
        // An offer with no end date has nothing to run out, so it sorts last.
        const ae = a.end_date ? new Date(a.end_date).getTime() : Infinity;
        const be = b.end_date ? new Date(b.end_date).getTime() : Infinity;
        return ae - be;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [promotions, statusFilter, sortBy]);

  const steps = content.how_it_works?.steps ?? [];
  const terms = content.terms?.terms ?? [];

  return (
    <>
      <section className="cbp-wrap py-10 sm:py-12">
        {/* The same two controls the existing page offers. */}
        <Reveal className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter promotions by status"
            className="cbp-select-native"
          >
            <option value="all">All offers</option>
            <option value="active">Active</option>
            <option value="scheduled">Scheduled</option>
            <option value="expired">Expired</option>
          </select>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Sort promotions"
            className="cbp-select-native"
          >
            <option value="newest">Newest first</option>
            <option value="ending_soon">Ending soon</option>
          </select>
        </Reveal>

        {isLoading ? (
          <CardSkeletons />
        ) : isError ? (
          <EmptyState
            icon="gift"
            title="We couldn't load offers just now"
            action={<button type="button" onClick={() => refetch()} className="cbp-btn cbp-btn-primary">Try again</button>}
          >
            Please check your connection and try again.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState
            icon="gift"
            title={rename(
              statusFilter === "active"
                ? content.empty_state?.title_active
                : content.empty_state?.title_default,
            )}
            action={
              content.empty_state?.button_text ? (
                <Link href={`${CBP}/fleet`} className="cbp-btn cbp-btn-primary">
                  {rename(content.empty_state.button_text)}
                </Link>
              ) : undefined
            }
          >
            {rename(content.empty_state?.description)}
          </EmptyState>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((p, i) => (
              <Reveal as="li" key={p.id} delay={(i % 3) * 70}>
                <PromoCard p={p} onDetails={() => setSelected(p)} />
              </Reveal>
            ))}
          </ul>
        )}
      </section>

      {/* How promotions work — CMS section. */}
      {(content.how_it_works?.title || steps.length > 0) && (
        <section className="bg-[var(--wash)] py-14 sm:py-16">
          <div className="cbp-wrap">
            <Reveal className="mx-auto max-w-[42rem] text-center">
              {content.how_it_works?.title && <h2 className="cbp-h2">{rename(content.how_it_works.title)}</h2>}
              {content.how_it_works?.subtitle && (
                <p className="cbp-body mt-3">{rename(content.how_it_works.subtitle)}</p>
              )}
            </Reveal>
            {steps.length > 0 && (
              <ul className="mt-10 grid gap-5 sm:grid-cols-3">
                {steps.map((step, i) => (
                  <Reveal as="li" key={i} delay={i * 80}>
                    <div className="cbp-card h-full p-6 text-center">
                      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--brand-soft)] text-[18px] font-extrabold text-[var(--brand)]">
                        {step.number || i + 1}
                      </span>
                      <h3 className="cbp-h3 mt-4">{rename(step.title)}</h3>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--body)]">
                        {rename(step.description)}
                      </p>
                    </div>
                  </Reveal>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* Fine print — CMS section. */}
      {terms.length > 0 && (
        <section className="cbp-wrap py-14 sm:py-16">
          <Reveal className="cbp-card mx-auto max-w-[46rem] p-7">
            <h3 className="cbp-h3">{rename(content.terms?.title) || "Terms & Conditions"}</h3>
            <ul className="mt-4 flex flex-col gap-2.5">
              {terms.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[var(--body)]">
                  <Icon name="check" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                  <span>{rename(t)}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>
      )}

      <PromoDetails promo={selected} onClose={() => setSelected(null)} />
    </>
  );
}

/** Status pill. An inactive promotion carries none, as on the existing page. */
function StatusPill({ status }: { status: PromoStatus }) {
  if (status === "inactive") return null;
  const label = status === "active" ? "Active" : status === "scheduled" ? "Scheduled" : "Expired";
  return <span className={`cbp-status cbp-status--${status}`}>{label}</span>;
}

function PromoCard({ p, onDetails }: { p: Promotion; onDetails: () => void }) {
  const status = promoStatus(p);
  const isActive = status === "active";

  return (
    <article className={`cbp-card flex h-full flex-col overflow-hidden ${isActive ? "cbp-lift" : "opacity-70"}`}>
      <div className="cbp-photo relative aspect-[16/9] w-full" style={gradientFill}>
        <span className="absolute inset-0 grid place-items-center text-white/85">
          <Icon name="gift" className="h-9 w-9" />
        </span>
        {p.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.image_url} alt="" loading="lazy" decoding="async" onError={hideBrokenImage} />
        )}
        <span className="cbp-badge absolute right-4 top-4">{discountLabel(p)}</span>
        <span className="absolute left-4 top-4"><StatusPill status={status} /></span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-5">
        <h3 className="cbp-h3">{p.title}</h3>
        {p.description && (
          <p className="line-clamp-2 whitespace-pre-line text-[13px] leading-relaxed text-[var(--body)]">
            {p.description}
          </p>
        )}
        <p className="flex items-center gap-2 text-[11.5px] text-[var(--meta)]">
          <Icon name="calendar" className="h-3.5 w-3.5 shrink-0" />
          {validity(p)}
        </p>
        {p.promo_code && (
          <p className="flex items-center gap-2">
            <Icon name="tag" className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
            <span className="cbp-chip cbp-num !bg-[var(--brand-soft)] !font-bold !text-[var(--brand)]">
              {p.promo_code}
            </span>
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-4">
          {isActive ? (
            <Link href={`${CBP}#booking`} className="cbp-btn cbp-btn-primary flex-1">
              Book now <Icon name="arrow" className="cbp-arrow h-4 w-4" />
            </Link>
          ) : (
            <button type="button" disabled className="cbp-btn cbp-btn-primary flex-1">
              {status === "scheduled" ? "Starts soon" : "Offer ended"}
            </button>
          )}
          <button type="button" onClick={onDetails} aria-label={`Details for ${p.title}`} className="cbp-icon-btn">
            <Icon name="info" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

function PromoDetails({ promo, onClose }: { promo: Promotion | null; onClose: () => void }) {
  const theme = useRootTheme(!!promo);

  return (
    <Dialog.Root open={!!promo} onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="cbp cbp-overlay" />
        {/* The portal lands outside the site's root, so the content carries
            `cbp` to pick the design tokens up. `.cbp-modal` re-clears the
            root's min-height, which would otherwise stretch the dialog. */}
        <Dialog.Content className="cbp cbp-modal" data-theme={theme} aria-describedby={undefined}>
          {promo && (
            <>
              <div className="flex items-start justify-between gap-4">
                <Dialog.Title className="cbp-h2 !text-[21px]">{promo.title}</Dialog.Title>
                <Dialog.Close aria-label="Close" className="cbp-icon-btn shrink-0">
                  <Icon name="close" className="h-4 w-4" />
                </Dialog.Close>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="cbp-badge">{discountLabel(promo)}</span>
                {promo.promo_code && (
                  <span className="cbp-chip cbp-num !bg-[var(--brand-soft)] !font-bold !text-[var(--brand)]">
                    {promo.promo_code}
                  </span>
                )}
                <StatusPill status={promoStatus(promo)} />
              </div>

              {promo.image_url && (
                <div className="cbp-photo mt-5 aspect-[16/9] w-full overflow-hidden rounded-[var(--r-md)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={promo.image_url} alt="" decoding="async" />
                </div>
              )}

              {promo.description && (
                <div className="mt-5">
                  <h4 className="text-[13px] font-bold text-[var(--ink)]">Description</h4>
                  <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-[var(--body)]">
                    {promo.description}
                  </p>
                </div>
              )}

              <div className="mt-5">
                <h4 className="text-[13px] font-bold text-[var(--ink)]">Validity period</h4>
                <p className="mt-1.5 text-[13.5px] text-[var(--body)]">{validity(promo, true)}</p>
              </div>

              <div className="mt-6">
                {promoStatus(promo) === "active" ? (
                  <Link href={`${CBP}#booking`} className="cbp-btn cbp-btn-primary w-full" onClick={onClose}>
                    Book now <Icon name="arrow" className="cbp-arrow h-4 w-4" />
                  </Link>
                ) : (
                  <button type="button" disabled className="cbp-btn cbp-btn-primary w-full">
                    {promoStatus(promo) === "scheduled" ? "Starts soon" : "Offer ended"}
                  </button>
                )}
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ========================================================================== */
/* FAQ                                                                        */
/* ========================================================================== */

/**
 * The accordion is built on native `<details>`/`<summary>`: keyboard-operable,
 * screen-reader-announced and findable by the browser's own in-page search
 * without a line of JavaScript.
 *
 * The FAQPage structured data the existing /faq page emits is emitted here too,
 * so moving a tenant onto this site does not cost them the rich result.
 */
export function FaqPage({ c }: { c: CbpContent }) {
  useFaqSchema(c.faqs);

  return (
    <section className="cbp-wrap py-14 sm:py-16">
      {c.faqsLoading ? (
        <div className="mx-auto max-w-[46rem] space-y-3" aria-busy="true">
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="cbp-skeleton h-16 w-full" />)}
        </div>
      ) : c.faqs.length === 0 ? (
        <EmptyState icon="chat" title="No FAQs have been added yet">
          Please check back soon.
        </EmptyState>
      ) : (
        <ul className="mx-auto flex max-w-[46rem] flex-col gap-3">
          {c.faqs.map((f, i) => (
            <Reveal as="li" key={f.id} delay={Math.min(i, 6) * 40}>
              <details className="cbp-faq">
                <summary className="cbp-faq-q">
                  <span className="min-w-0 flex-1">{f.question}</span>
                  <Icon name="chevron" className="cbp-faq-caret" />
                </summary>
                <div className="cbp-faq-a">{f.answer}</div>
              </details>
            </Reveal>
          ))}
        </ul>
      )}

      {/* The existing page's closing card, with the tenant's own phone number. */}
      <Reveal className="cbp-card mx-auto mt-12 max-w-[46rem] p-8 text-center">
        <h2 className="cbp-h3">Still have questions?</h2>
        <p className="cbp-body mt-2">Our team is here to help. Contact us for personalised assistance.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {c.phoneHref && (
            <a href={`tel:${c.phoneHref}`} className="cbp-btn cbp-btn-primary">
              <Icon name="phone" className="h-4 w-4" /> Call {c.phoneDisplay}
            </a>
          )}
          <Link href={`${CBP}/contact`} className="cbp-btn cbp-btn-ghost">
            Contact us <Icon name="arrow" className="cbp-arrow h-4 w-4" />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

/** FAQPage JSON-LD, mounted and torn down with the page — as on /faq. */
function useFaqSchema(faqs: CbpContent["faqs"]) {
  useEffect(() => {
    if (typeof document === "undefined" || faqs.length === 0) return;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.text = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map(f => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [faqs]);
}

/* ========================================================================== */
/* BLOG LISTING                                                               */
/* ========================================================================== */

/** The existing listing's page size. */
const PAGE_SIZE = 9;

const postDate = (iso: string | null) => (iso ? format(new Date(iso), "MMM d, yyyy") : null);

export function BlogPage({ c }: { c: CbpContent }) {
  const [page, setPage] = useState(1);
  const [categorySlug, setCategorySlug] = useState<string | undefined>();

  const gated = useBlogGate(c);
  const { data, isLoading, isError, refetch } = useBlogPosts({ categorySlug, page, pageSize: PAGE_SIZE });
  const { data: categories = [] } = useBlogCategories();

  if (gated) return null;

  const posts = data?.posts ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <section className="cbp-wrap py-10 sm:py-12">
      {categories.length > 0 && (
        <Reveal className="mb-9 flex flex-wrap justify-center gap-2">
          <FilterChip on={!categorySlug} onClick={() => { setCategorySlug(undefined); setPage(1); }}>
            All posts
          </FilterChip>
          {categories.map(cat => (
            <FilterChip
              key={cat.id}
              on={categorySlug === cat.slug}
              onClick={() => { setCategorySlug(cat.slug); setPage(1); }}
            >
              {cat.name}
            </FilterChip>
          ))}
        </Reveal>
      )}

      {isLoading ? (
        <CardSkeletons />
      ) : isError ? (
        <EmptyState
          icon="doc"
          title="We couldn't load articles just now"
          action={<button type="button" onClick={() => refetch()} className="cbp-btn cbp-btn-primary">Try again</button>}
        >
          Please check your connection and try again.
        </EmptyState>
      ) : posts.length === 0 ? (
        <EmptyState icon="doc" title={categorySlug ? "No posts in this category" : "Coming soon"}>
          {categorySlug
            ? "Try a different category, or check back later."
            : "We're working on new content. Check back soon."}
        </EmptyState>
      ) : (
        <>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post, i) => (
              <Reveal as="li" key={post.id} delay={(i % 3) * 70}>
                <ArticleCard post={post} />
              </Reveal>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav className="mt-12 flex items-center justify-center gap-4" aria-label="Blog pages">
              <button
                type="button"
                className="cbp-btn cbp-btn-ghost"
                disabled={page <= 1}
                onClick={() => { setPage(p => p - 1); scrollToTop(); }}
              >
                <Icon name="chevronLeft" className="h-4 w-4" /> Previous
              </button>
              <span className="cbp-num text-[12.5px] text-[var(--meta)]" aria-live="polite">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="cbp-btn cbp-btn-ghost"
                disabled={page >= totalPages}
                onClick={() => { setPage(p => p + 1); scrollToTop(); }}
              >
                Next <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

const scrollToTop = () => {
  if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
};

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on}
      className={`rounded-full px-4 py-2 text-[13px] font-semibold transition ${
        on
          ? "bg-[linear-gradient(95deg,var(--grad-from),var(--grad-to))] text-white shadow-[var(--shadow-brand)]"
          : "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
      }`}
    >
      {children}
    </button>
  );
}

function ArticleCard({ post }: { post: BlogPost }) {
  return (
    <Link href={`${CBP}/blog/${post.slug}`} className="cbp-card cbp-lift flex h-full flex-col overflow-hidden">
      <div className="cbp-photo relative aspect-[16/10] w-full" style={gradientFill}>
        <span className="absolute inset-0 grid place-items-center text-white/85">
          <Icon name="doc" className="h-8 w-8" />
        </span>
        {post.featured_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.featured_image_url} alt="" loading="lazy" decoding="async" onError={hideBrokenImage} />
        )}
        {post.category && <span className="cbp-badge absolute left-4 top-4">{post.category.name}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        {postDate(post.published_at) && (
          <span className="text-[11.5px] text-[var(--meta)]">{postDate(post.published_at)}</span>
        )}
        <h3 className="cbp-h3 line-clamp-2">{post.title}</h3>
        {post.excerpt && <p className="line-clamp-3 text-[13px] leading-relaxed text-[var(--body)]">{post.excerpt}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <span className="flex flex-wrap items-center gap-3 text-[11.5px] text-[var(--meta)]">
            {post.author_name && (
              <span className="flex items-center gap-1"><Icon name="user" className="h-3 w-3" />{post.author_name}</span>
            )}
            {!!post.reading_time_minutes && (
              <span className="flex items-center gap-1">
                <Icon name="clock" className="h-3 w-3" />{post.reading_time_minutes} min read
              </span>
            )}
          </span>
          <Icon name="arrow" className="h-4 w-4 text-[var(--brand)]" />
        </div>
      </div>
    </Link>
  );
}

/* ========================================================================== */
/* BLOG ARTICLE                                                               */
/* ========================================================================== */

export function ArticlePage({ slug, c }: { slug: string; c: CbpContent }) {
  const gated = useBlogGate(c);
  const { data: post, isLoading, error } = useBlogPost(slug);
  const html = useMemo(() => (post?.content ? sanitizeHtml(post.content) : ""), [post?.content]);

  if (gated) return null;

  if (isLoading) {
    return (
      <section className="cbp-wrap py-14 sm:py-16" aria-busy="true">
        <div className="mx-auto max-w-[46rem] space-y-4">
          <div className="cbp-skeleton h-9 w-4/5" />
          <div className="cbp-skeleton h-4 w-2/5" />
          <div className="cbp-skeleton aspect-[16/9] w-full" />
          {[0, 1, 2, 3].map(i => <div key={i} className="cbp-skeleton h-4 w-full" />)}
        </div>
      </section>
    );
  }

  // `useBlogPost` selects with `.single()`, so a slug matching nothing
  // published — a draft, a deleted post, a typed URL — arrives as an error
  // rather than as null. Both mean the same thing to the reader.
  if (error || !post) {
    return (
      <section className="cbp-wrap py-14 sm:py-16">
        <EmptyState
          icon="doc"
          title="Post not found"
          action={
            <Link href={`${CBP}/blog`} className="cbp-btn cbp-btn-primary">
              <Icon name="chevronLeft" className="h-4 w-4" /> Back to blog
            </Link>
          }
        >
          The article you&apos;re looking for doesn&apos;t exist or has been removed.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="cbp-wrap py-10 sm:py-12">
      <article className="mx-auto max-w-[46rem]">
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--meta)]">
          <Link href={CBP} className="transition-colors hover:text-[var(--brand)]">Home</Link>
          <Icon name="chevronRight" className="h-3 w-3" />
          <Link href={`${CBP}/blog`} className="transition-colors hover:text-[var(--brand)]">Blog</Link>
          <Icon name="chevronRight" className="h-3 w-3" />
          <span className="truncate text-[var(--ink-2)]">{post.title}</span>
        </nav>

        {post.category && <p className="cbp-eyebrow">{post.category.name}</p>}
        <h1 className="cbp-display mt-3 !text-[clamp(1.7rem,3.4vw,2.5rem)]">{post.title}</h1>

        <p className="mt-4 flex flex-wrap items-center gap-4 text-[12.5px] text-[var(--meta)]">
          {post.author_name && (
            <span className="flex items-center gap-1.5">
              <Icon name="user" className="h-3.5 w-3.5 text-[var(--brand)]" />{post.author_name}
            </span>
          )}
          {post.published_at && (
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" className="h-3.5 w-3.5 text-[var(--brand)]" />
              {format(new Date(post.published_at), "MMMM d, yyyy")}
            </span>
          )}
          {!!post.reading_time_minutes && (
            <span className="flex items-center gap-1.5">
              <Icon name="clock" className="h-3.5 w-3.5 text-[var(--brand)]" />{post.reading_time_minutes} min read
            </span>
          )}
        </p>

        {post.featured_image_url && (
          <div className="cbp-photo mt-7 aspect-[16/9] w-full overflow-hidden rounded-[var(--r-lg)]" style={gradientFill}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.featured_image_url} alt={post.title} decoding="async" onError={hideBrokenImage} />
          </div>
        )}

        {post.excerpt && (
          <p className="mt-7 text-[16px] font-medium leading-relaxed text-[var(--ink-2)]">{post.excerpt}</p>
        )}

        {html && (
          // Operator-authored rich text from the portal editor, run through the
          // app's own `sanitizeHtml` — the guard /blog/[slug] applies — and
          // styled by element in `.cbp-legal`, as the legal pages are.
          <div
            className="cbp-legal mt-7 text-[14.5px] leading-relaxed text-[var(--body)]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-7">
          <Link href={`${CBP}/blog`} className="cbp-btn cbp-btn-ghost">
            <Icon name="chevronLeft" className="h-4 w-4" /> Back to blog
          </Link>
          {post.category && (
            <Link href={`${CBP}/blog`} className="cbp-link !text-[13px]">
              More in {post.category.name} <Icon name="chevronRight" className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </article>
    </section>
  );
}

/**
 * The tenant's `blog_enabled` switch, enforced as /blog and /blog/[slug]
 * enforce it: when it is off, the blog routes send the visitor home instead of
 * rendering. The redirect runs in an effect rather than during render, which is
 * where the existing pages call it — routing during render warns in React 18.
 */
function useBlogGate(c: CbpContent) {
  const { tenant } = useTenant();
  const router = useRouter();
  const off = !!tenant && !c.blogEnabled;

  useEffect(() => {
    if (off) router.replace(CBP);
  }, [off, router]);

  return off;
}
