import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import BlogListingClient from "./blog-listing-client";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (
      !tenantSlug ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return { title: "Blog" };
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    // Get tenant info
    const { data: tenant } = await supabase
      .from("tenants")
      .select("app_name, company_name")
      .eq("slug", tenantSlug)
      .single();

    // Get blog CMS page SEO settings
    const { data: blogPage } = await supabase
      .from("cms_pages")
      .select("id")
      .eq("slug", "blog")
      .eq("tenant_id", (await supabase.from("tenants").select("id").eq("slug", tenantSlug).single()).data?.id || "")
      .single();

    let seoTitle = "Blog";
    let seoDescription = "Read the latest articles and news";

    if (blogPage) {
      const { data: seoSection } = await supabase
        .from("cms_page_sections")
        .select("content")
        .eq("page_id", blogPage.id)
        .eq("section_key", "seo")
        .single();

      if (seoSection?.content) {
        const seo = seoSection.content as any;
        if (seo.title) seoTitle = seo.title;
        if (seo.description) seoDescription = seo.description;
      }
    }

    const appName = tenant?.app_name || tenant?.company_name || "Car Rentals";

    return {
      title: `${appName} | ${seoTitle}`,
      description: seoDescription,
      openGraph: {
        title: `${appName} | ${seoTitle}`,
        description: seoDescription,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: `${appName} | ${seoTitle}`,
        description: seoDescription,
      },
    };
  } catch {
    return { title: "Blog" };
  }
}

export default function BlogPage() {
  return <BlogListingClient />;
}
