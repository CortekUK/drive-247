'use client';

import { useEffect, useState } from 'react';

/**
 * The sign-in hero: what the customer portal lets a customer do, typed out one
 * line at a time with its keyword in the accent, a line of explanation under it.
 *
 * The operator portal v2's `hero-typed-headline.tsx`, with the customer's copy.
 * Every entry names a screen the customer portal actually has (bookings,
 * agreements, payments, verification, documents, messages, notifications), so
 * nothing here is a promise they will not find once they are inside.
 *
 * The caret blinks with a CSS keyframe (`pv2-caret` in styles/site.css) rather
 * than a motion library, which this site does not load.
 */

interface Feature {
  before: string;
  key: string;
  after: string;
  sub: string;
}

const FEATURES: Feature[] = [
  {
    before: 'Every ',
    key: 'booking',
    after: ', one place.',
    sub: "See what's coming up, what's on the road with you now, and every trip you've taken.",
  },
  {
    before: 'Sign your ',
    key: 'agreement',
    after: ' online.',
    sub: 'Read and e-sign your rental agreement from your phone. No paper, no wait at the desk.',
  },
  {
    before: '',
    key: 'Pay',
    after: ' in a couple of taps.',
    sub: "Settle what's due, follow your payment plan and download every invoice and receipt.",
  },
  {
    before: 'Get ',
    key: 'verified',
    after: ' before pickup.',
    sub: 'Upload your licence and ID ahead of time, so collecting the car takes minutes.',
  },
  {
    before: 'Your ',
    key: 'documents',
    after: ', always to hand.',
    sub: 'Licence, insurance and signed agreements kept together, ready whenever you need them.',
  },
  {
    before: '',
    key: 'Message',
    after: ' us directly.',
    sub: 'Ask about your booking and get the answer in one thread, tied to your rental.',
  },
  {
    before: 'Never miss an ',
    key: 'update',
    after: '.',
    sub: 'Pickup reminders, payment receipts and booking changes, the moment they happen.',
  },
  {
    before: '',
    key: 'Book',
    after: ' again in seconds.',
    sub: 'Your details are saved, so the next rental is a few clicks rather than a form.',
  },
];

const headlineOf = (f: Feature) => f.before + f.key + f.after;

const TYPE_MS = 40;
const ERASE_MS = 18;
/** Long enough to read the sub-line, which is the slower half of each card. */
const HOLD_MS = 3400;

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduce(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return reduce;
}

interface HeroTypedHeadlineProps {
  appName: string;
  /** The accent, already pushed to a lightness that reads on the panel (`brandInk`). */
  accentInk: string;
  /** Dark ground (a hero photograph): the non-keyword copy inverts. */
  onDark: boolean;
  /** Phone scale: 26px headline, 14px sub-line, centred. */
  compact?: boolean;
}

export function HeroTypedHeadline({ appName, accentInk, onDark, compact = false }: HeroTypedHeadlineProps) {
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

    setIndex((i) => (i + 1) % FEATURES.length);
    setErasing(false);
  }, [charCount, erasing, index, reduceMotion]);

  const feature = reduceMotion ? FEATURES[0] : FEATURES[index];
  const revealed = reduceMotion ? headlineOf(feature).length : charCount;

  // Clamped per segment so the accent turns on at the keyword's first character.
  const beforeShown = feature.before.slice(0, revealed);
  const keyShown = feature.key.slice(0, Math.max(0, revealed - feature.before.length));
  const afterShown = feature.after.slice(0, Math.max(0, revealed - feature.before.length - feature.key.length));

  // The sub-line fades in once its headline is complete and out before the erase.
  const subVisible = reduceMotion || (!erasing && revealed === headlineOf(feature).length);

  const headlineSize = compact ? 'text-[26px]' : 'text-5xl xl:text-6xl';
  const subSize = compact ? 'mt-2 text-sm' : 'mt-4 max-w-lg text-lg';
  const baseColor = onDark ? 'text-white' : 'text-slate-900';

  return (
    <div className={`grid ${compact ? 'text-center' : 'max-w-xl'}`}>
      {/* Every feature rendered invisibly in the same cell, so the cell is as
          tall as the tallest card and the form below never moves. */}
      {FEATURES.map((f, i) => (
        <div key={`measure-${i}`} aria-hidden="true" className="invisible col-start-1 row-start-1">
          <p className={`${headlineSize} font-extrabold leading-[1.1] tracking-tight`}>{headlineOf(f)}</p>
          <p className={`${subSize} leading-relaxed`}>{f.sub}</p>
        </div>
      ))}

      <div className="col-start-1 row-start-1">
        <p aria-hidden="true" className={`${headlineSize} ${baseColor} font-extrabold leading-[1.1] tracking-tight`}>
          {beforeShown}
          <span style={{ color: accentInk }}>{keyShown}</span>
          {afterShown}
          {!reduceMotion && (
            // Zero width, so the caret never changes where the line wraps.
            <span className="relative inline-block h-[0.8em] w-0 align-middle">
              <span className="pv2-caret absolute inset-y-0 left-[4px] w-[4px] rounded-full bg-current" />
            </span>
          )}
        </p>

        <p
          aria-hidden="true"
          className={`${subSize} leading-relaxed motion-reduce:transition-none ${
            subVisible
              ? 'translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out]'
              : 'translate-y-3 opacity-0 [transition:transform_200ms_ease-in,opacity_200ms_ease-in]'
          } ${onDark ? 'text-white/75' : 'text-slate-900/65'}`}
        >
          {feature.sub}
        </p>
      </div>

      <span className="sr-only">
        {appName} customer portal — {FEATURES.map((f) => `${headlineOf(f)} ${f.sub}`).join(' ')}
      </span>
    </div>
  );
}
