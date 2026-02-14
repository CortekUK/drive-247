"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useCMSPages } from "@/hooks/use-cms-pages";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Globe, FileText, Edit, Eye, Clock, CheckCircle } from "lucide-react";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { formatDistanceToNow } from "date-fns";

// Order pages to match website navigation
const PAGE_ORDER = ["home", "about", "fleet", "reviews", "promotions", "contact", "privacy", "terms", "site-settings"];

export default function CMS() {
  const router = useRouter();
  const { pages, isLoading, error, tenant } = useCMSPages();
  const { canEdit } = useManagerPermissions();
  const hasEditAccess = canEdit('cms');

  // Debug logging
  console.log("CMS Debug:", { tenant: tenant?.slug, tenantId: tenant?.id, pagesCount: pages.length, error });

  // Sort pages according to navigation order
  const sortedPages = useMemo(() => {
    return [...pages].sort((a, b) => {
      const indexA = PAGE_ORDER.indexOf(a.slug);
      const indexB = PAGE_ORDER.indexOf(b.slug);
      const orderA = indexA === -1 ? PAGE_ORDER.length : indexA;
      const orderB = indexB === -1 ? PAGE_ORDER.length : indexB;
      return orderA - orderB;
    });
  }, [pages]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-3xl font-display font-bold text-gradient-metal mb-2">
          Website Content
        </h1>
        <p className="text-muted-foreground">
          Manage the content displayed on the customer website
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {sortedPages.map((page) => (
          <Card
            key={page.id}
            className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 flex flex-col h-full"
            onClick={() => router.push(`/cms/${page.slug}`)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{page.name}</CardTitle>
                </div>
                <Badge
                  variant={page.status === "published" ? "default" : "secondary"}
                  className={
                    page.status === "published"
                      ? "bg-green-500/20 text-green-600 hover:bg-green-500/30"
                      : ""
                  }
                >
                  {page.status === "published" ? (
                    <CheckCircle className="h-3 w-3 mr-1" />
                  ) : (
                    <Clock className="h-3 w-3 mr-1" />
                  )}
                  {page.status === "published" ? "Published" : "Draft"}
                </Badge>
              </div>
              {page.description && (
                <CardDescription className="mt-2">{page.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium">Last updated: </span>
                  {formatDistanceToNow(new Date(page.updated_at), { addSuffix: true })}
                </div>
                {page.published_at && (
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">Published: </span>
                    {formatDistanceToNow(new Date(page.published_at), { addSuffix: true })}
                  </div>
                )}
              </div>
              <Button variant="outline" className="w-full mt-auto pt-3">
                {hasEditAccess ? (
                  <><Edit className="h-4 w-4 mr-2" />Edit Content</>
                ) : (
                  <><Eye className="h-4 w-4 mr-2" />View Content</>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}

        {sortedPages.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Globe className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Pages Available</h3>
              <p className="text-muted-foreground text-center">
                No editable pages have been configured yet.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="bg-muted/50">
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>1. Edit Content:</strong> Click on a page card to edit its content sections.
          </p>
          <p>
            <strong>2. Save as Draft:</strong> Your changes are automatically saved as drafts.
          </p>
          <p>
            <strong>3. Publish:</strong> When ready, click "Publish" to make changes live on the website.
          </p>
          <p>
            <strong>4. Version History:</strong> View and restore previous versions if needed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
