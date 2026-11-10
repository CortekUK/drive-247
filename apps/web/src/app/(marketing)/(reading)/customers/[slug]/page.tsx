import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ContentCta } from "@/components/content/content-cta";
import { PostArticle, rich } from "@/components/content/post-article";
import { StoryPoster } from "@/components/content/story-poster";
import { getStory, STORIES } from "@/content/stories";
import "@/components/content/content.css";
import "@/components/content/post-article.css";

type Props = { params: Promise<{ slug: string }> };

/* Every story is known at build time; any other address is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return STORIES.map((story) => ({ slug: story.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const story = getStory((await params).slug);
  if (!story) return {};
  return {
    title: `${story.headline} — Drive247`,
    description: story.excerpt,
    alternates: { canonical: `/customers/${story.slug}` },
    openGraph: {
      type: "article",
      title: story.headline,
      description: story.excerpt,
      publishedTime: story.date,
      images: [{ url: story.photo.src }],
    },
  };
}

export default async function StoryPage({ params }: Props) {
  const story = getStory((await params).slug);
  if (!story) notFound();

  const more = STORIES.filter((other) => other.slug !== story.slug).slice(0, 3);

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
          <span className="ar-meta-tag">{story.operator}</span>
          <span>{story.location}</span>
          <span>{story.fleet}</span>
          <span>{story.since}</span>
        </p>
        <h1 className="ar-title ar-title-story">{rich(story.display)}</h1>
        <div className="ar-open">
          <div>
            <p className="ar-lead">{story.excerpt}</p>
          </div>
          <div className="ar-photo">
            <Image src={story.photo.src} alt="" fill priority sizes="(min-width: 900px) 58vw, 100vw" style={{ objectPosition: story.photo.focus }} />
          </div>
        </div>
      </header>

      {/* The three results lead the story, then the story itself. */}
      <PostArticle body={[{ type: "stats", items: story.results }, ...story.body]} />

      <section className="ar-after" aria-labelledby="ar-more-title">
        {more.length > 0 && (
          <>
            <h2 id="ar-more-title" className="ar-after-title">
              More <em className="ar-cursive">stories</em>
            </h2>
            <div className="ar-after-grid">
              {more.map((other) => (
                <StoryPoster key={other.slug} story={other} />
              ))}
            </div>
          </>
        )}
        <ContentCta />
      </section>
    </article>
  );
}
