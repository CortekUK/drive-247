import { notFound } from "next/navigation";

import { loadBlogEnabled, loadBlogPosts } from "@nw/lib/cms/server";
import { BlogIndexV2 } from "@nw/site-v2/blog/blog-v2";
import { CtaBanner } from "@nw/site-v2/sections/cta-banner";

export const metadata = { title: "Blog" };

/**
 * The blog index, v2. Gated exactly as v1's: `tenants.blog_enabled` off is a
 * 404 (the toggle is a decision not to have a blog), and only published posts
 * are ever listed (the query filters them).
 */
export default async function BlogIndexV2Page() {
  const [enabled, posts] = await Promise.all([loadBlogEnabled(), loadBlogPosts()]);
  if (!enabled) notFound();

  return (
    <>
      <BlogIndexV2 posts={posts} />
      <CtaBanner />
    </>
  );
}
