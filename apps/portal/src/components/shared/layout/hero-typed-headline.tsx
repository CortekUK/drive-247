"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * The login hero: a feature headline typed out with its keyword in the accent,
 * a line of explanation underneath, then on to the next.
 *
 * Every entry names something the portal actually ships — the list was taken
 * from the dashboard routes and settings tabs rather than written from
 * memory — because a login screen is a poor place to promise something the
 * operator will not find once they are inside.
 */

/**
 * `before` / `key` / `after` rather than one string, because the accent falls on
 * the keyword alone and the typewriter reveals a character at a time, so the
 * boundary has to be known by index. Searching for the keyword in the visible
 * substring would also colour the wrong copy whenever a word appears twice.
 *
 * Headlines are kept to ~30 characters and `sub` to ~92: at the `lg` breakpoint
 * the hero column is about 416px, which is roughly sixteen headline characters
 * and forty-six sub characters to a line. Both must stay within two lines —
 * the reservations below are sized for exactly that, and a third line would
 * push past them and shift the block rather than simply clip.
 */
interface Feature {
  before: string;
  key: string;
  after: string;
  sub: string;
}

const FEATURES: Feature[] = [
  {
    before: "Ask ",
    key: "Trax",
    after: " anything.",
    sub: "Which cars are idle, who's late paying, what's due back — one question, one straight answer.",
  },
  {
    before: "Your ",
    key: "website",
    after: ", your words.",
    sub: "Edit pages, photos and pricing copy on your booking site without touching code.",
  },
  {
    before: "",
    key: "Insurance",
    after: " at checkout.",
    sub: "Customers add Bonzah cover as they book — quote, policy and payment, all in the flow.",
  },
  {
    before: "",
    key: "Agreements",
    after: " signed in minutes.",
    sub: "Send for e-signature through BoldSign, chase what's outstanding, file the signed PDF.",
  },
  {
    before: "Your own ",
    key: "contract",
    after: " wording.",
    sub: "Build agreement templates with your terms and merge fields, then reuse them every booking.",
  },
  {
    before: "",
    key: "Deposits",
    after: " held, not chased.",
    sub: "Pre-authorise on the card, then capture or release it when the car comes back.",
  },
  {
    before: "Hand over keys with a ",
    key: "code",
    after: ".",
    sub: "Lockbox collection, with the code sent by email or SMS as the rental starts.",
  },
  {
    before: "Your whole ",
    key: "fleet",
    after: ", one screen.",
    sub: "Availability, blocked dates and every booking laid out across a single calendar.",
  },
  {
    before: "",
    key: "Profit",
    after: " you can see.",
    sub: "Log expenses against each vehicle and watch the P&L move with real rental revenue.",
  },
  {
    before: "",
    key: "Fines",
    after: " find their driver.",
    sub: "Match a ticket to the rental and the customer automatically, then recover the cost.",
  },
  {
    before: "",
    key: "Follow-ups",
    after: " send themselves.",
    sub: "Turn enquiries into quotes, and let automations chase the ones going cold.",
  },
  {
    before: "One ",
    key: "inbox",
    after: " for every customer.",
    sub: "Chat and SMS in one thread, tied to the booking it belongs to.",
  },
];

const headlineOf = (f: Feature) => f.before + f.key + f.after;

const TYPE_MS = 40;
const ERASE_MS = 18;
/** Long enough to read the sub-line, which is the slower half of each card. */
const HOLD_MS = 3400;

interface HeroTypedHeadlineProps {
  appName: string;
  /**
   * The accent, already pushed to a lightness that reads against the panel —
   * see `brandInk`. The raw accent cannot be used: the panel behind this *is* a
   * pale tint of that same accent, so at full strength the two sit about 2.5:1
   * apart and the keyword goes muddy on its own background.
   */
  accentInk: string;
  /**
   * Whether the hero is a dark ground, which now only happens when a tenant has
   * uploaded a hero photograph — the route itself is forced light. The
   * non-keyword copy is near-black on the tint and has to invert there.
   */
  onDark: boolean;
  /**
   * Small-screen scale. The type drops from 48/60px to 26px and the sub-line
   * from 18 to 14, but nothing else changes — both reservations are expressed
   * in `em`, so they follow the font size down and keep holding exactly two
   * lines. That is the reason `leading` stays at 1.1 and 1.625 here rather than
   * being tuned per size: the reservations are 2.2em and 3.25em, which are two
   * lines *of those leadings*, and changing one without the other silently
   * reintroduces the shift.
   */
  compact?: boolean;
}

export function HeroTypedHeadline({
  appName,
  accentInk,
  onDark,
  compact = false,
}: HeroTypedHeadlineProps) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;

    const headline = headlineOf(FEATURES[index]);

    if (!erasing) {
      if (charCount < headline.length) {
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
    setIndex((i) => (i + 1) % FEATURES.length);
    setErasing(false);
  }, [charCount, erasing, index, reduceMotion]);

  const feature = reduceMotion ? FEATURES[0] : FEATURES[index];
  const revealed = reduceMotion ? headlineOf(feature).length : charCount;

  // How much of each segment is typed. Clamped per segment so the accent turns
  // on at the keyword's first character and off after its last, even mid-word.
  const beforeShown = feature.before.slice(0, revealed);
  const keyShown = feature.key.slice(
    0,
    Math.max(0, revealed - feature.before.length)
  );
  const afterShown = feature.after.slice(
    0,
    Math.max(0, revealed - feature.before.length - feature.key.length)
  );

  // The sub-line is not typed — two things typing at once is noise. It fades in
  // once the headline it belongs to is complete, and back out before the
  // headline is erased, so the two are never mismatched on screen.
  const subVisible =
    reduceMotion || (!erasing && revealed === headlineOf(feature).length);

  const headlineSize = compact ? "text-[26px]" : "text-5xl xl:text-6xl";
  const subSize = compact ? "mt-2 text-sm" : "mt-4 max-w-lg text-lg";
  const baseColor = onDark ? "text-white" : "text-slate-900";

  // Centred at the compact scale: on a phone the brand mark above this is
  // centred too, and a left-aligned block under a centred mark reads as two
  // different columns. The desktop hero stays left — there it lines up with the
  // logo and the footer down the same edge.
  return (
    <div className={`grid ${compact ? "text-center" : "max-w-xl"}`}>
      {/* Height reservation, by example rather than by number.

          Every feature is rendered once, invisibly, stacked in the same grid
          cell as the live one. The cell ends up as tall as the tallest card, so
          the form below never moves — and it works out that height itself, at
          whatever width and font size it finds, from the copy that is actually
          there. The previous approach reserved a fixed line count on the
          headline *and* on the sub separately, which held the layout still but
          left a whole unused line of air under any one-line headline. It also
          had to be re-derived by hand every time the copy or the scale changed,
          and was wrong at 320px twice.

          `invisible` keeps these out of the accessibility tree as well as out
          of sight; the live copy below is `aria-hidden` and the `sr-only` list
          at the end is what actually gets read. */}
      {FEATURES.map((f, i) => (
        <div
          key={`measure-${i}`}
          aria-hidden="true"
          className="invisible col-start-1 row-start-1"
        >
          <p className={`${headlineSize} font-extrabold leading-[1.1] tracking-tight`}>
            {headlineOf(f)}
          </p>
          <p className={`${subSize} leading-relaxed`}>{f.sub}</p>
        </div>
      ))}

      <div className="col-start-1 row-start-1">
        {/* Top-anchored, and that is the whole point. Pinning the headline to
            the bottom of its box moved its *first* line: a one-line entry sat
            low and a two-line entry sat high, so the copy jumped between
            features — and jumped again mid-typing, the moment a line wrapped
            and pushed what was already on screen upward. Anchored at the top,
            nothing you are reading ever moves. */}
        <p
          aria-hidden="true"
          className={`${headlineSize} ${baseColor} font-extrabold leading-[1.1] tracking-tight`}
        >
          {/* Adjacent on purpose. A newline between two of these would be a
              whitespace text node inside the sentence, adding a space that is
              not in the copy and moving where the line wraps. */}
          {beforeShown}
          <span style={{ color: accentInk }}>{keyShown}</span>
          {afterShown}
          {/* The caret takes no width in the layout, and that is load-bearing
              rather than tidy. As a 4px inline-block with a 4px margin it added
              8px of advance to the end of the line, which was enough to push
              the last word onto a third line on the longer headlines — a line
              past the reservation, so the whole block moved. Measuring the
              strings alone had said they fit; the caret was the difference
              between that and what actually rendered.

              A zero-width wrapper with the bar positioned out of flow keeps it
              visible without letting it vote on where the text breaks. */}
          {!reduceMotion && (
            <span className="relative inline-block h-[0.8em] w-0 align-middle">
              {/* `bg-current` rather than a fixed black: it inherits the
                  headline's own colour, so the caret is near-black on the tint
                  and turns white by itself on a photograph hero, with nothing
                  extra to keep in sync.

                  Blinks on a hard on/off. `animate-pulse` was the wrong tool —
                  it is a soft ease between full and half opacity, which reads
                  as a throb rather than a cursor. Holding each state flat and
                  crossing in 10ms gives the square edge a real caret has. */}
              <motion.span
                className="absolute inset-y-0 left-[4px] w-[4px] rounded-full bg-current"
                animate={{ opacity: [1, 1, 0, 0] }}
                transition={{
                  duration: 1.06,
                  times: [0, 0.49, 0.5, 1],
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
            </span>
          )}
        </p>

        {/* Sits directly under the headline rather than in a slot of its own,
            so a short headline no longer leaves a line of air above this. It
            moves with the headline's line count, but it fades and rises on
            every change anyway, so it arrives in its new position rather than
            being seen to jump to it.

            Rising rather than only fading makes it read as the second beat of
            one motion; leaving the same way before the erase keeps the pair
            from ever showing two different features at once. */}
        <p
          aria-hidden="true"
          className={`${subSize} leading-relaxed transition-all duration-500 ease-out ${
            subVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          } ${onDark ? "text-white/75" : "text-slate-900/65"}`}
        >
          {feature.sub}
        </p>
      </div>

      <span className="sr-only">
        {appName} —{" "}
        {FEATURES.map((f) => `${headlineOf(f)} ${f.sub}`).join(" ")}
      </span>
    </div>
  );
}

export default HeroTypedHeadline;
