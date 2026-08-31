"use client";

import { TestimonialCard } from "@/components/cards/testimonial-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTestimonials } from "@/hooks/use-testimonials";
import { DEFAULT_TESTIMONIALS } from "@/lib/cms/defaults";
import type { TestimonialItem } from "@/lib/cms/types";

/** The band is a two-up grid; more quotes than that belong on /reviews. */
const VISIBLE = 2;

/**
 * The live half of the testimonial band.
 *
 * `seed` is the server's copy of the same rows, so the browser's first render
 * matches the HTML it is hydrating exactly. It is `null` only when the server
 * could not resolve a tenant — in which case there is genuinely nothing to show
 * yet, and the skeleton below holds the band's height while the query runs
 * rather than letting the page jump when it lands.
 */
export function TestimonialQuotes({ seed }: { seed: TestimonialItem[] | null }) {
  const { testimonials, isLoading } = useTestimonials(seed);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {Array.from({ length: VISIBLE }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-6 rounded-2xl bg-brand-pale-yellow p-8"
          >
            <Skeleton className="size-7 rounded-md bg-brand-text/10" />
            <Skeleton className="h-[104px] w-full bg-brand-text/10" />
            <Skeleton className="h-4 w-28 bg-brand-text/10" />
          </div>
        ))}
      </div>
    );
  }

  // The designed copy is the floor, not a placeholder: a tenant nobody has
  // written testimonials for still gets a finished-looking page.
  const source = testimonials.length > 0 ? testimonials : DEFAULT_TESTIMONIALS;
  const items = source.slice(0, VISIBLE);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {items.map((testimonial) => (
        <TestimonialCard
          key={testimonial.id}
          quote={testimonial.quote}
          author={testimonial.author}
        />
      ))}
    </div>
  );
}
