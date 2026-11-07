import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { ArticleBody } from "@/components/content/article-body";
import { ContentCta } from "@/components/content/content-cta";
import { initialOf, StoryCard } from "@/components/content/story-card";
import { getStory, STORIES } from "@/content/stories";
import "@/components/content/content.css";

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
    openGraph: { type: "article", title: story.headline, description: story.excerpt, publishedTime: story.date },
  };
}

export default async function StoryPage({ params }: Props) {
  const story = getStory((await params).slug);
  if (!story) notFound();

  const more = STORIES.filter((other) => other.slug !== story.slug).slice(0, 3);
  const [opening, ...rest] = story.body;

  return (
    <article className="ct-page" data-tint={story.tint}>
      <div className="ct-wide">
        <Link href="/customers" className="ct-back">
          <ArrowLeft strokeWidth={2} aria-hidden />
          All customer stories
        </Link>

        <header className="ct-story-hero">
          <p className="ct-op">
            <span className="ct-op-mark" aria-hidden>
              {initialOf(story.operator)}
            </span>
            {story.operator}
          </p>
          <h1 className="ct-article-title font-medium tracking-tighter">{story.headline}</h1>
          <ul className="ct-facts" aria-label="About the business">
            <li>{story.location}</li>
            <li>{story.fleet}</li>
            <li>{story.since}</li>
          </ul>
          <ul className="ct-results" aria-label="Results">
            {story.results.map((result) => (
              <li key={result.label}>
                <p className="ct-figure-value">{result.value}</p>
                <p className="ct-figure-label">{result.label}</p>
              </li>
            ))}
          </ul>
        </header>
      </div>

      <div className="ct-narrow">
        <p className="ct-lead ct-story-lead">{story.excerpt}</p>
        <ArticleBody body={opening ? [opening, ...rest.slice(0, 1)] : []} />
        <figure className="ct-quote">
          <blockquote>
            <p>&ldquo;{story.quote.text}&rdquo;</p>
          </blockquote>
          <figcaption>{story.quote.by}</figcaption>
        </figure>
        <ArticleBody body={rest.slice(1)} />
      </div>

      {more.length > 0 && (
        <div className="ct-inner">
          <section className="ct-related" aria-labelledby="ct-more-title">
            <div className="ct-head">
              <h2 id="ct-more-title" className="ct-related-title font-medium tracking-tighter">
                More stories
              </h2>
              <Link href="/customers" className="ct-all">
                All customer stories
                <ArrowRight strokeWidth={2} aria-hidden />
              </Link>
            </div>
            <div className="ct-grid">
              {more.map((other) => (
                <StoryCard key={other.slug} story={other} />
              ))}
            </div>
          </section>
        </div>
      )}

      <div className="ct-inner">
        <ContentCta />
      </div>
    </article>
  );
}
