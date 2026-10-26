import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { loadBlogEnabled, loadBlogPost } from "@nw/lib/cms/server";
import { BlogArticleV2 } from "@nw/site-v2/blog/blog-v2";
import { HomeCta } from "@nw/site-v2/sections/home-cta";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await loadBlogPost(slug);
  if (!post) return {};
  return {
    title: post.metaTitle?.trim() || post.title,
    description: post.metaDescription?.trim() || post.excerpt || undefined,
    /* The operator's own "hide from search" switch on the post. */
    robots: post.noindex ? { index: false, follow: false } : undefined,
  };
}

/** One blog post, v2. Same gating as v1: blog switched off or no such published post is a 404. */
export default async function BlogPostV2Page({ params }: Params) {
  const { slug } = await params;
  const [enabled, post] = await Promise.all([loadBlogEnabled(), loadBlogPost(slug)]);
  if (!enabled || !post) notFound();

  return (
    <>
      <BlogArticleV2 post={post} />
      <HomeCta />
    </>
  );
}
