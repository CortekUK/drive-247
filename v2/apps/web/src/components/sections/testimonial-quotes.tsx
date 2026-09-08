"use client";

import { TestimonialCard } from "@/components/cards/testimonial-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTestimonials } from "@/hooks/use-testimonials";
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

  /**
   * No real quotes means NO QUOTES.
   *
   * This used to fall back to the shipped example testimonials, defending it as
   * "the designed copy is the floor, not a placeholder: a tenant nobody has
   * written testimonials for still gets a finished-looking page". What that
   * actually published was invented five-star reviews, signed with invented
   * customer names, praising Drive247 — on a real rental company's own website,
   * presented to their customers as that company's reviews.
   *
   * A finished-looking page is not worth a fabricated one. Fake reviews mislead
   * the customer reading them, they are not the operator's to stand behind, and
   * in most markets publishing them is unlawful. An empty band costs a tenant a
   * little polish until they collect a real review; the alternative costs their
   * customer the truth.
   */
  if (testimonials.length === 0) return null;

  const items = testimonials.slice(0, VISIBLE);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {items.map((testimonial) => (
        <TestimonialCard
          key={testimonial.id}
          quote={testimonial.quote}
          author={testimonial.author}
          rowId={testimonial.id}
        />
      ))}
    </div>
  );
}
