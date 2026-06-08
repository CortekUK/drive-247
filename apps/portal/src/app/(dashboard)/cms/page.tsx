"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCMSPages } from "@/hooks/use-cms-pages";
import { Button } from "@/components/ui/button";
import { Globe, FileText, Edit, Eye, ArrowRight, PenLine } from "lucide-react";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { formatDistanceToNow } from "date-fns";
import { Tile, Eyebrow, StatusPill, SectionCard, EmptyState, Shimmer } from "@/components/bento";

// Order pages to match website navigation
const PAGE_ORDER = ["home", "about", "fleet", "reviews", "promotions", "contact", "privacy", "terms", "site-settings"];

export default function CMS() {
  const router = useRouter();
  const { pages, isLoading, error, tenant } = useCMSPages();
  const { canEdit } = useManagerPermissions();
  const hasEditAccess = canEdit('cms');

  // Debug logging
  console.log("CMS Debug:", { tenant: tenant?.slug, tenantId: tenant?.id, pagesCount: pages.length, error });

  // Sort pages according to navigation order, exclude blog (managed separately)
  const sortedPages = useMemo(() => {
    return [...pages]
      .filter((p) => p.slug !== "blog")
      .sort((a, b) => {
        const indexA = PAGE_ORDER.indexOf(a.slug);
        const indexB = PAGE_ORDER.indexOf(b.slug);
        const orderA = indexA === -1 ? PAGE_ORDER.length : indexA;
        const orderB = indexB === -1 ? PAGE_ORDER.length : indexB;
        return orderA - orderB;
      });
  }, [pages]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="space-y-2">
          <Shimmer className="h-8 w-48" />
          <Shimmer className="h-4 w-96" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Tile key={i} noMotion className="flex flex-col gap-3">
              <Shimmer className="h-5 w-32" />
              <Shimmer className="h-4 w-full" />
              <Shimmer className="h-9 w-full" />
            </Tile>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-5 md:space-y-6 p-4 md:p-6">
      <div>
        <Eyebrow>Content management</Eyebrow>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-foreground">
          Website Content
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the content displayed on the customer website
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sortedPages.map((page) => (
          <Tile
            key={page.id}
            interactive
            className="flex h-full flex-col gap-3"
            onClick={() => router.push(`/cms/${page.slug}`)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile-sm [background:var(--bento-tile-2)] text-[color:var(--bento-text-2)]">
                  <FileText className="h-4 w-4" />
                </span>
                <h3 className="text-base font-bold tracking-tight">{page.name}</h3>
              </div>
              <StatusPill tone={page.status === "published" ? "success" : "warn"} dot>
                {page.status === "published" ? "Published" : "Draft"}
              </StatusPill>
            </div>
            {page.description && (
              <p className="text-sm text-muted-foreground">{page.description}</p>
            )}
            <div className="mt-auto space-y-1 pt-1">
              <div className="text-xs text-muted-foreground">
                <span className="font-medium text-[color:var(--bento-text-2)]">Updated </span>
                {formatDistanceToNow(new Date(page.updated_at), { addSuffix: true })}
              </div>
              {page.published_at && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-[color:var(--bento-text-2)]">Published </span>
                  {formatDistanceToNow(new Date(page.published_at), { addSuffix: true })}
                </div>
              )}
            </div>
            <Button variant="outline" className="w-full">
              {hasEditAccess ? (
                <><Edit className="h-4 w-4 mr-2" />Edit Content</>
              ) : (
                <><Eye className="h-4 w-4 mr-2" />View Content</>
              )}
            </Button>
          </Tile>
        ))}

        {/* Blog Tile — accented feature surface */}
        <Tile
          variant="feature"
          interactive
          className="flex h-full flex-col gap-3"
          onClick={() => router.push("/cms/blog")}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tile-sm bg-white/10 text-white">
                <PenLine className="h-4 w-4" />
              </span>
              <h3 className="text-base font-bold tracking-tight text-white">Blog</h3>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[11.5px] font-bold text-white">
              <PenLine className="h-3 w-3" />
              Manage
            </span>
          </div>
          <p className="text-sm text-[color:var(--bento-feature-sub)]">
            Create and manage blog posts, categories, and SEO
          </p>
          <Button className="mt-auto w-full bg-white text-[color:var(--bento-feature-bg)] hover:bg-white/90">
            {hasEditAccess ? (
              <><Edit className="h-4 w-4 mr-2" />Manage Blog</>
            ) : (
              <><Eye className="h-4 w-4 mr-2" />View Blog</>
            )}
            <ArrowRight className="ml-auto h-4 w-4" />
          </Button>
        </Tile>

        {sortedPages.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={<Globe className="h-5 w-5" />}
              title="No Pages Available"
              description="No editable pages have been configured yet."
            />
          </div>
        )}
      </div>

      <SectionCard
        icon={<Globe className="h-4 w-4" />}
        title="How it works"
        description="Edit, save and publish content for your customer website."
      >
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">1. Edit Content:</strong> Click on a page card to edit its content sections.
          </p>
          <p>
            <strong className="text-foreground">2. Save as Draft:</strong> Your changes are automatically saved as drafts.
          </p>
          <p>
            <strong className="text-foreground">3. Publish:</strong> When ready, click &ldquo;Publish&rdquo; to make changes live on the website.
          </p>
          <p>
            <strong className="text-foreground">4. Version History:</strong> View and restore previous versions if needed.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
