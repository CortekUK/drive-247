"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBlogPosts, useBlogCategories } from "@/hooks/useBlogPosts";
import { useTenant } from "@/contexts/TenantContext";
import { usePageContent } from "@/hooks/usePageContent";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Calendar, Clock, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { format } from "date-fns";
import SEO from "@/components/SEO";

const defaultBlogContent = {
  hero: { title: "Blog", subtitle: "Latest news, tips and insights" },
  seo: { title: "Blog", description: "Read our latest articles", keywords: "" },
};

export default function BlogListingClient() {
  const { tenant } = useTenant();
  const router = useRouter();
  const [currentPage, setCurrentPage] = useState(1);
  const [categorySlug, setCategorySlug] = useState<string | undefined>();

  // Redirect to home if blog is disabled
  if (tenant && !tenant.blog_enabled) {
    router.replace("/");
    return null;
  }

  const { data, isLoading } = useBlogPosts({
    categorySlug,
    page: currentPage,
    pageSize: 12,
  });

  const { data: categories = [] } = useBlogCategories();

  const { data: cmsContent } = usePageContent("blog");
  const content = { ...defaultBlogContent, ...cmsContent };
  const heroContent = (content as any).hero || defaultBlogContent.hero;
  const seoContent = (content as any).seo || defaultBlogContent.seo;

  const posts = data?.posts ?? [];
  const totalPages = data?.totalPages ?? 1;

  // Blog structured data
  const blogSchema = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: heroContent.title,
    description: seoContent.description,
    url: typeof window !== "undefined" ? window.location.href : "",
  };

  return (
    <div className="min-h-screen">
      <SEO
        title={seoContent.title || "Blog"}
        description={seoContent.description}
        keywords={seoContent.keywords}
        schema={blogSchema}
      />

      {/* Hero */}
      <section className="py-16 md:py-24 bg-gradient-to-b from-background to-muted/30">
        <div className="container mx-auto px-4">
          <Link href="/">
            <Button variant="ghost" size="sm" className="mb-6">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Home
            </Button>
          </Link>
          <div className="text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              {heroContent.title || "Blog"}
            </h1>
          {heroContent.subtitle && (
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {heroContent.subtitle}
            </p>
          )}
          </div>
        </div>
      </section>

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={!categorySlug ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setCategorySlug(undefined);
                setCurrentPage(1);
              }}
            >
              All
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat.id}
                variant={categorySlug === cat.slug ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setCategorySlug(cat.slug);
                  setCurrentPage(1);
                }}
              >
                {cat.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Posts grid */}
      <section className="container mx-auto px-4 py-8">
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-80 rounded-lg" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="h-16 w-16 text-muted-foreground mb-6" />
            <h2 className="text-2xl font-semibold mb-2">No posts yet</h2>
            <p className="text-muted-foreground">
              {categorySlug
                ? "No posts found in this category"
                : "Check back soon for new content"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <Link key={post.id} href={`/blog/${post.slug}`}>
                  <Card className="h-full hover:shadow-lg transition-all hover:border-primary/50 overflow-hidden group">
                    {post.featured_image_url ? (
                      <div className="aspect-video overflow-hidden">
                        <img
                          src={post.featured_image_url}
                          alt={post.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="aspect-video bg-muted flex items-center justify-center">
                        <FileText className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                    <CardContent className="p-5">
                      {post.category && (
                        <Badge variant="secondary" className="mb-2">
                          {post.category.name}
                        </Badge>
                      )}
                      <h2 className="text-lg font-semibold mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                        {post.title}
                      </h2>
                      {post.excerpt && (
                        <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                          {post.excerpt}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {post.published_at && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(post.published_at), "MMM d, yyyy")}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {post.reading_time_minutes} min read
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-10">
                <Button
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
