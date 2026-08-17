"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Sparkle } from "lucide-react";

/**
 * Trax speaking on the login hero: one big line, typed out, then swapped for
 * the next.
 *
 * The rule from the smaller tip it replaces still holds — Trax must not appear
 * to know anything it cannot know. Nobody is signed in, so there is no fleet to
 * look at, and a line like "you have 3 rentals due back" would be invented and
 * disproved the moment they got inside.
 *
 * What is left once that is honoured is still worth saying, as long as it names
 * a real job rather than gesturing at one. Each line below is a thing an
 * operator actually does on a Monday — chasing a car that has not come back,
 * working out who has not paid, finding a booking from half a plate — and each
 * is something Trax genuinely answers, phrased the way a colleague would offer
 * rather than the way a demo would boast.
 */

/**
 * Kept short on purpose, and the limit is measured rather than guessed: at the
 * `lg` breakpoint the hero column gives this about 416px, which is two lines of
 * roughly 34 characters at 36px extrabold. Anything longer wraps to a third
 * line, overflows the reservation below and shunts the greeting down a whole
 * line every time that string comes round. An earlier set ran to 50 characters
 * and did exactly that.
 */
const LINES = [
  "Ask me what's due back today.",
  "I'll find any booking in seconds.",
  "Who's late paying? Just ask.",
  "I'll tell you which cars sit idle.",
  "Need last month's numbers? Ask me.",
];

const TYPE_MS = 42;
const ERASE_MS = 20;
const HOLD_MS = 2000;

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface TraxTypedHeadlineProps {
  appName: string;
  /** Whether the hero is a dark ground. The panel is a pale tint in light mode. */
  onDark: boolean;
  /**
   * The accent, already pushed to a lightness that reads against the panel —
   * see `brandInk`. The raw accent cannot be used: the panel behind this *is*
   * a pale tint of that same accent, so at full strength the two sit about
   * 2.5:1 apart and the headline goes muddy on its own background.
   */
  accentInk: string;
}

export function TraxTypedHeadline({
  appName,
  onDark,
  accentInk,
}: TraxTypedHeadlineProps) {
  const reduceMotion = useReducedMotion();
  const [lineIndex, setLineIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [erasing, setErasing] = useState(false);

  // Resolved on the client only. The server renders in UTC, so reading the
  // clock during render would greet half the world with the wrong time of day
  // and trip a hydration mismatch on the way.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

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
      <div
        className={`flex items-center gap-2 ${
          onDark ? "text-white/70" : "text-slate-900/55"
        }`}
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-md ${
            onDark ? "bg-white/15" : "bg-slate-900/10"
          }`}
        >
          <Sparkle className="h-3 w-3" />
        </span>
        <span className="text-xs font-medium tracking-wide">Trax</span>
      </div>

      {/* The typed line is hidden from assistive tech — a screen reader
          following it letter by letter reads as noise. The sentence below
          carries the same meaning in one piece.

          `min-h` reserves the two lines the longest string wraps to, so the
          copy underneath does not jump every time a line grows or is erased.
          It must be *exactly* two line boxes — `leading-tight` is 1.25, so
          2.5em. At 2.4em a wrapped line overflows the reservation by a tenth of
          a line and the greeting below still shifts, which measured as a 2px
          twitch every time a long string wrapped. */}
      <p
        aria-hidden="true"
        className="mt-4 min-h-[2.5em] text-4xl font-extrabold leading-tight tracking-tight xl:text-5xl"
        style={{ color: accentInk }}
      >
        {shown}
        {!reduceMotion && (
          <span
            className="ml-1 inline-block h-[0.85em] w-[3px] translate-y-[0.08em] animate-pulse rounded-full align-middle"
            style={{ backgroundColor: accentInk, opacity: 0.8 }}
          />
        )}
      </p>

      <span className="sr-only">
        Trax, the assistant built into {appName}, can answer questions about your
        fleet — what is overdue, which cars are idle, who is late paying, and
        more. Sign in to ask.
      </span>

      <p
        className={`mt-5 text-base ${
          onDark ? "text-white/75" : "text-slate-900/65"
        }`}
      >
        {greeting ? `${greeting} — ` : ""}I&apos;m Trax, your assistant inside{" "}
        {appName}. Sign in and just ask.
      </p>
    </div>
  );
}

export default TraxTypedHeadline;
