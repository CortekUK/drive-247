import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (
      !tenantSlug ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return entries;
    }

    const siteUrl = `https://${tenantSlug}.drive-247.com`;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // Static pages
    const staticPages = [
      { path: "/", changeFrequency: "weekly" as const, priority: 1.0 },
      { path: "/about", changeFrequency: "monthly" as const, priority: 0.8 },
      { path: "/fleet", changeFrequency: "weekly" as const, priority: 0.9 },
      { path: "/contact", changeFrequency: "monthly" as const, priority: 0.7 },
      { path: "/testimonials", changeFrequency: "weekly" as const, priority: 0.6 },
      { path: "/promotions", changeFrequency: "weekly" as const, priority: 0.7 },
      { path: "/faq", changeFrequency: "monthly" as const, priority: 0.5 },
      { path: "/blog", changeFrequency: "daily" as const, priority: 0.8 },
    ];

    for (const page of staticPages) {
      entries.push({
        url: `${siteUrl}${page.path}`,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
      });
    }

    // Get tenant ID
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, blog_enabled")
      .eq("slug", tenantSlug)
      .single();

    if (tenant?.blog_enabled) {
      // Get published blog posts
      const { data: posts } = await (supabase as any)
        .from("blog_posts")
        .select("slug, updated_at, published_at")
        .eq("tenant_id", tenant.id)
        .eq("status", "published")
        .order("published_at", { ascending: false });

      if (posts) {
        for (const post of posts) {
          entries.push({
            url: `${siteUrl}/blog/${post.slug}`,
            lastModified: new Date(post.updated_at || post.published_at),
            changeFrequency: "weekly",
            priority: 0.7,
          });
        }
      }
    }
  } catch (error) {
    console.error("Sitemap generation error:", error);
  }

  return entries;
}
