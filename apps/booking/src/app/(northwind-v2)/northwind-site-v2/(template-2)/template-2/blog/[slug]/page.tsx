import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadBlogEnabled, loadBlogPost } from "@nw/lib/cms/server";
import { Template2BlogArticle } from "@nw/template-2/blog-page";
import { Template2PageClosing } from "@nw/template-2/page-closing";

/** Template 2 ("Glass") — one blog post. Blog switched off, or no such published post, is a 404. */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = await loadBlogPost(slug);
  if (!post) return {};
  return {
    title: post.metaTitle?.trim() || post.title,
    description: post.metaDescription?.trim() || post.excerpt || undefined,
    robots: post.noindex ? { index: false, follow: false } : undefined,
  };
}

export default async function Template2BlogPostRoute({ params }: Params) {
  const { slug } = await params;
  const [enabled, post] = await Promise.all([loadBlogEnabled(), loadBlogPost(slug)]);
  if (!enabled || !post) notFound();
  return (
    <>
      <Template2BlogArticle post={post} />
      <Template2PageClosing />
    </>
  );
}
