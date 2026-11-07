import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { ArticleBody } from "@/components/content/article-body";
import { ContentCta } from "@/components/content/content-cta";
import { CoverShot } from "@/components/content/cover-shot";
import { PostCard } from "@/components/content/post-card";
import { ALL_POSTS, getPost } from "@/content/posts";
import { formatDate } from "@/content/types";
import "@/components/content/content.css";

type Props = { params: Promise<{ slug: string }> };

/* Every post is known at build time; any other address is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  return {
    title: `${post.title} — Drive247`,
    description: post.excerpt,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      publishedTime: post.date,
      images: [{ url: post.cover.src }],
    },
  };
}

export default async function PostPage({ params }: Props) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const more = ALL_POSTS.filter((other) => other.slug !== post.slug).slice(0, 3);

  return (
    <article className="ct-page">
      <header className="ct-narrow">
        <Link href="/blog" className="ct-back">
          <ArrowLeft strokeWidth={2} aria-hidden />
          All posts
        </Link>
        <p className="ct-meta ct-article-meta">
          <span className="ct-tag">{post.category}</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          <span>{post.readMinutes} min read</span>
        </p>
        <h1 className="ct-article-title font-medium tracking-tighter">{post.title}</h1>
        <p className="ct-lead">{post.excerpt}</p>
        <p className="ct-byline">
          <span className="ct-byline-mark" aria-hidden>
            D
          </span>
          The Drive247 team
        </p>
      </header>

      <div className="ct-wide ct-hero">
        <div className="ct-cover">
          <CoverShot cover={post.cover} sizes="(min-width: 1240px) 1160px, 100vw" />
        </div>
      </div>

      <div className="ct-narrow">
        <ArticleBody body={post.body} />
      </div>

      <div className="ct-inner">
        <section className="ct-related" aria-labelledby="ct-more-title">
          <div className="ct-head">
            <h2 id="ct-more-title" className="ct-related-title font-medium tracking-tighter">
              Keep reading
            </h2>
            <Link href="/blog" className="ct-all">
              All posts
              <ArrowRight strokeWidth={2} aria-hidden />
            </Link>
          </div>
          <div className="ct-grid">
            {more.map((other) => (
              <PostCard key={other.slug} post={other} />
            ))}
          </div>
        </section>
        <ContentCta />
      </div>
    </article>
  );
}
