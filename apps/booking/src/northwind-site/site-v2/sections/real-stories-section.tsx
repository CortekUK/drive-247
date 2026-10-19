import Link from 'next/link';
import { MessageSquareQuote } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { DEFAULT_FEEDBACK_CTA } from '@nw/lib/cms/defaults';
import { loadSection, loadTestimonials } from '@nw/lib/cms/server';
import type { TestimonialItem } from '@nw/lib/cms/types';
import { CARD, CardHeading, EmptyState, Section, SectionHeading } from '@nw/site-v2/kit';
import { MarqueeStrip } from '@nw/site-v2/sections/marquee-strip';
import { TestimonialCard } from '@nw/site-v2/sections/testimonial-card';

/**
 * Northwind booking site v2 — the /reviews wall: every row of `testimonials`,
 * server-rendered, as flat cards. Same reads as v1
 * (`components/sections/real-stories-section.tsx`), including the
 * `reviews / feedback_cta` "before you have reviews" copy, and the v2
 * marquee strip under the wall.
 */
export async function RealStoriesSection() {
  const [rows, cta] = await Promise.all([loadTestimonials(), loadSection('reviews', 'feedback_cta', DEFAULT_FEEDBACK_CTA)]);
  const stories: readonly TestimonialItem[] = rows ?? [];
  const hasCta = cta.title.trim() !== '' || cta.description.trim() !== '';

  return (
    <>
      <Section>
        <SectionHeading
          title="Real stories, real miles"
          description="From late-night landings to weekend escapes, here is how we keep the road open."
        />

        {stories.length === 0 ? (
          <EmptyState
            className="mt-5"
            icon={<MessageSquareQuote aria-hidden strokeWidth={1.75} className="size-5" />}
            title="Reviews will appear here"
            description={cta.empty_state_message.trim() || 'They appear here as customers leave them.'}
          />
        ) : (
          <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stories.map((story) => (
              <li key={story.id}>
                <TestimonialCard
                  quote={story.quote}
                  author={story.author}
                  stars={story.stars}
                  source={story.source}
                />
              </li>
            ))}
          </ul>
        )}

        {/* "Ask for a review" — shown only once an operator has written it. */}
        {hasCta && (
          <aside className={`${CARD} mt-6 flex flex-col gap-4 px-5 py-6 sm:flex-row sm:items-center sm:justify-between md:px-6`}>
            <CardHeading title={cta.title.trim() || null} description={cta.description.trim() || null} />
            {cta.button_text.trim() !== '' && (
              <Button asChild variant="brand-outline" className="h-11 shrink-0 px-5">
                <Link href="/contact">{cta.button_text}</Link>
              </Button>
            )}
          </aside>
        )}
      </Section>
      {/* Its own page column, as in v1 where the strip sits under the wall. */}
      <MarqueeStrip />
    </>
  );
}
