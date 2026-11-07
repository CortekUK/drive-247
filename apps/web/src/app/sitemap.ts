import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";
import { ALL_POSTS } from "@/content/posts";
import { STORIES } from "@/content/stories";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/security`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/strategy-call`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/blog`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    ...ALL_POSTS.map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: new Date(`${post.date}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    ...(STORIES.length > 0
      ? [
          { url: `${SITE_URL}/customers`, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.6 },
          ...STORIES.map((story) => ({
            url: `${SITE_URL}/customers/${story.slug}`,
            lastModified: new Date(`${story.date}T00:00:00Z`),
            changeFrequency: "monthly" as const,
            priority: 0.5,
          })),
        ]
      : []),
  ];
}
