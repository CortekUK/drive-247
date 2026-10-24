'use client';

/**
 * Northwind booking site v2 — "How renting works", the home page's walkthrough.
 *
 * One screen, playing on its own: the steps open one after another, every
 * `STEP_MS`, and loop. The open step grows into a card with everything about
 * it — what you do, two specifics, and what to have ready (a licence, a card
 * in your name) — while the others fold to a number and a title, so the whole
 * path is always in view. The picture beside it shows the open step; under
 * it, the path line's bar for the open step fills while it is shown, and when
 * it ends (`animationend`) the next step opens.
 *
 * It plays only while the section is on screen, and stops while the pointer
 * or keyboard focus is in it, so anyone reading is never cut off. Under the
 * picture, one line shows the whole path: five online steps, a gap, then the
 * one in person. Reduced motion: no bar, no auto-play — steps open on click.
 *
 * Every row keeps a fixed height and the open card a fixed minimum, so the
 * list never changes height as it plays; the new content fades and rises in
 * (V2_PLAN §12, transform and opacity only, never a height animation).
 *
 * "Start booking" goes where booking starts on this page: up to the hero's
 * search, with its calendar open (`StartBookingButton`).
 */

import { useEffect, useRef, useState } from 'react';
import { Check, CreditCard, IdCard } from 'lucide-react-nw';

import { cn } from '@nw/lib/utils';
import {
  StepDatesArt,
  StepExtrasArt,
  StepKeysArt,
  StepLicenceArt,
  StepPaySignArt,
  StepPickArt,
} from '@nw/site-v2/illustrations/home-scenes';
import { SITE_WIDE } from '@nw/site-v2/kit';
import { StartBookingButton } from '@nw/site-v2/sections/start-booking';

/** How long each step stays open before the next one opens. */
const STEP_MS = 2000;

type Step = {
  title: string;
  body: string;
  /** Two specifics, shown when the step is open. */
  details: [string, string];
  /** What to have ready, when the step needs something from you. */
  need?: { icon: typeof IdCard; text: string };
  Art: React.ComponentType<{ className?: string }>;
};

const STEPS: Step[] = [
  {
    title: 'Choose your dates and place',
    body: "Tell us when you need the car and where you'd like to collect it.",
    details: ['Any day from today', 'Bring it back somewhere else if that suits you'],
    Art: StepDatesArt,
  },
  {
    title: 'Pick your car',
    body: 'Every car shows its real total for your dates, so you can compare them fairly.',
    details: ['Narrow it down by type, like SUV or Economy', 'Mileage included is on every car'],
    Art: StepPickArt,
  },
  {
    title: 'Confirm your details',
    body: 'Add your driving licence. We check it before you arrive, not at the counter.',
    details: ['Done online, before you arrive', 'The name must match the card you pay with'],
    need: { icon: IdCard, text: 'Your driving licence' },
    Art: StepLicenceArt,
  },
  {
    title: 'Add any extras',
    body: 'Cover or anything else you need is added to your total before you pay.',
    details: ['Everything here is optional', 'Your total updates as you add things'],
    Art: StepExtrasArt,
  },
  {
    title: 'Pay and sign',
    body: 'Pay by card and sign your rental agreement on your phone.',
    details: ['Sign with your finger, on screen', 'Your copy stays in your account'],
    need: { icon: CreditCard, text: 'A card in your name' },
    Art: StepPaySignArt,
  },
  {
    title: 'Collect your keys',
    body: 'Come to the place you chose at the time you chose. Your car is clean and waiting.',
    details: ['Bring the licence and card you booked with', 'Message us from your account if plans change'],
    Art: StepKeysArt,
  },
];

const ONLINE_STEPS = STEPS.length - 1;

const stepLabel = (index: number) => (index === ONLINE_STEPS ? 'Then' : `Step ${index + 1} of ${ONLINE_STEPS}`);

export function HomeSteps() {
  const sectionRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  /** Bumped on every pick, so the bar restarts even on the same step. */
  const [run, setRun] = useState(0);
  const [inView, setInView] = useState(false);
  const [holding, setHolding] = useState(false); // pointer or keyboard focus inside
  const current = STEPS[active];
  const playing = inView && !holding;

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), { threshold: 0.5 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pick = (index: number) => {
    setActive(index);
    setRun((n) => n + 1);
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby="how-title"
      className={cn(
        SITE_WIDE,
        'flex flex-col justify-center pt-12 md:pt-28 lg:min-h-[calc(100svh-68px)] lg:py-10',
      )}
    >
      <div data-reveal className="flex items-end justify-between gap-5">
        <div className="min-w-0">
          <h2
            id="how-title"
            className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.045em] text-pv-fg sm:text-[42px] lg:text-[48px]"
          >
            How renting works
          </h2>
          <p className="mt-2 text-[15px] text-pv-muted-fg md:text-[16px]">Five steps online, then you collect your keys.</p>
        </div>
        <StartBookingButton className="max-sm:hidden">Start booking</StartBookingButton>
      </div>

      <div
        data-reveal
        style={{ '--d': '120ms' } as React.CSSProperties}
        className="mt-6 grid gap-4 lg:mt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12"
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHolding(true)}
        onPointerLeave={() => setHolding(false)}
        onFocus={(e) => e.target.matches(':focus-visible') && setHolding(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHolding(false);
        }}
      >
        {/* The open step's picture beside the list, with the path line under it. Below lg
            the picture sits in the open card and only the path line shows here, above the list. */}
        <figure
          id="how-picture"
          aria-live={playing ? 'off' : 'polite'}
          className="flex flex-col overflow-hidden rounded-2xl border border-pv-border bg-pv-card lg:order-2 lg:rounded-3xl"
        >
          <div className="hidden flex-1 items-center justify-center bg-pv-tint/60 px-10 lg:flex">
            <div key={active} className="pv2-enter w-full">
              <current.Art className="max-w-[440px]" />
            </div>
          </div>
          <figcaption className="flex flex-col items-center gap-2 px-4 py-3 text-center lg:gap-2.5 lg:border-t lg:border-pv-border lg:px-6 lg:py-4">
            {/* The path in one line: five online steps, a gap, then the one in person. */}
            <span className="flex items-center gap-1.5" aria-hidden>
              {STEPS.map((step, index) => (
                <span
                  key={step.title}
                  className={cn(
                    'relative h-1.5 w-8 overflow-hidden rounded-full bg-pv-border sm:w-10',
                    index === ONLINE_STEPS && 'ml-3 w-11 sm:ml-4 sm:w-14',
                  )}
                >
                  {index === active ? (
                    // The open step's time: when this fills, the next step opens.
                    <span
                      key={run}
                      data-paused={!playing}
                      style={{ '--step-ms': `${STEP_MS}ms` } as React.CSSProperties}
                      className="nw-step-timer absolute inset-0 rounded-full bg-pv-primary"
                      onAnimationEnd={() => pick((active + 1) % STEPS.length)}
                    />
                  ) : (
                    <span
                      className={cn(
                        'absolute inset-0 origin-left rounded-full bg-pv-primary transition-transform duration-200 ease-out motion-reduce:transition-none',
                        index < active ? 'scale-x-100' : 'scale-x-0',
                      )}
                    />
                  )}
                </span>
              ))}
            </span>
            <span className="text-[12.5px] text-pv-muted-fg sm:text-[13.5px]">
              {active === ONLINE_STEPS ? (
                <>
                  <span className="font-semibold text-pv-fg">Last step</span> · in person, where you collect the car
                </>
              ) : (
                <>
                  <span className="font-semibold text-pv-fg">
                    Step {active + 1} of {ONLINE_STEPS}
                  </span>{' '}
                  · done online, from your phone or computer
                </>
              )}
            </span>
          </figcaption>
        </figure>

        <ol className="lg:order-1">
          {STEPS.map((step, index) => {
            const isActive = index === active;
            const isDone = index < active;
            const last = index === STEPS.length - 1;
            return (
              <li key={step.title} className="relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 sm:gap-x-4">
                {/* The rail: filled up to the open step. */}
                {!last ? (
                  <span aria-hidden className="absolute bottom-0 left-[19px] top-1 w-0.5 bg-pv-border">
                    <span
                      className={cn(
                        'absolute inset-0 origin-top bg-pv-primary transition-transform duration-200 ease-out motion-reduce:transition-none',
                        isDone ? 'scale-y-100' : 'scale-y-0',
                      )}
                    />
                  </span>
                ) : null}

                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 mt-1 grid size-10 place-items-center rounded-full border-2 text-[14px] font-bold tabular-nums transition-colors duration-200 motion-reduce:transition-none',
                    isActive
                      ? 'border-pv-primary bg-pv-primary text-pv-primary-fg ring-4 ring-pv-primary/15'
                      : isDone
                        ? 'border-pv-primary bg-pv-card text-pv-primary'
                        : 'border-pv-border bg-pv-card text-pv-muted-fg',
                  )}
                >
                  {isDone ? <Check className="size-4" strokeWidth={3} /> : last ? <KeyGlyph /> : index + 1}
                </span>

                <div className={cn('min-w-0', !last && 'pb-1.5')}>
                  <button
                    type="button"
                    onClick={() => pick(index)}
                    aria-current={isActive ? 'step' : undefined}
                    aria-expanded={isActive}
                    aria-controls="how-picture"
                    className={cn(
                      'relative block w-full overflow-hidden text-left transition-colors duration-200 motion-reduce:transition-none',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30',
                      isActive
                        ? 'min-h-[372px] rounded-2xl sm:min-h-[402px] lg:min-h-[236px] border border-pv-border bg-pv-card px-5 pb-5 pt-4'
                        : 'flex h-11 items-center rounded-xl px-3 hover:bg-pv-row-hover',
                    )}
                  >
                    {isActive ? (
                      <span key={run} className="pv2-enter block">
                        <span className="-mx-2 -mt-1 mb-3 flex h-[112px] items-center justify-center rounded-xl bg-pv-tint/60 px-6 sm:h-[180px] lg:hidden">
                          <step.Art className="max-w-[210px] sm:max-w-[280px]" />
                        </span>
                        <span className="block text-[12px] font-semibold text-pv-primary">{stepLabel(index)}</span>
                        <span className="mt-0.5 block text-[20px] font-extrabold leading-tight tracking-[-0.025em] text-pv-fg md:text-[22px]">
                          {step.title}
                        </span>
                        <span className="mt-1.5 block text-[14px] leading-relaxed text-pv-muted-fg">{step.body}</span>
                        <span className="mt-3 flex flex-col gap-1.5">
                          {step.details.map((detail) => (
                            <span key={detail} className="flex items-start gap-2 text-[13.5px] font-medium text-pv-fg">
                              <Check aria-hidden className="mt-[3px] size-3.5 shrink-0 text-pv-primary" strokeWidth={3} />
                              {detail}
                            </span>
                          ))}
                        </span>
                        {step.need ? (
                          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-pv-tint px-2.5 py-1 text-[12.5px] font-semibold text-pv-fg">
                            <step.need.icon aria-hidden className="size-3.5 text-pv-primary" strokeWidth={2} />
                            You&apos;ll need: {step.need.text}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'block truncate text-[15px] font-semibold',
                          isDone ? 'text-pv-fg' : 'text-pv-muted-fg',
                        )}
                      >
                        {step.title}
                      </span>
                    )}

                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** A key, for the last stop on the rail: the rental ends in your hand, not on a number. */
function KeyGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="15" r="4.5" />
      <path d="M11.2 11.8 L20 3 M16.5 6.5 L19 9 M14.5 8.5 L16.5 10.5" />
    </svg>
  );
}
