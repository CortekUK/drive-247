import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { StoryCard } from "@/components/content/story-card";
import { STORIES } from "@/content/stories";
import "@/components/content/content.css";
import { Accent, SectionHeading } from "./section-heading";

/*
 * Customer stories: three cards, each opening its own page under /customers. Renders
 * nothing when there is no story to show, which is the live site until a real one
 * exists (the samples in content/stories.ts never reach production).
 */
export function StoriesSection() {
  if (STORIES.length === 0) return null;

  return (
    <section className="ct-section" aria-labelledby="st-title">
      <div className="ct-inner">
        <div className="ct-head">
          <div>
            <SectionHeading
              id="st-title"
              title={
                <>
                  How operators <Accent>run on Drive247</Accent>
                </>
              }
              sub={
                <>
                  The businesses behind the bookings, and what changed when they moved.
                </>
              }
            />
          </div>
          <Link href="/customers" className="ct-all">
            All customer stories
            <ArrowRight strokeWidth={2} aria-hidden />
          </Link>
        </div>
        <div className="ct-grid">
          {STORIES.slice(0, 3).map((story) => (
            <StoryCard key={story.slug} story={story} />
          ))}
        </div>
      </div>
    </section>
  );
}
