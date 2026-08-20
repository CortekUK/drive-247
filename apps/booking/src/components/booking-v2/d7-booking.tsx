"use client";

import dynamic from "next/dynamic";
import { Icon } from "./d7-icons";
import { BlurFade, DotPattern } from "./d7-ui";

/**
 * The real booking flow, inside the booking-v2 page.
 *
 * `next.config.ts` is explicit that the home-page widget is the ONLY booking
 * path — `/booking` redirects here. So a home page without this section cannot
 * take a booking at all, which is why the design's hero search panel hands off
 * to this rather than pretending to be the form.
 *
 * The widget is ~6.5k lines and pulls in Stripe, maps and the vehicle catalogue,
 * so it is loaded on demand: the landing above it paints immediately and this
 * arrives without blocking first render. `ssr: false` matches how the legacy
 * home page runs it (it reads tenant state on the client).
 *
 * Its colours come from the shadcn tokens remapped inside `.d7` in v2.css —
 * that is what makes it look native here instead of pasted in.
 */
const MultiStepBookingWidget = dynamic(
  () => import("@/components/MultiStepBookingWidget"),
  {
    ssr: false,
    loading: () => (
      <div className="grid min-h-[420px] place-items-center rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--white)]">
        <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--v)]" />
          <span className="text-[13px] font-medium">Loading availability…</span>
        </div>
      </div>
    ),
  },
);

export function BookingSection({ title, subtitle, trustPoints }: {
  title?: string;
  subtitle?: string;
  trustPoints?: string[];
}) {
  return (
    <section id="booking" className="relative scroll-mt-20 py-16 sm:py-20">
      <DotPattern className="opacity-40 [mask-image:radial-gradient(620px_circle_at_50%_0%,white,transparent)]" />

      <div className="d7-wrap relative">
        <BlurFade>
          <div className="mx-auto max-w-[42rem] text-center">
            <span className="d7-eyebrow">Reserve your vehicle</span>
            <h2 className="d7-dis d7-h2 mt-3 text-[var(--ink)]">
              {title || "Book Your Rental"}
            </h2>
            {subtitle && <p className="d7-body mx-auto mt-3 max-w-[34rem] text-[14.5px]">{subtitle}</p>}

            {!!trustPoints?.length && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
                {trustPoints.map(point => (
                  <span key={point} className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--ink-2)]">
                    <Icon name="check" className="h-4 w-4 text-[var(--v)]" />
                    {point}
                  </span>
                ))}
              </div>
            )}
          </div>
        </BlurFade>

        {/* d7-embed softens the widget's own card chrome — see v2.css */}
        <BlurFade delay={0.1} y={30}>
          <div className="d7-embed mt-10">
            <MultiStepBookingWidget />
          </div>
        </BlurFade>
      </div>
    </section>
  );
}
