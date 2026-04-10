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
  Sparkles,
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
  const featuredPost = posts.length > 0 ? posts[0] : null;
  const restPosts = posts.length > 1 ? posts.slice(1) : [];

  const blogSchema = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: heroContent.title,
    description: seoContent.description,
    url: typeof window !== "undefined" ? window.location.href : "",
  };

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={seoContent.title || "Blog"}
        description={seoContent.description}
        keywords={seoContent.keywords}
        schema={blogSchema}
      />

      {/* Hero */}
      <section className="pt-32 pb-16">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto text-center mb-8 animate-fade-in">
            <Link href="/">
              <Button variant="ghost" size="sm" className="mb-6 text-muted-foreground/60 hover:text-foreground">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Home
              </Button>
            </Link>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-display font-bold text-gradient-metal leading-tight pb-2 mb-6">
              {heroContent.title || "Blog"}
            </h1>

            <div className="flex items-center justify-center mb-6">
              <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
            </div>

            {heroContent.subtitle && (
              <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
                {heroContent.subtitle}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Category Filter */}
      {categories.length > 0 && (
        <section className="container mx-auto px-4 pb-12">
          <div className="flex flex-wrap justify-center gap-3 animate-fade-in animation-delay-200">
            <button
              className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 border ${
                !categorySlug
                  ? "bg-primary text-primary-foreground border-primary shadow-glow"
                  : "border-accent/20 text-muted-foreground hover:border-accent/40 hover:text-foreground hover:bg-accent/5"
              }`}
              onClick={() => { setCategorySlug(undefined); setCurrentPage(1); }}
            >
              All Posts
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 border ${
                  categorySlug === cat.slug
                    ? "bg-primary text-primary-foreground border-primary shadow-glow"
                    : "border-accent/20 text-muted-foreground hover:border-accent/40 hover:text-foreground hover:bg-accent/5"
                }`}
                onClick={() => { setCategorySlug(cat.slug); setCurrentPage(1); }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Content */}
      <section className="container mx-auto px-4 pb-24">
        {isLoading ? (
          <div className="max-w-6xl mx-auto space-y-8">
            <Skeleton className="aspect-[21/9] rounded-2xl" />
            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-4">
                  <Skeleton className="aspect-[4/3] rounded-xl" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : posts.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
            <div className="p-6 rounded-full bg-accent/10 border border-accent/20 mb-8">
              <Sparkles className="h-12 w-12 text-accent" />
            </div>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-gradient-silver mb-4">
              {categorySlug ? "No Posts Found" : "Coming Soon"}
            </h2>
            <p className="text-lg text-muted-foreground max-w-md text-center leading-relaxed">
              {categorySlug
                ? "Try a different category or check back later."
                : "We're preparing exciting content for you. Stay tuned!"}
            </p>
            {categorySlug && (
              <Button
                variant="outline"
                className="mt-8 border-accent/30 hover:bg-accent/10"
                onClick={() => { setCategorySlug(undefined); setCurrentPage(1); }}
              >
                View All Posts
              </Button>
            )}
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-12">

            {/* Featured / Latest Post (large card) */}
            {featuredPost && currentPage === 1 && !categorySlug && (
              <Link href={`/blog/${featuredPost.slug}`} className="block animate-fade-in">
                <Card className="group overflow-hidden shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur transition-all duration-500 hover:shadow-glow border-accent/10">
                  <div className="grid md:grid-cols-2 gap-0">
                    {/* Image */}
                    <div className="aspect-[4/3] md:aspect-auto overflow-hidden">
                      {featuredPost.featured_image_url ? (
                        <img
                          src={featuredPost.featured_image_url}
                          alt={featuredPost.title}
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full min-h-[300px] bg-gradient-to-br from-secondary/30 to-secondary/10 flex items-center justify-center">
                          <FileText className="h-16 w-16 text-muted-foreground/20" />
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="p-8 md:p-10 lg:p-12 flex flex-col justify-center">
                      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground/60 mb-4">
                        {featuredPost.category && (
                          <>
                            <span className="text-accent font-semibold">{featuredPost.category.name}</span>
                            <span className="text-accent/40">•</span>
                          </>
                        )}
                        {featuredPost.published_at && (
                          <span>{format(new Date(featuredPost.published_at), "MMMM d, yyyy")}</span>
                        )}
                      </div>

                      <h2 className="text-2xl md:text-3xl lg:text-4xl font-display font-bold leading-tight mb-4 group-hover:text-accent transition-colors duration-300">
                        {featuredPost.title}
                      </h2>

                      {featuredPost.excerpt && (
                        <p className="text-base md:text-lg text-muted-foreground leading-relaxed line-clamp-3 mb-6">
                          {featuredPost.excerpt}
                        </p>
                      )}

                      <div className="flex items-center justify-between mt-auto">
                        <div className="flex items-center gap-4 text-sm text-muted-foreground/60">
                          {featuredPost.author_name && (
                            <span className="flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5" />
                              {featuredPost.author_name}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            {featuredPost.reading_time_minutes} min read
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-sm font-medium text-accent opacity-0 group-hover:opacity-100 translate-x-[-8px] group-hover:translate-x-0 transition-all duration-300">
                          Read Article
                          <ArrowRight className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            )}

            {/* Grid of posts */}
            {(currentPage === 1 && !categorySlug ? restPosts : posts).length > 0 && (
              <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                {(currentPage === 1 && !categorySlug ? restPosts : posts).map((post, index) => (
                  <Link key={post.id} href={`/blog/${post.slug}`}>
                    <Card
                      className="group h-full overflow-hidden shadow-metal bg-gradient-to-br from-card via-card to-secondary/20 backdrop-blur transition-all duration-500 hover:-translate-y-2 border-accent/10 hover:shadow-glow animate-fade-in"
                      style={{ animationDelay: `${(index + 1) * 100}ms` }}
                    >
                      {/* Image */}
                      <div className="aspect-[4/3] overflow-hidden relative">
                        {post.featured_image_url ? (
                          <img
                            src={post.featured_image_url}
                            alt={post.title}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-secondary/30 to-secondary/10 flex items-center justify-center">
                            <FileText className="h-10 w-10 text-muted-foreground/20" />
                          </div>
                        )}
                        {/* Overlay gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                      </div>

                      {/* Content */}
                      <div className="p-6 space-y-3">
                        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground/60">
                          {post.category && (
                            <>
                              <span className="text-accent font-semibold">{post.category.name}</span>
                              <span className="text-accent/40">•</span>
                            </>
                          )}
                          {post.published_at && (
                            <span>{format(new Date(post.published_at), "MMM d, yyyy")}</span>
                          )}
                        </div>

                        <h3 className="text-lg font-display font-semibold leading-snug line-clamp-2 group-hover:text-accent transition-colors duration-300">
                          {post.title}
                        </h3>

                        {post.excerpt && (
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                            {post.excerpt}
                          </p>
                        )}

                        <div className="flex items-center justify-between pt-4 border-t border-accent/10">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
                            {post.author_name && (
                              <span className="flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {post.author_name}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {post.reading_time_minutes} min
                            </span>
                          </div>
                          <ArrowRight className="h-4 w-4 text-accent opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-6 pt-8 animate-fade-in">
                <Button
                  variant="outline"
                  size="lg"
                  className="border-accent/30 hover:bg-accent/10 hover:shadow-glow transition-all duration-300"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>
                <div className="flex items-center gap-2">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      className={`w-10 h-10 rounded-full text-sm font-medium transition-all duration-300 ${
                        currentPage === page
                          ? "bg-primary text-primary-foreground shadow-glow"
                          : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                      }`}
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="lg"
                  className="border-accent/30 hover:bg-accent/10 hover:shadow-glow transition-all duration-300"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
