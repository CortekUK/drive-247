"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sparkle } from "lucide-react";

/**
 * Trax introducing itself on the login hero.
 *
 * The one rule here is that Trax must not appear to know anything it cannot
 * know. Nobody is signed in yet, so there is no fleet to look at — a line like
 * "you have 3 rentals due back" would be invented, and the first thing the
 * operator would do after signing in is discover it was false. What Trax *can*
 * honestly do is greet by the clock, name the tenant it lives in, and teach one
 * real thing it can be asked. So the personalisation is genuine and the
 * capability is a promise the product actually keeps.
 *
 * The prompts are drawn from the same well as the sidebar's search hints, so
 * the voice a new operator meets here is the voice they meet inside.
 */

const TRAX_ASKS = [
  "what's overdue today",
  "which cars are idle",
  "who's late paying",
  "which cars need service",
  "for a fleet overview",
  "what's pending today",
  "how deposits work",
];

const ROTATE_MS = 4200;

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function TraxLoginTip({ appName }: { appName: string }) {
  const reduceMotion = useReducedMotion();
  // Resolved on the client only. The server renders in UTC, so reading the
  // clock during render would greet half the world with the wrong time of day
  // and trip a hydration mismatch on the way.
  const [greeting, setGreeting] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % TRAX_ASKS.length),
      ROTATE_MS
    );
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <div className="max-w-md rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
      <div className="flex items-center gap-2 text-white/70">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/15">
          <Sparkle className="h-3 w-3" />
        </span>
        <span className="text-xs font-medium tracking-wide">Trax</span>
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-white/90">
        {/* Until the clock resolves, the sentence still reads correctly — it
            just starts a beat later, rather than flashing the wrong greeting. */}
        {greeting ? `${greeting}. ` : ""}
        I&apos;m Trax, your assistant inside {appName}. Once you&apos;re in, ask me{" "}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={index}
            className="inline-block font-medium text-white"
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.28 }}
          >
            {TRAX_ASKS[index]}
          </motion.span>
        </AnimatePresence>
        .
      </p>
    </div>
  );
}

export default TraxLoginTip;
