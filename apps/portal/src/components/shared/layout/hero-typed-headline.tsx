"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

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
 * Headlines are kept under ~34 characters and `sub` under ~92: at the `lg`
 * breakpoint the hero column is about 416px, which is roughly sixteen headline
 * characters and forty-six sub characters to a line. Both reservations below
 * are three lines, and the whole group is centred between the logo and the
 * footer — so anything that overruns does not just clip, it slides the block.
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
    sub: "Lockbox collection, with the code sent by email, SMS or WhatsApp as the rental starts.",
  },
  {
    before: "Your whole ",
    key: "fleet",
    after: ", on one screen.",
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
    after: " that send themselves.",
    sub: "Turn enquiries into quotes, and let automations chase the ones going cold.",
  },
  {
    before: "One ",
    key: "inbox",
    after: " for every customer.",
    sub: "Chat, SMS and WhatsApp in one thread, tied to the booking it belongs to.",
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
}

export function HeroTypedHeadline({
  appName,
  accentInk,
  onDark,
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

  return (
    <div className="max-w-xl">
      {/* Hidden from assistive tech — a screen reader following the string
          letter by letter reads as noise. The list below carries every feature
          in one piece. */}
      {/* The reservation lives on this wrapper, and the headline is pinned to
          its *bottom*. Reserving three lines on the text itself left a
          one-line headline sitting at the top of a tall box with the sub-line
          stranded 150px underneath, visibly detached from the sentence it
          belongs to. Growing upward instead keeps the two together and puts the
          slack above, between the logo and the headline, where the block is
          already centred and nobody reads it as a gap. */}
      <div
        className={`flex min-h-[3.3em] items-end text-5xl xl:text-6xl ${
          onDark ? "text-white" : "text-slate-900"
        }`}
      >
        <p
          aria-hidden="true"
          className="font-extrabold leading-[1.1] tracking-tight"
        >
          {/* Adjacent on purpose. A newline between two of these would be a
              whitespace text node inside the sentence, adding a space that is
              not in the copy and moving where the line wraps. */}
          {beforeShown}
          <span style={{ color: accentInk }}>{keyShown}</span>
          {afterShown}
          {!reduceMotion && (
            <span
              className="ml-1 inline-block h-[0.8em] w-[4px] translate-y-[0.06em] animate-pulse rounded-full align-middle"
              style={{ backgroundColor: accentInk, opacity: 0.8 }}
            />
          )}
        </p>
      </div>

      <p
        aria-hidden="true"
        className={`mt-5 min-h-[4.5em] max-w-lg text-lg leading-relaxed transition-opacity duration-500 ${
          subVisible ? "opacity-100" : "opacity-0"
        } ${onDark ? "text-white/75" : "text-slate-900/65"}`}
      >
        {feature.sub}
      </p>

      <span className="sr-only">
        {appName} —{" "}
        {FEATURES.map((f) => `${headlineOf(f)} ${f.sub}`).join(" ")}
      </span>
    </div>
  );
}

export default HeroTypedHeadline;
