import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { CtaBanner } from "@/components/sections/cta-banner";
import { htmlToParagraphs } from "@/lib/cms/html";
import { loadBlogEnabled, loadBlogPost } from "@/lib/cms/server";

type Params = { params: Promise<{ slug: string }> };

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

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

/**
 * One blog post.
 *
 * The body is stored as HTML from the portal's editor and rendered as TEXT, for
 * the reason `lib/cms/html.ts` documents: the portal does not sanitise on write
 * and this page is public, so `dangerouslySetInnerHTML` here would be a stored
 * XSS sink.
 */
export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params;
  const [enabled, post] = await Promise.all([loadBlogEnabled(), loadBlogPost(slug)]);
  if (!enabled || !post) notFound();

  const date = formatDate(post.publishedAt);
  const paragraphs = htmlToParagraphs(post.content);

  return (
    <>
      <article className="bg-white">
        <div className="container-page py-12 lg:py-20">
          <Link
            href="/blog"
            className="text-sm text-brand-text-soft underline-offset-4 hover:underline"
          >
            ← All posts
          </Link>

          <header className="mt-6 max-w-3xl">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-[1.05]">
              {post.title}
            </h1>
            <p className="mt-3 text-sm text-brand-text-soft">
              {[
                date,
                post.authorName,
                post.readingTimeMinutes ? `${post.readingTimeMinutes} min read` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </header>

          {post.featuredImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.featuredImageUrl}
              alt=""
              className="mt-8 aspect-[16/9] w-full max-w-4xl rounded-2xl object-cover"
            />
          )}

          <div className="mt-8 flex max-w-3xl flex-col gap-4">
            {paragraphs.map((paragraph, index) => (
              <p
                key={`${index}-${paragraph.slice(0, 24)}`}
                className="text-sm leading-relaxed text-brand-text-soft sm:text-base"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </article>
      <CtaBanner />
    </>
  );
}
