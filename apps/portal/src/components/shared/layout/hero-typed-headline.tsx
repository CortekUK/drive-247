"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * The login hero's one piece of copy: a feature, typed out, held, erased, and
 * swapped for the next.
 *
 * It no longer speaks as Trax. The chip and the greeting that carried that
 * attribution are gone, so a first-person "I'll find any booking" would be a
 * voice with nobody attached to it. These are statements about the product
 * instead — and every one names something the platform actually does today
 * (deposits held as Stripe pre-auths, BoldSign agreements, lockbox handover,
 * Bonzah at checkout, weekend surcharges), because a login screen is a poor
 * place to promise something the operator will not find inside.
 */

/**
 * Kept short, and the limit is measured rather than guessed. At the `lg`
 * breakpoint the hero column gives this about 416px, which at 48px extrabold is
 * roughly sixteen characters a line. The reservation below is three lines, so
 * the ceiling is about forty-five characters — past that a string wraps to a
 * fourth line and shunts everything under it. A previous set ran to fifty and
 * did exactly that.
 */
const LINES = [
  "Your whole fleet, on one screen.",
  "Agreements signed in minutes.",
  "Deposits taken care of, quietly.",
  "Hand over keys with a lockbox code.",
  "Insurance sorted right at checkout.",
  "Weekend pricing that runs itself.",
];

const TYPE_MS = 42;
const ERASE_MS = 20;
const HOLD_MS = 2200;

interface HeroTypedHeadlineProps {
  appName: string;
  /**
   * The accent, already pushed to a lightness that reads against the panel —
   * see `brandInk`. The raw accent cannot be used: the panel behind this *is* a
   * pale tint of that same accent, so at full strength the two sit about 2.5:1
   * apart and the headline goes muddy on its own background.
   */
  accentInk: string;
}

export function HeroTypedHeadline({ appName, accentInk }: HeroTypedHeadlineProps) {
  const reduceMotion = useReducedMotion();
  const [lineIndex, setLineIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;

    const line = LINES[lineIndex];

    if (!erasing) {
      if (charCount < line.length) {
        const t = setTimeout(() => setCharCount((c) => c + 1), TYPE_MS);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setErasing(true), HOLD_MS);
      return () => clearTimeout(t);
    }

    if (charCount > 0) {
      const t = setTimeout(() => setCharCount((c) => c - 1), ERASE_MS);
      return () => clearTimeout(t);
    }

    // Fully erased — advance. Safe to set state without a timer here: the next
    // pass starts typing rather than re-entering this branch, so it settles.
    setLineIndex((i) => (i + 1) % LINES.length);
    setErasing(false);
  }, [charCount, erasing, lineIndex, reduceMotion]);

  const shown = reduceMotion ? LINES[0] : LINES[lineIndex].slice(0, charCount);

  return (
    <div className="max-w-xl">
      {/* Hidden from assistive tech — a screen reader following the string
          letter by letter reads as noise. The list below carries the same
          content in one piece.

          `min-h` reserves three line boxes at `leading-[1.1]`, so the block
          never changes height as a line grows or is erased. Getting this wrong
          by even a tenth of a line is visible: the whole group is centred
          between the logo and the footer, so any growth shifts it. */}
      <p
        aria-hidden="true"
        className="min-h-[3.3em] text-5xl font-extrabold leading-[1.1] tracking-tight xl:text-6xl"
        style={{ color: accentInk }}
      >
        {shown}
        {!reduceMotion && (
          <span
            className="ml-1 inline-block h-[0.8em] w-[4px] translate-y-[0.06em] animate-pulse rounded-full align-middle"
            style={{ backgroundColor: accentInk, opacity: 0.8 }}
          />
        )}
      </p>

      <span className="sr-only">
        {appName}: {LINES.join(" ")}
      </span>
    </div>
  );
}

export default HeroTypedHeadline;
