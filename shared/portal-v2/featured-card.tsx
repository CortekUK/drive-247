"use client";

/**
 * The featured card: the narrow card beside a hero chart ("Availability" on the
 * operator's Vehicles tab, "Payments" on the customer's Bookings page). Lifted
 * from apps/portal/src/components/shared/featured-deck-view-v2.tsx, which now
 * imports it from here; the deck's rotation, dots and gating stay there.
 *
 * Its look: a big heavy title top-left that stacks after its first word, and
 * along the bottom a one-line description and an accent "Open →" cue. Colours
 * come from the shared `v2-*` utilities so it paints the same in both portals.
 */

import type { HTMLAttributes, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "./cn";

/**
 * Minimal: a soft primary-tinted ground and a hairline border that deepens to
 * purple on hover. No glows, no lift, no shadow (team lead, Sep 16 2026).
 */
export const FEATURED_SHELL_CLASS =
  // The dashboard feature card's ACCENT look (feature-announcement-deck.tsx),
  // so every featured card in the app is one family (Ghulam, Oct 2 2026): a
  // translucent white wash with the faintest accent tint, a near-invisible
  // hairline that deepens on hover, no shadow.
  "group/deck relative isolate flex min-h-[15rem] flex-col overflow-hidden rounded-2xl border border-white/80 " +
  "bg-[linear-gradient(145deg,rgba(255,255,255,0.72)_0%,rgba(238,238,252,0.55)_100%)] text-v2-fg " +
  "transition-colors duration-200 hover:border-v2-primary/30 motion-reduce:transition-none " +
  "dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(255,255,255,0.06)_0%,rgba(91,91,214,0.10)_100%)]";

/** The surface a card's link or button fills: the whole card is the target. */
export const FEATURED_ACTION_CLASS =
  "relative flex min-h-0 flex-1 flex-col justify-between rounded-2xl px-5 pt-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-v2-ring";

export function FeaturedCardShell({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & { children?: ReactNode; "data-tour"?: string; "data-motion"?: string }) {
  return (
    // A promo, not data: the auto skeleton shows every featured card as it is.
    <section className={cn(FEATURED_SHELL_CLASS, className)} data-skeleton-keep="" {...rest}>
      {children}
    </section>
  );
}

/**
 * The face, laid out like the dashboard's feature card: a big heavy title that
 * stacks after its first word, top-left, and along the bottom the one-line
 * description and an accent "Open" cue. No illustration (Ghulam, Oct 2 2026:
 * "just the heading and descriptions") — `art` is accepted and ignored.
 */
const STACK_AFTER_CHARS = 10;
function stackTitle(title: string) {
  const trimmed = title.trim();
  const space = trimmed.indexOf(" ");
  if (trimmed.length <= STACK_AFTER_CHARS || space === -1) return trimmed;
  return (
    <>
      {trimmed.slice(0, space)}
      <br />
      {trimmed.slice(space + 1)}
    </>
  );
}

export function FeaturedCardFace({ title, subtitle }: { title: string; subtitle: string; art?: string }) {
  return (
    <>
      <h3
        className="relative line-clamp-2 max-w-[10.5ch] pb-[0.1em] text-[26px] font-black leading-[1] tracking-[-0.04em] text-neutral-950 dark:text-white"
        title={title}
      >
        {stackTitle(title)}
      </h3>
      <div className="relative min-w-0">
        <p className="truncate text-[13px] leading-5 text-neutral-600 dark:text-neutral-300" title={subtitle}>
          {subtitle}
        </p>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#5b5bd6] dark:text-v2-link">
          Open
          <ArrowRight aria-hidden className="size-3.5 transition-transform duration-200 group-hover/deck:translate-x-0.5 motion-reduce:transition-none" />
        </span>
      </div>
    </>
  );
}
