import { StoryPoster } from "@/components/content/story-poster";
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
    <section className="ct-section st-section" aria-labelledby="st-title">
      <div className="ct-inner">
        <div className="ct-head ct-head-left">
          <div>
            <SectionHeading
              id="st-title"
              align="left"
              title={
                <>
                  Customer <Accent>stories</Accent>
                </>
              }
              sub={
                <>
                  The businesses behind the bookings, and what changed when they moved.
                </>
              }
            />
          </div>
        </div>
        <div className="ct-grid">
          {STORIES.slice(0, 3).map((story) => (
            <StoryPoster key={story.slug} story={story} />
          ))}
        </div>
      </div>
    </section>
  );
}
