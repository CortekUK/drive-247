import { Users } from "lucide-react";

import { MarqueeStrip } from "@/components/sections/marquee-strip";
import { REVIEWS } from "@/lib/fixtures/reviews";
import type { Review } from "@/lib/fixtures/reviews";

export function RealStoriesSection() {
  return (
    <section className="bg-white">
      <div className="container-page py-12 lg:py-20">
        <header className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-brand-text text-white">
            <Users className="size-5" strokeWidth={2} />
          </span>
          <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl">
            Real Stories, Real Miles
          </h2>
          <p className="mx-auto mt-3 max-w-[480px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            From late-night landings to weekend escapes, here’s how we keep the
            road open.
          </p>
        </header>

        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {REVIEWS.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </ul>
      </div>

      <MarqueeStrip />
    </section>
  );
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <li className="flex flex-col gap-4 rounded-[14px] border border-brand-border-soft bg-white p-5 transition-shadow hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)]">
      <p className="flex-1 text-[13px] leading-[20px] text-brand-text-soft">
        “{review.quote}”
      </p>
      <div className="flex items-center gap-3">
        <Avatar />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight text-brand-text">
            {review.author}
          </p>
          <p className="text-[11px] leading-tight text-brand-text-subtle">
            Rented: {review.rented}
          </p>
        </div>
      </div>
    </li>
  );
}

function Avatar() {
  return (
    <span
      aria-hidden
      className="inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#c8a07a,#8b6342)] text-white"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="9" r="3.5" fill="currentColor" />
        <path
          d="M5 19c0-3 3-5 7-5s7 2 7 5"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
