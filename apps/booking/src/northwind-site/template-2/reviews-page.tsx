import Link from 'next/link';
import { ArrowRight, Star } from 'lucide-react-nw';

import { DEFAULT_FEEDBACK_CTA, DEFAULT_REVIEWS_HERO } from '@nw/lib/cms/defaults';
import { Editable, cmsSection } from '@nw/lib/cms/editable';
import { isEditMode, loadSection, loadTestimonials } from '@nw/lib/cms/server';
import type { TestimonialItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { SAMPLE_REVIEWS } from '@nw/site-v2/sections/real-stories-section';
import { t2Href } from '@nw/template-2/links';
import { ReviewsReader } from '@nw/template-2/reviews-reader';

/**
 * Template 2 ("Glass") — Reviews (/template-2/reviews).
 *
 *   the opening  the operator's headline and line (`reviews / hero`)
 *   the reviews  read one at a time (`reviews-reader.tsx`): how the ratings
 *                add up, as bars that narrow the list to one rating, beside
 *                one review set large, with every renter in a row beneath to
 *                pick from; the operator's ask to past renters
 *                (`reviews / feedback_cta`) under the bars
 *
 * Same reads as site-v2. Before there are any reviews, the operator's own
 * empty-state words and the way to the cars; no made-up reviews. On a dev
 * server only, an empty wall shows site-v2's sample reviews to see the
 * layout (`?sample=0` shows the real empty state).
 */

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
const PAGE = 'mx-auto w-full max-w-[1320px] px-3 sm:px-5';
const PANE = 'g2-glass rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:rounded-[40px]';
const WHITE_PILL =
  'inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-semibold text-[var(--g2-on-light)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.4),inset_0_1px_0_#fff]';

export async function Template2ReviewsPage({ sample }: { sample: boolean }) {
  const [rows, hero, ask, editing] = await Promise.all([
    loadTestimonials(),
    loadSection('reviews', 'hero', DEFAULT_REVIEWS_HERO),
    loadSection('reviews', 'feedback_cta', DEFAULT_FEEDBACK_CTA),
    isEditMode(),
  ]);
  const real = rows ?? [];
  const stories: readonly TestimonialItem[] =
    sample && real.length === 0 && process.env.NODE_ENV !== 'production' ? SAMPLE_REVIEWS : real;

  const title = hero.title.trim() || DEFAULT_REVIEWS_HERO.title;
  const subtitle = hero.subtitle.trim();
  const askTitle = ask.title.trim();
  const askText = ask.description.trim();
  const askButton = ask.button_text.trim();
  const showAsk = askTitle !== '' || askButton !== '' || editing;
  // "No reviews yet — …": the heading already says the first half.
  const empty = editing
    ? ask.empty_state_message.trim()
    : ask.empty_state_message
        .trim()
        .replace(/^no reviews yet\s*[—–:,.!-]*\s*/i, '')
        .replace(/^./, (first) => first.toUpperCase());


  return (
    <div className="space-y-3 pb-3">
      <section {...cmsSection('reviews.feedback_cta', 'Reviews')} aria-labelledby="g2-reviews-title" className={cn(PAGE, 'pt-[84px] sm:pt-[96px]')}>
        <div className={PANE}>
          <header {...cmsSection('reviews.hero', 'Hero')} className="px-2 pb-6 pt-6 text-center sm:px-3 sm:pb-8 sm:pt-10">
            <h1
              id="g2-reviews-title"
              className="mx-auto max-w-[16ch] text-[38px] font-semibold leading-[1.02] tracking-[-0.045em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[56px] lg:text-[64px]"
            >
              <Editable path="reviews.hero.title">{title}</Editable>
            </h1>
            {subtitle ? (
              <p className="mx-auto mt-3 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[18px]">
                <Editable path="reviews.hero.subtitle">{subtitle}</Editable>
              </p>
            ) : null}
          </header>

          {stories.length > 0 ? (
            <ReviewsReader stories={stories} ask={{ title: askTitle, text: askText, button: askButton, editing }} />
          ) : (
            <>
              <div className="g2-well g2-tray flex flex-col items-center rounded-[30px] px-6 py-12 text-center sm:py-14">
                <p className="text-[24px] font-semibold tracking-[-0.035em] text-[var(--g2-ink)] sm:text-[30px]">No reviews yet</p>
                <p className="mt-3 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] [text-wrap:balance] sm:text-[16px]">
                  {empty !== '' || editing ? (
                    <Editable path="reviews.feedback_cta.empty_state_message" placeholder="What to say before you have reviews">
                      {empty}
                    </Editable>
                  ) : (
                    'We only publish reviews from real rentals, so this page fills up as customers come back.'
                  )}
                </p>
                <Link href={t2Href('/fleet')} className={cn('g2-cta mt-7 inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold', FOCUS)}>
                  See our cars
                  <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
                </Link>
              </div>
              {showAsk ? (
                <div className="g2-well g2-tray mt-3 rounded-[28px] p-5 sm:p-6">
                  <Ask title={askTitle} text={askText} button={askButton} editing={editing} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** One review: the renter's words in a bubble, their name underneath. */
export function ReviewBubble({ story }: { story: TestimonialItem }) {
  const initial = story.author.trim().charAt(0).toUpperCase() || '?';
  return (
    <li>
      <figure>
        <blockquote className="relative rounded-[24px] rounded-bl-[8px] bg-white/60 px-5 pb-5 pt-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.9),0_10px_26px_-20px_rgb(13_12_29/0.45)]">
          {story.stars > 0 ? <Stars value={story.stars} size="size-4" label={`${story.stars} out of 5`} /> : null}
          <p className="mt-2.5 text-[15.5px] leading-relaxed text-[var(--g2-ink)]">{story.quote}</p>
        </blockquote>
        <figcaption className="mt-2.5 flex items-center gap-2.5 pl-1">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-white/80 text-[13px] font-semibold text-[var(--g2-accent-ink)] shadow-[inset_0_1px_0_#fff]">
            {initial}
          </span>
          <span className="min-w-0 truncate text-[14px] font-semibold text-[var(--g2-ink)]">{story.author}</span>
          {story.source ? <span className="min-w-0 truncate text-[13.5px] text-[var(--g2-ink-soft)]">{story.source}</span> : null}
        </figcaption>
      </figure>
    </li>
  );
}

/** The operator's ask to past renters: their words, and the button to Contact. */
function Ask({ title, text, button, editing }: { title: string; text: string; button: string; editing: boolean }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--g2-ink)]">
          <Editable path="reviews.feedback_cta.title" placeholder="Ask past renters for a review">
            {title}
          </Editable>
        </p>
        {text !== '' || editing ? (
          <p className="mt-0.5 text-[14px] leading-relaxed text-[var(--g2-ink-soft)]">
            <Editable path="reviews.feedback_cta.description">{text}</Editable>
          </p>
        ) : null}
      </div>
      {button !== '' ? (
        <Link href={t2Href('/contact')} className={cn(WHITE_PILL, 'self-start sm:self-auto', FOCUS)}>
          <Editable path="reviews.feedback_cta.button_text">{button}</Editable>
        </Link>
      ) : null}
    </div>
  );
}

/** Five stars filled to the value, so 4.5 shows four and a half. */
function Stars({ value, size, label }: { value: number; size: string; label: string }) {
  return (
    <p className="flex items-center gap-0.5" role="img" aria-label={label}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, value - index));
        return (
          <span key={index} aria-hidden className={cn('relative', size)}>
            <Star strokeWidth={1.75} className={cn('absolute inset-0 text-[rgb(13_12_29/0.15)]', size)} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star strokeWidth={1.75} className={cn('fill-amber-400 text-amber-400', size)} />
            </span>
          </span>
        );
      })}
    </p>
  );
}
