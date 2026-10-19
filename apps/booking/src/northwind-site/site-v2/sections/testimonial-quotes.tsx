'use client';

import { Skeleton } from '@nw/components/ui/skeleton';
import { useTestimonials } from '@nw/hooks/use-testimonials';
import type { TestimonialItem } from '@nw/lib/cms/types';
import { CARD } from '@nw/site-v2/kit';
import { TestimonialCard } from '@nw/site-v2/sections/testimonial-card';

/** The band is a two-up grid; more quotes than that belong on /reviews. */
const VISIBLE = 2;

/**
 * The live half of the v2 testimonial band. Same data and rules as v1
 * (`components/sections/testimonial-quotes.tsx`): seeded by the server, kept
 * live by `useTestimonials`, and no real quotes means no quotes.
 */
export function TestimonialQuotes({ seed }: { seed: TestimonialItem[] | null }) {
  const { testimonials, isLoading } = useTestimonials(seed);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-hidden>
        {Array.from({ length: VISIBLE }, (_, index) => (
          <div key={index} className={`${CARD} flex flex-col gap-4 p-6`}>
            <Skeleton className="h-4 w-24 bg-pv-tint" />
            <Skeleton className="h-16 w-full bg-pv-tint" />
            <Skeleton className="h-9 w-40 bg-pv-tint" />
          </div>
        ))}
      </div>
    );
  }

  if (testimonials.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {testimonials.slice(0, VISIBLE).map((testimonial) => (
        <TestimonialCard
          key={testimonial.id}
          quote={testimonial.quote}
          author={testimonial.author}
          rowId={testimonial.id}
          stars={testimonial.stars}
          source={testimonial.source}
        />
      ))}
    </div>
  );
}
