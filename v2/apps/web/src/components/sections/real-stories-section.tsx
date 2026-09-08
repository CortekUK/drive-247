import { Users } from "lucide-react";
import Link from "next/link";

import { MarqueeStrip } from "@/components/sections/marquee-strip";
import { loadSection, loadTestimonials } from "@/lib/cms/server";
import { DEFAULT_FEEDBACK_CTA } from "@/lib/cms/defaults";
import type { TestimonialItem } from "@/lib/cms/types";

/**
 * The /reviews wall — the same `testimonials` table as the two-up quote band,
 * shown in full rather than sliced to two.
 *
 * Server-rendered end to end, with no client half. Reviews are the whole point
 * of this page: they belong in the HTML for a crawler, and there is nothing on
 * the page for a user to interact with that would make them go stale mid-visit.
 *
 * The heading and standfirst are design constants — the portal has no /reviews
 * section keys at all (its `reviews` CMS page is seeded with zero sections).
 */
export async function RealStoriesSection() {
  const [rows, cta] = await Promise.all([
    loadTestimonials(),
    /* "Before you have reviews" in the portal. It had no consumer, so the
       shipped sentence was the only thing a visitor could ever see here. */
    loadSection("reviews", "feedback_cta", DEFAULT_FEEDBACK_CTA),
  ]);
  /* Ten invented five-star reviews from "Jhon Doe" used to fill this wall for
     any tenant without their own — see the note in `testimonial-quotes.tsx`.
     The page keeps its heading and says plainly that there is nothing here yet,
     which is honest and tells the operator exactly what to do. */
  const stories: readonly TestimonialItem[] = rows ?? [];

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

        {stories.length === 0 ? (
          <p className="mx-auto mt-10 max-w-[420px] text-center text-sm text-brand-text-soft">
            {cta.empty_state_message.trim() ||
              "No reviews yet — they appear here as customers leave them."}
          </p>
        ) : (
          <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {stories.map((story) => (
              <ReviewCard key={story.id} story={story} />
            ))}
          </ul>
        )}
      </div>

      <MarqueeStrip />
    
        {/* "Ask for a review" — shown only once an operator has written it, so
            a tenant who leaves it blank sees no empty box. */}
        {(cta.title.trim() !== "" || cta.description.trim() !== "") && (
          <aside className="mx-auto mt-12 max-w-xl rounded-2xl bg-brand-cream px-6 py-8 text-center ring-1 ring-brand-border-soft">
            {cta.title.trim() !== "" && (
              <h3 className="text-xl font-semibold tracking-tight text-brand-text">
                {cta.title}
              </h3>
            )}
            {cta.description.trim() !== "" && (
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-brand-text-soft">
                {cta.description}
              </p>
            )}
            {cta.button_text.trim() !== "" && (
              <Link
                href="/contact"
                className="mt-5 inline-flex items-center justify-center rounded-full bg-brand-text px-7 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                {cta.button_text}
              </Link>
            )}
          </aside>
        )}
      </section>
  );
}

function ReviewCard({ story }: { story: TestimonialItem }) {
  const source = story.source.trim();

  return (
    <li className="flex flex-col gap-4 rounded-[14px] border border-brand-border-soft bg-white p-5 transition-shadow hover:shadow-[0_4px_18px_rgba(0,0,0,0.06)]">
      <p className="flex-1 text-[13px] leading-[20px] text-brand-text-soft">
        “{story.quote}”
      </p>
      <div className="flex items-center gap-3">
        <Avatar />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight text-brand-text">
            {story.author}
          </p>
          {source !== "" && (
            <p className="text-[11px] leading-tight text-brand-text-subtle">
              {source}
            </p>
          )}
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
