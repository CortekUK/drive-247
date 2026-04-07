"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBlogPost } from "@/hooks/useBlogPosts";
import { useTenant } from "@/contexts/TenantContext";
import { useBrandingSettings } from "@/hooks/useBrandingSettings";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Calendar,
  Clock,
  User,
  FileText,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import SEO from "@/components/SEO";

export default function BlogPostClient({ slug }: { slug: string }) {
  const { tenant } = useTenant();
  const router = useRouter();
  const { branding } = useBrandingSettings();
  const { data: post, isLoading, error } = useBlogPost(slug);

  const appName = branding.app_name || "Car Rentals";

  // Redirect to home if blog is disabled
  if (tenant && !tenant.blog_enabled) {
    router.replace("/");
    return null;
  }

  if (isLoading) {
    return (
      <div className="pt-32 pb-24">
        <div className="container mx-auto px-4 max-w-4xl">
          <Skeleton className="h-4 w-48 mb-10" />
          <Skeleton className="h-6 w-24 mb-4" />
          <Skeleton className="h-14 w-3/4 mb-6" />
          <div className="flex gap-6 mb-10">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="aspect-[21/9] w-full rounded-xl mb-12" />
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="pt-32 pb-24">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-md mx-auto animate-fade-in">
            <div className="p-6 rounded-full bg-accent/10 border border-accent/20 mx-auto w-fit mb-8">
              <FileText className="h-12 w-12 text-accent" />
            </div>
            <h1 className="text-4xl font-display font-bold text-gradient-metal mb-4">
              Post Not Found
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
              The article you&apos;re looking for doesn&apos;t exist or has been removed.
            </p>
            <Link href="/blog">
              <Button
                size="lg"
                variant="outline"
                className="border-accent/30 hover:bg-accent/10"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Blog
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // BlogPosting structured data
  const blogPostingSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.meta_description || post.excerpt || "",
    image: post.featured_image_url || undefined,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: post.author_name
      ? { "@type": "Person", name: post.author_name }
      : undefined,
    publisher: {
      "@type": "Organization",
      name: appName,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": typeof window !== "undefined" ? window.location.href : "",
    },
  };

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: typeof window !== "undefined" ? window.location.origin : "",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item:
          typeof window !== "undefined"
            ? `${window.location.origin}/blog`
            : "",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: post.title,
      },
    ],
  };

  return (
    <article className="min-h-screen">
      <SEO
        title={post.meta_title || post.title}
        description={post.meta_description || post.excerpt || undefined}
        keywords={post.meta_keywords || undefined}
        canonical={post.canonical_url || undefined}
        schema={[blogPostingSchema, breadcrumbSchema]}
      />

      {/* Hero / Header */}
      <section className="pt-32 pb-12">
        <div className="container mx-auto px-4 max-w-4xl animate-fade-in">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-muted-foreground/60 mb-10">
            <Link
              href="/"
              className="hover:text-accent transition-colors duration-300"
            >
              Home
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              href="/blog"
              className="hover:text-accent transition-colors duration-300"
            >
              Blog
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground/80 truncate max-w-[200px]">
              {post.title}
            </span>
          </nav>

          {/* Category */}
          {post.category && (
            <Link href={`/blog?category=${post.category.slug}`}>
              <span className="inline-block text-xs uppercase tracking-widest font-medium text-accent border border-accent/30 rounded-full px-4 py-1.5 mb-6 hover:bg-accent/10 transition-colors duration-300">
                {post.category.name}
              </span>
            </Link>
          )}

          {/* Title */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-gradient-metal leading-tight mb-6">
            {post.title}
          </h1>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground/60">
            {post.author_name && (
              <span className="flex items-center gap-2">
                <div className="p-1.5 rounded-full bg-accent/10">
                  <User className="h-3.5 w-3.5 text-accent" />
                </div>
                <span>{post.author_name}</span>
              </span>
            )}
            {post.published_at && (
              <span className="flex items-center gap-2">
                <div className="p-1.5 rounded-full bg-accent/10">
                  <Calendar className="h-3.5 w-3.5 text-accent" />
                </div>
                <span>{format(new Date(post.published_at), "MMMM d, yyyy")}</span>
              </span>
            )}
            <span className="flex items-center gap-2">
              <div className="p-1.5 rounded-full bg-accent/10">
                <Clock className="h-3.5 w-3.5 text-accent" />
              </div>
              <span>{post.reading_time_minutes} min read</span>
            </span>
          </div>
        </div>
      </section>

      {/* Featured Image */}
      {post.featured_image_url && (
        <section className="container mx-auto px-4 max-w-5xl pb-12 animate-fade-in animation-delay-200">
          <div className="rounded-2xl overflow-hidden shadow-metal border border-accent/10">
            <img
              src={post.featured_image_url}
              alt={post.title}
              className="w-full object-cover max-h-[500px]"
            />
          </div>
        </section>
      )}

      {/* Content */}
      {post.content && (
        <section className="container mx-auto px-4 max-w-4xl pb-16 animate-fade-in animation-delay-400">
          <div
            className="prose prose-lg dark:prose-invert max-w-none
              prose-headings:font-display prose-headings:text-gradient-silver
              prose-h2:text-3xl prose-h2:mt-12 prose-h2:mb-5
              prose-h3:text-2xl prose-h3:mt-10 prose-h3:mb-4
              prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-6
              prose-a:text-accent prose-a:no-underline hover:prose-a:underline
              prose-strong:text-foreground
              prose-blockquote:border-l-accent prose-blockquote:border-l-2 prose-blockquote:pl-6 prose-blockquote:italic prose-blockquote:text-muted-foreground
              prose-img:rounded-xl prose-img:shadow-metal prose-img:my-8
              prose-ul:text-muted-foreground prose-ol:text-muted-foreground
              [&>iframe]:rounded-xl [&>iframe]:shadow-metal [&>iframe]:my-8 [&>iframe]:max-w-full"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(post.content),
            }}
          />
        </section>
      )}

      {/* Divider */}
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="h-[1px] bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      </div>

      {/* Footer */}
      <section className="container mx-auto px-4 max-w-4xl py-12">
        <div className="flex items-center justify-between">
          <Link href="/blog">
            <Button
              variant="outline"
              size="lg"
              className="border-accent/30 hover:bg-accent/10 transition-all duration-300"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </Link>

          {post.category && (
            <Link href={`/blog?category=${post.category.slug}`}>
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-accent"
              >
                More in {post.category.name}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          )}
        </div>
      </section>
    </article>
  );
}
