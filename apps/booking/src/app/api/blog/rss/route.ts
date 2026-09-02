import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  try {
    const tenantSlug = request.headers.get("x-tenant-slug");

    if (
      !tenantSlug ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return new NextResponse("Not found", { status: 404 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // Get tenant
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, app_name, company_name, slug, blog_enabled")
      .eq("slug", tenantSlug)
      .single();

    if (!tenant || !tenant.blog_enabled) {
      return new NextResponse("Not found", { status: 404 });
    }

    // Get published blog posts
    const { data: posts } = await (supabase as any)
      .from("blog_posts")
      .select("title, slug, excerpt, published_at")
      .eq("tenant_id", tenant.id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(50);

    const appName = tenant.app_name || tenant.company_name || "Blog";
    const siteUrl = `https://${tenant.slug}.drive-247.com`;

    const items = (posts || [])
      .map(
        (post: any) => `
    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${siteUrl}/blog/${post.slug}</link>
      <guid isPermaLink="true">${siteUrl}/blog/${post.slug}</guid>
      <description><![CDATA[${post.excerpt || ""}]]></description>
      <pubDate>${new Date(post.published_at).toUTCString()}</pubDate>
    </item>`
      )
      .join("");

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${appName} Blog</title>
    <link>${siteUrl}/blog</link>
    <description>Latest articles from ${appName}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${siteUrl}/api/blog/rss" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;

    return new NextResponse(rss, {
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (error) {
    console.error("RSS feed error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
