"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBlogPosts, useBlogCategories } from "@/hooks/useBlogPosts";
import { useTenant } from "@/contexts/TenantContext";
import { usePageContent } from "@/hooks/usePageContent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ArrowRight,
  Clock,
  ChevronLeft,
  ChevronRight,
  FileText,
  User,
} from "lucide-react";
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
    pageSize: 9,
  });

  const { data: categories = [] } = useBlogCategories();

  const { data: cmsContent } = usePageContent("blog");
  const content = { ...defaultBlogContent, ...cmsContent };
  const heroContent = (content as any).hero || defaultBlogContent.hero;
  const seoContent = (content as any).seo || defaultBlogContent.seo;

  const posts = data?.posts ?? [];
  const totalPages = data?.totalPages ?? 1;

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
      <section className="pt-32 pb-20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center animate-fade-in">
            <Link href="/">
              <Button variant="ghost" size="sm" className="mb-8 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Home
              </Button>
            </Link>

            <div className="flex justify-center mb-6">
              <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold text-gradient-metal mb-6">
              {heroContent.title || "Blog"}
            </h1>

            {heroContent.subtitle && (
              <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                {heroContent.subtitle}
              </p>
            )}

            <div className="flex justify-center mt-6">
              <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* Category filter */}
      {categories.length > 0 && (
        <section className="container mx-auto px-4 pb-8">
          <div className="flex flex-wrap justify-center gap-3 animate-fade-in animation-delay-200">
            <button
              className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 border ${
                !categorySlug
                  ? "bg-accent/20 border-accent/40 text-accent-foreground shadow-sm"
                  : "border-accent/10 text-muted-foreground hover:border-accent/30 hover:text-foreground"
              }`}
              onClick={() => {
                setCategorySlug(undefined);
                setCurrentPage(1);
              }}
            >
              All Posts
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 border ${
                  categorySlug === cat.slug
                    ? "bg-accent/20 border-accent/40 text-accent-foreground shadow-sm"
                    : "border-accent/10 text-muted-foreground hover:border-accent/30 hover:text-foreground"
                }`}
                onClick={() => {
                  setCategorySlug(cat.slug);
                  setCurrentPage(1);
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Posts */}
      <section className="container mx-auto px-4 pb-24">
        {isLoading ? (
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="space-y-4 animate-pulse">
                <Skeleton className="aspect-[4/3] rounded-xl" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
            <div className="p-6 rounded-full bg-accent/10 border border-accent/20 mb-8">
              <FileText className="h-12 w-12 text-accent" />
            </div>
            <h2 className="text-3xl font-display font-bold text-gradient-silver mb-4">
              {categorySlug ? "No posts in this category" : "Coming Soon"}
            </h2>
            <p className="text-lg text-muted-foreground max-w-md text-center">
              {categorySlug
                ? "Try selecting a different category or check back later."
                : "We're working on exciting content. Check back soon!"}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
              {posts.map((post, index) => (
                <Link key={post.id} href={`/blog/${post.slug}`}>
                  <Card
                    className={`group h-full overflow-hidden shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur transition-all duration-500 hover:-translate-y-2 border-accent/10 hover:shadow-glow animate-fade-in`}
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    {/* Image */}
                    <div className="aspect-[4/3] overflow-hidden">
                      {post.featured_image_url ? (
                        <img
                          src={post.featured_image_url}
                          alt={post.title}
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-secondary/30 to-secondary/10 flex items-center justify-center">
                          <FileText className="h-12 w-12 text-muted-foreground/30" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-3">
                      {/* Category + Date */}
                      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground/60">
                        {post.category && (
                          <>
                            <span className="text-accent font-medium">
                              {post.category.name}
                            </span>
                            <span>•</span>
                          </>
                        )}
                        {post.published_at && (
                          <span>
                            {format(new Date(post.published_at), "MMM d, yyyy")}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h2 className="text-xl font-display font-semibold leading-tight line-clamp-2 group-hover:text-accent transition-colors duration-300">
                        {post.title}
                      </h2>

                      {/* Excerpt */}
                      {post.excerpt && (
                        <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                          {post.excerpt}
                        </p>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-3 border-t border-accent/10">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                          {post.author_name && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {post.author_name}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {post.reading_time_minutes} min read
                          </span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-accent opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-16 animate-fade-in">
                <Button
                  variant="outline"
                  className="border-accent/30 hover:bg-accent/10"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground/60 uppercase tracking-wider">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  className="border-accent/30 hover:bg-accent/10"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
