import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import BlogPostClient from "./blog-post-client";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const { slug } = await params;
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (
      !tenantSlug ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return { title: "Blog Post" };
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // Get tenant
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, app_name, company_name")
      .eq("slug", tenantSlug)
      .single();

    if (!tenant) return { title: "Blog Post" };

    // Get published post by slug
    const { data: post } = await (supabase as any)
      .from("blog_posts")
      .select("title, excerpt, meta_title, meta_description, meta_keywords, featured_image_url, canonical_url, noindex")
      .eq("tenant_id", tenant.id)
      .eq("slug", slug)
      .eq("status", "published")
      .single();

    if (!post) return { title: "Post Not Found" };

    const appName = tenant.app_name || tenant.company_name || "Car Rentals";
    const title = post.meta_title || post.title;
    const description = post.meta_description || post.excerpt || "";

    const metadata: Metadata = {
      title: `${appName} | ${title}`,
      description,
      openGraph: {
        title: `${appName} | ${title}`,
        description,
        type: "article",
        images: post.featured_image_url ? [{ url: post.featured_image_url }] : [],
      },
      twitter: {
        card: "summary_large_image",
        title: `${appName} | ${title}`,
        description,
        images: post.featured_image_url ? [post.featured_image_url] : [],
      },
    };

    if (post.canonical_url) {
      metadata.alternates = { canonical: post.canonical_url };
    }

    if (post.noindex) {
      metadata.robots = { index: false, follow: true };
    }

    return metadata;
  } catch {
    return { title: "Blog Post" };
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;

  // Server-side check if post exists
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (
      tenantSlug &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );

      const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("slug", tenantSlug)
        .single();

      if (tenant) {
        const { data: post } = await (supabase as any)
          .from("blog_posts")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("slug", slug)
          .eq("status", "published")
          .single();

        if (!post) {
          notFound();
        }
      }
    }
  } catch {
    // Let client handle 404
  }

  return <BlogPostClient slug={slug} />;
}
