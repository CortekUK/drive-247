import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ContentCta } from "@/components/content/content-cta";
import { PostArticle, rich } from "@/components/content/post-article";
import { PostCard } from "@/components/content/post-card";
import { PostPoster, posterFor } from "@/components/content/post-poster";
import { ALL_POSTS, getPost } from "@/content/posts";
import { formatDate } from "@/content/types";
import "@/components/content/content.css";
import "@/components/content/post-article.css";

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
      images: [{ url: posterFor(post.slug)?.src ?? post.cover.src }],
    },
  };
}

export default async function PostPage({ params }: Props) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const photo = posterFor(post.slug);
  const others = ALL_POSTS.filter((other) => other.slug !== post.slug);
  const withPhotos = others.filter((other) => posterFor(other.slug));
  const more = (withPhotos.length > 0 ? withPhotos : others).slice(0, 3);

  return (
    <article className="ar">
      <div className="ar-top">
        <Link href="/" aria-label="Drive247 home">
          <Image src="/logo-light.png" alt="Drive247" width={855} height={195} className="dark:hidden" priority />
          <Image src="/logo-dark.png" alt="Drive247" width={855} height={195} className="hidden dark:block" priority />
        </Link>
        <Link href="/" className="ar-back">
          <ArrowLeft strokeWidth={2} aria-hidden />
          Back to home
        </Link>
      </div>

      <header className="ar-hero">
        <p className="ar-meta">
          <span className="ar-meta-tag">{post.category}</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          <span>{post.readMinutes} min read</span>
        </p>
        <h1 className="ar-title">{rich(post.display ?? post.title)}</h1>
        <div className="ar-open">
          <div>
            <p className="ar-lead">{post.excerpt}</p>
            <p className="ar-by">By the Drive247 team</p>
          </div>
          {photo && (
            <div className="ar-photo">
              <Image src={photo.src} alt="" fill priority sizes="(min-width: 900px) 58vw, 100vw" style={{ objectPosition: photo.focus }} />
            </div>
          )}
        </div>
      </header>

      <PostArticle body={post.body} />

      <section className="ar-after" aria-labelledby="ar-more-title">
        <h2 id="ar-more-title" className="ar-after-title">
          Keep <em className="ar-cursive">reading</em>
        </h2>
        <div className="ar-after-grid">
          {more.map((other) =>
            posterFor(other.slug) ? <PostPoster key={other.slug} post={other} /> : <PostCard key={other.slug} post={other} />,
          )}
        </div>
        <ContentCta />
      </section>
    </article>
  );
}
