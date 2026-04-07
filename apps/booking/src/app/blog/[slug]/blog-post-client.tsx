"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBlogPost } from "@/hooks/useBlogPosts";
import { useTenant } from "@/contexts/TenantContext";
import { useBrandingSettings } from "@/hooks/useBrandingSettings";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, Clock, User, FileText } from "lucide-react";
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
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        <Skeleton className="h-8 w-32 mb-8" />
        <Skeleton className="h-12 w-3/4 mb-4" />
        <Skeleton className="h-6 w-1/2 mb-8" />
        <Skeleton className="aspect-video w-full mb-8 rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="container mx-auto px-4 py-24 text-center">
        <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-6" />
        <h1 className="text-3xl font-bold mb-4">Post not found</h1>
        <p className="text-muted-foreground mb-8">
          The blog post you&apos;re looking for doesn&apos;t exist or has been
          removed.
        </p>
        <Link href="/blog">
          <Button>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Blog
          </Button>
        </Link>
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

  // Breadcrumb structured data
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

      <div className="container mx-auto px-4 py-8 md:py-16 max-w-4xl">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
          <Link href="/" className="hover:text-foreground transition-colors">
            Home
          </Link>
          <span>/</span>
          <Link
            href="/blog"
            className="hover:text-foreground transition-colors"
          >
            Blog
          </Link>
          <span>/</span>
          <span className="text-foreground truncate">{post.title}</span>
        </nav>

        {/* Header */}
        <header className="mb-8">
          {post.category && (
            <Link href={`/blog?category=${post.category.slug}`}>
              <Badge variant="secondary" className="mb-4 hover:bg-secondary/80">
                {post.category.name}
              </Badge>
            </Link>
          )}
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4 leading-tight">
            {post.title}
          </h1>

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {post.author_name && (
              <span className="flex items-center gap-1.5">
                <User className="h-4 w-4" />
                {post.author_name}
              </span>
            )}
            {post.published_at && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {format(new Date(post.published_at), "MMMM d, yyyy")}
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {post.reading_time_minutes} min read
            </span>
          </div>
        </header>

        {/* Featured image */}
        {post.featured_image_url && (
          <div className="mb-8 rounded-lg overflow-hidden">
            <img
              src={post.featured_image_url}
              alt={post.title}
              className="w-full object-cover"
            />
          </div>
        )}

        {/* Content */}
        {post.content && (
          <div
            className="prose prose-lg dark:prose-invert max-w-none
              [&>p]:mb-6
              [&>ul]:list-disc [&>ul]:list-inside [&>ul]:pl-4
              [&>ol]:list-decimal [&>ol]:list-inside [&>ol]:pl-4
              [&>h2]:text-2xl [&>h2]:font-semibold [&>h2]:mt-10 [&>h2]:mb-4
              [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:mt-8 [&>h3]:mb-3
              [&>blockquote]:border-l-4 [&>blockquote]:border-primary [&>blockquote]:pl-4 [&>blockquote]:italic
              [&>img]:rounded-lg [&>img]:my-6
              [&>iframe]:rounded-lg [&>iframe]:my-6 [&>iframe]:max-w-full"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(post.content),
            }}
          />
        )}

        {/* Back to blog */}
        <div className="mt-12 pt-8 border-t">
          <Link href="/blog">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Blog
            </Button>
          </Link>
        </div>
      </div>
    </article>
  );
}
