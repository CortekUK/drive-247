'use client';

/**
 * Template 2 ("Glass") — the reviews, read one at a time.
 *
 *   how they add up  the average, then a bar for each star rating with how
 *                    many gave it. A bar is a button: it narrows everything
 *                    to the reviews that gave that rating (again to clear)
 *   the reader       one review, set large in the headline face — the only
 *                    loud thing on the page — with who wrote it and where
 *   the people       every renter in the current list, by initial, name and
 *                    stars; picking one, or the arrows, brings theirs in
 *
 * Nothing moves on its own: a review changes only when someone asks, and the
 * new one settles in (none for reduced motion). The people row is a tablist
 * and the reader its panel, so the arrow keys walk the reviews.
 */

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react-nw';

import { Editable } from '@nw/lib/cms/editable';
import type { TestimonialItem } from '@nw/lib/cms/types';
import { cn } from '@nw/lib/utils';
import { T2Count } from '@nw/template-2/count-up';
import { t2Href } from '@nw/template-2/links';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

type Ask = { title: string; text: string; button: string; editing: boolean };

export function ReviewsReader({ stories, ask }: { stories: readonly TestimonialItem[]; ask: Ask }) {
  const [rating, setRating] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const rated = stories.filter((story) => story.stars > 0);
  const average = rated.length > 0 ? rated.reduce((sum, story) => sum + story.stars, 0) / rated.length : 0;
  const counts = useMemo(() => [5, 4, 3, 2, 1].map((n) => ({ n, count: stories.filter((story) => Math.round(story.stars) === n).length })), [stories]);
  const most = Math.max(1, ...counts.map((row) => row.count));

  const list = rating === null ? stories : stories.filter((story) => Math.round(story.stars) === rating);
  const index = Math.min(current, Math.max(0, list.length - 1));
  const story = list[index];

  const go = (next: number, focus = false) => {
    const wrapped = (next + list.length) % list.length;
    setCurrent(wrapped);
    if (focus) tabs.current[wrapped]?.focus();
  };
  const filter = (n: number) => {
    setRating((now) => (now === n ? null : n));
    setCurrent(0);
  };
  const showAsk = ask.title !== '' || ask.button !== '' || ask.editing;

  return (
    <div className="grid gap-3 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* How they add up, and the ask to past renters. */}
      <aside className="g2-well g2-tray flex flex-col rounded-[28px] p-6 max-lg:order-last sm:p-7">
        <div className="flex items-end gap-3">
          <p className="text-[64px] font-semibold leading-[0.85] tracking-[-0.06em] text-[var(--g2-ink)] tabular-nums">
            <T2Count to={average} decimals={1} />
          </p>
          <div className="pb-1">
            <Stars value={average} className="size-4" label={`Rated ${average.toFixed(1)} out of 5 on average`} />
            <p className="mt-1 text-[13.5px] text-[var(--g2-ink-soft)]">
              {stories.length} {stories.length === 1 ? 'review' : 'reviews'}
            </p>
          </div>
        </div>

        <ul aria-label="Show reviews by rating" className="mt-6 space-y-1">
          {counts.map(({ n, count }) => {
            const on = rating === n;
            return (
              <li key={n}>
                <button
                  type="button"
                  disabled={count === 0}
                  aria-pressed={on}
                  onClick={() => filter(n)}
                  className={cn(
                    'grid w-full grid-cols-[28px_minmax(0,1fr)_20px] items-center gap-3 rounded-full px-2.5 py-1.5 text-[13.5px] transition-colors duration-200 disabled:cursor-default',
                    on ? 'bg-white shadow-[0_4px_12px_-8px_var(--g2-accent)]' : 'enabled:hover:bg-white/55',
                    FOCUS,
                  )}
                >
                  <span className="flex items-center gap-0.5 font-semibold text-[var(--g2-ink)]">
                    {n}
                    <Star aria-hidden className="size-3 fill-amber-400 text-amber-400" />
                  </span>
                  <span aria-hidden className="h-2 overflow-hidden rounded-full bg-[rgb(13_12_29/0.07)]">
                    <span
                      className={cn('block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', on ? 'bg-[var(--g2-accent)]' : 'bg-[color-mix(in_oklab,var(--g2-accent)_55%,white)]')}
                      style={{ width: `${(count / most) * 100}%` }}
                    />
                  </span>
                  <span className="text-right tabular-nums text-[var(--g2-ink-soft)]">
                    {count}
                    <span className="sr-only"> {count === 1 ? 'review' : 'reviews'} with {n} stars</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {showAsk ? (
          <div className="mt-6 border-t border-[rgb(13_12_29/0.08)] pt-5 lg:mt-auto">
            <p className="text-[16px] font-semibold tracking-[-0.02em] text-[var(--g2-ink)]">
              <Editable path="reviews.feedback_cta.title" placeholder="Ask past renters for a review">
                {ask.title}
              </Editable>
            </p>
            {ask.text !== '' || ask.editing ? (
              <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--g2-ink-soft)]">
                <Editable path="reviews.feedback_cta.description">{ask.text}</Editable>
              </p>
            ) : null}
            {ask.button !== '' ? (
              <Link
                href={t2Href('/contact')}
                className={cn(
                  'mt-4 inline-flex h-11 items-center rounded-full bg-white px-5 text-[14.5px] font-semibold text-[var(--g2-on-light)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.4),inset_0_1px_0_#fff]',
                  FOCUS,
                )}
              >
                <Editable path="reviews.feedback_cta.button_text">{ask.button}</Editable>
              </Link>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* The reader, and the people under it. */}
      <div className="flex min-w-0 flex-col gap-3">
        <div
          id="g2-review-panel"
          role="tabpanel"
          aria-labelledby={story ? `g2-review-tab-${story.id}` : undefined}
          className="relative flex min-h-[340px] flex-1 flex-col rounded-[28px] bg-white/70 px-6 py-8 shadow-[inset_0_1px_0_#fff,0_18px_40px_-30px_rgb(13_12_29/0.45)] sm:px-12 sm:py-12"
        >
          {story ? (
            <figure key={story.id} className="g2-msg-in flex flex-1 flex-col">
              {story.stars > 0 ? <Stars value={story.stars} className="size-5" label={`${story.stars} out of 5`} /> : <span aria-hidden className="h-5" />}
              {/* Every quote sits in the same cell, only the chosen one visible, so the
                  panel is always as tall as the longest and the page never jumps. */}
              <blockquote className="mt-6 grid flex-1">
                {stories.map((item) => (
                  <p
                    key={item.id}
                    aria-hidden={item.id !== story.id}
                    className={cn(
                      'max-w-[30ch] text-[24px] font-medium leading-[1.3] tracking-[-0.025em] text-[var(--g2-ink)] [grid-area:1/1] [text-wrap:pretty] sm:text-[32px] lg:text-[36px]',
                      item.id !== story.id && 'invisible',
                    )}
                  >
                    {item.quote}
                  </p>
                ))}
              </blockquote>
              <figcaption className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 items-center gap-3">
                  <Initial name={story.author} large />
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-semibold text-[var(--g2-ink)]">{story.author}</span>
                    <span className="block truncate text-[14px] text-[var(--g2-ink-soft)]">{story.source || '\u00a0'}</span>
                  </span>
                </span>
                {list.length > 1 ? (
                  <span className="flex items-center gap-2">
                    <span className="mr-1 text-[13.5px] tabular-nums text-[var(--g2-ink-soft)]">
                      {index + 1} of {list.length}
                    </span>
                    <button type="button" aria-label="Previous review" onClick={() => go(index - 1)} className={cn('grid size-11 place-items-center rounded-full bg-[rgb(13_12_29/0.05)] text-[var(--g2-ink)] hover:bg-[rgb(13_12_29/0.09)]', FOCUS)}>
                      <ChevronLeft aria-hidden className="size-5" />
                    </button>
                    <button type="button" aria-label="Next review" onClick={() => go(index + 1)} className={cn('g2-cta grid size-11 place-items-center rounded-full', FOCUS)}>
                      <ChevronRight aria-hidden className="size-5" />
                    </button>
                  </span>
                ) : null}
              </figcaption>
            </figure>
          ) : null}
        </div>

        <div
          role="tablist"
          aria-label="Reviewers"
          className="g2-well g2-tray flex gap-1.5 overflow-x-auto rounded-[24px] p-1.5"
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') go(index + 1, true);
            else if (event.key === 'ArrowLeft') go(index - 1, true);
            else return;
            event.preventDefault();
          }}
        >
          {list.map((item, i) => {
            const on = i === index;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                id={`g2-review-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="g2-review-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => setCurrent(i)}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-[18px] py-2 pl-2 pr-4 text-left transition-colors duration-200',
                  on ? 'bg-white shadow-[0_6px_16px_-12px_var(--g2-accent)]' : 'hover:bg-white/55',
                  FOCUS,
                )}
              >
                <Initial name={item.author} on={on} />
                <span>
                  <span className="block whitespace-nowrap text-[14px] font-semibold text-[var(--g2-ink)]">{item.author}</span>
                  {item.stars > 0 ? <Stars value={item.stars} className="size-3" label={`${item.stars} out of 5`} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Initial({ name, on = false, large = false }: { name: string; on?: boolean; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        large ? 'size-12 text-[17px]' : 'size-9 text-[14px]',
        on || large ? 'g2-cta' : 'bg-white/80 text-[var(--g2-accent-ink)] shadow-[inset_0_1px_0_#fff]',
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Five stars filled to the value, so 4.5 shows four and a half. */
function Stars({ value, className, label }: { value: number; className: string; label: string }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={label}>
      {Array.from({ length: 5 }, (_, index) => {
        const fill = Math.max(0, Math.min(1, value - index));
        return (
          <span key={index} aria-hidden className={cn('relative', className)}>
            <Star strokeWidth={0} className={cn('absolute inset-0 fill-[rgb(13_12_29/0.13)]', className)} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star strokeWidth={0} className={cn('fill-amber-400', className)} />
            </span>
          </span>
        );
      })}
    </span>
  );
}
