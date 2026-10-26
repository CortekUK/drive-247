import { MessageSquarePlus, Star } from 'lucide-react-nw';
import Link from 'next/link';

import { DEFAULT_FEEDBACK_CTA } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { isEditMode, loadSection, loadTestimonials } from '@nw/lib/cms/server';
import type { TestimonialItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { ReviewsArt } from '@nw/site-v2/illustrations/page-scenes';
import { CARD, PILL_LIGHT, SITE_WIDE } from '@nw/site-v2/kit';
import { TestimonialCard } from '@nw/site-v2/sections/testimonial-card';

/**
 * Northwind booking site v2 — the /reviews wall: every row of `testimonials`,
 * server-rendered, in the home page's flat cards. Same reads as v1
 * (`components/sections/real-stories-section.tsx`).
 *
 * Before there are any, the page says so plainly in the operator's own words
 * (`reviews / feedback_cta.empty_state_message`) and points at the cars —
 * no made-up reviews. Under the wall, the operator's ask to past renters
 * (`reviews / feedback_cta`), shown once they have written it.
 */
/**
 * Sample reviews for looking at the layout on a dev server only: shown in
 * place of an empty wall (`/reviews?sample=0` shows the real empty state).
 * Never in a production build, never stored.
 */
const SAMPLE_REVIEWS: readonly TestimonialItem[] = [
  { id: 's1', author: 'Maria G.', source: 'Google', stars: 5, quote: 'Picked the car up at 7am, keys were ready and the price was exactly what the site said. No upsell at the counter at all.' },
  { id: 's2', author: 'James T.', source: 'Weekly rental', stars: 5, quote: 'Rented a Telluride for a week in the mountains. Spotless, full tank, and they answered the phone on a Sunday when I had a question about the tolls.' },
  { id: 's3', author: 'Priya S.', source: 'Google', stars: 4, quote: 'Easy booking and a fair deposit. Return took two minutes. Only wish they opened a bit earlier on weekends.' },
  { id: 's4', author: 'Daniel R.', source: 'Airport run', stars: 5, quote: 'Cheapest quote I found for the airport and the car was newer than the big rental places.' },
  { id: 's5', author: 'Aisha K.', source: 'Monthly rental', stars: 5, quote: 'Kept a Civic for a month while mine was in the shop. The monthly rate saved me a lot and they checked in halfway through.' },
  { id: 's6', author: 'Tom W.', source: 'Google', stars: 5, quote: 'Friendly, quick, no hidden fees. Will book again.' },
];

export async function RealStoriesSection({ sample = false }: { sample?: boolean }) {
  const [rows, cta, editing] = await Promise.all([
    loadTestimonials(),
    loadSection('reviews', 'feedback_cta', DEFAULT_FEEDBACK_CTA),
    isEditMode(),
  ]);
  const real = rows ?? [];
  const stories: readonly TestimonialItem[] =
    sample && real.length === 0 && process.env.NODE_ENV !== 'production' ? SAMPLE_REVIEWS : real;
  const title = cta.title.trim();
  const description = cta.description.trim();
  const button = cta.button_text.trim();
  // "No reviews yet" is the heading already: the operator's message often
  // starts with the same words, so they are not said twice.
  // In the editor the operator edits their words exactly as stored.
  const empty = editing
    ? cta.empty_state_message.trim()
    : cta.empty_state_message
    .trim()
    .replace(/^no reviews yet\s*[\u2014\u2013:,.!-]*\s*/i, '')
    .replace(/^./, (first) => first.toUpperCase());

  return (
    <section {...cmsSection('reviews.feedback_cta', 'Reviews')} className={cn(SITE_WIDE, "pt-12 md:pt-16")}>
      {stories.length > 0 ? (
        <ReviewsBar stories={stories} title={title} description={description} button={button} editing={editing} />
      ) : null}
      {stories.length === 0 ? (
        <div data-reveal className={cn(CARD, 'mx-auto flex max-w-3xl flex-col items-center px-6 pb-12 pt-8 text-center md:pb-16 md:pt-10')}>
          <ReviewsArt className="mb-4 w-[220px] md:w-[260px]" />
          <p className="text-[22px] font-extrabold tracking-[-0.03em] text-pv-fg md:text-[26px]">No reviews yet</p>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-pv-muted-fg md:text-[16px]">
            {empty !== '' || editing ? (
              <Editable path="reviews.feedback_cta.empty_state_message" placeholder="What to say before you have reviews">
                {empty}
              </Editable>
            ) : (
              'We only publish reviews from real rentals, so this page fills up as customers come back.'
            )}
          </p>
          <Link href="/fleet" className={cn(PILL_LIGHT, 'mt-7')}>
            See our cars
          </Link>
        </div>
      ) : (
        <ul data-reveal-group className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {stories.map((story) => (
            <li key={story.id}>
              <TestimonialCard quote={story.quote} author={story.author} stars={story.stars} source={story.source} />
            </li>
          ))}
        </ul>
      )}

      {stories.length === 0 && (title !== '' || button !== '' || editing) ? (
        <div className="mx-auto mt-4 max-w-3xl">
          <ReviewAsk title={title} description={description} button={button} editing={editing} />
        </div>
      ) : null}

    </section>
  );
}

type AskProps = { title: string; description: string; button: string; editing: boolean };

/**
 * The top of the wall: how the reviews add up (the average of the star
 * ratings, and how many there are) beside the operator's ask to past
 * renters. One flat bar, part of the reviews, so it never reads as a second
 * "book now" banner next to the page's closing call.
 */
function ReviewsBar({ stories, ...ask }: AskProps & { stories: readonly TestimonialItem[] }) {
  const rated = stories.filter((story) => story.stars > 0);
  const average = rated.length > 0 ? rated.reduce((sum, story) => sum + story.stars, 0) / rated.length : 0;
  const count = stories.length;
  const showAsk = ask.title !== '' || ask.button !== '' || ask.editing;

  return (
    <div data-reveal className={cn(CARD, 'flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-center lg:gap-8')}>
      <div className="flex items-center gap-4">
        {average > 0 ? (
          <p className="text-[44px] font-extrabold leading-none tracking-[-0.05em] text-pv-fg md:text-[52px]">
            {average.toFixed(1)}
          </p>
        ) : null}
        <div>
          {average > 0 ? <AverageStars value={average} /> : null}
          <p className="mt-1.5 text-[14px] text-pv-muted-fg">
            From {count} {count === 1 ? 'review' : 'reviews'} by people who rented from us
          </p>
        </div>
      </div>
      {showAsk ? (
        <>
          <span aria-hidden className="hidden h-14 w-px bg-pv-border lg:block" />
          <div className="min-w-0 flex-1 border-t border-pv-border pt-5 lg:border-t-0 lg:pt-0">
            <ReviewAsk {...ask} bare />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** The operator's ask to past renters (`reviews / feedback_cta`): their words, set small, with the button. */
function ReviewAsk({ title, description, button, editing, bare = false }: AskProps & { bare?: boolean }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center', !bare && cn(CARD, 'p-5'))}>
      <span aria-hidden className="hidden size-11 shrink-0 place-items-center rounded-xl bg-pv-tint text-pv-primary sm:grid">
        <MessageSquarePlus className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold tracking-[-0.02em] text-pv-fg">
          <Editable path="reviews.feedback_cta.title" placeholder="Ask past renters for a review">
            {title}
          </Editable>
        </p>
        {description !== '' || editing ? (
          <p className="mt-0.5 text-[14px] leading-relaxed text-pv-muted-fg">
            <Editable path="reviews.feedback_cta.description">{description}</Editable>
          </p>
        ) : null}
      </div>
      {button !== '' ? (
        <Link href="/contact" className={cn(PILL_LIGHT, 'h-11 px-5 text-[14px]')}>
          <Editable path="reviews.feedback_cta.button_text">{button}</Editable>
        </Link>
      ) : null}
    </div>
  );
}

/** Five stars filled to the average, so 4.5 shows four and a half. */
function AverageStars({ value }: { value: number }) {
  return (
    <p className="flex items-center gap-0.5" aria-label={`Rated ${value.toFixed(1)} out of 5 on average`}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, value - index));
        return (
          <span key={index} aria-hidden className="relative size-5">
            <Star strokeWidth={1.75} className="absolute inset-0 size-5 text-pv-border" />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star strokeWidth={1.75} className="size-5 fill-pv-warning text-pv-warning" />
            </span>
          </span>
        );
      })}
    </p>
  );
}
