import type { MetadataRoute } from "next";
import { headers } from "next/headers";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  try {
    const headersList = await headers();
    const tenantSlug = headersList.get("x-tenant-slug");

    if (!tenantSlug) {
      return entries;
    }

    const siteUrl = `https://${tenantSlug}.drive-247.com`;

    // Static pages
    const staticPages = [
      { path: "/", changeFrequency: "weekly" as const, priority: 1.0 },
      { path: "/about", changeFrequency: "monthly" as const, priority: 0.8 },
      { path: "/fleet", changeFrequency: "weekly" as const, priority: 0.9 },
      { path: "/contact", changeFrequency: "monthly" as const, priority: 0.7 },
      { path: "/testimonials", changeFrequency: "weekly" as const, priority: 0.6 },
      { path: "/faq", changeFrequency: "monthly" as const, priority: 0.5 },
    ];

    for (const page of staticPages) {
      entries.push({
        url: `${siteUrl}${page.path}`,
        changeFrequency: page.changeFrequency,
        priority: page.priority,
      });
    }
  } catch (error) {
    console.error("Sitemap generation error:", error);
  }

  return entries;
}
