'use client';

/**
 * Template 2 ("Glass") — "How renting works", after the cars.
 *
 *   the track   the six steps on one glass rail: five on your phone, then a
 *               gap, then the one at pick-up. A bead of glass sits on the
 *               chosen step and slides to the next; the rail fills up to it,
 *               so where you are in the trip is always in view
 *   the step    the chosen step, its number set huge behind it (as the hero
 *               sets a car's name), with what happens and two specifics
 *   numbers     beside it, the operator's numbers (`loadSiteNumbers`, the
 *               same as site-v2's): cars to choose from and the lowest price
 *               a day, read from the fleet, and the rating and years on the
 *               road from their About stats. Each counts up as it comes into
 *               view; one without data is left out
 *
 * Nothing plays on its own: a step opens on a click or tap, the arrows, or
 * ← / → on the track (a tablist). The words are site-v2's (home-steps.tsx),
 * which describe the booking flow both designs share.
 *
 * On a desktop the section fills the screen, like the cars above it; on a
 * short screen it grows rather than cut anything off (there is no photo here
 * to shrink).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, ChevronRight, KeyRound } from 'lucide-react-nw';

import { cn } from '@nw/lib/utils';
import { CountUp } from '@nw/site-v2/sections/count-up';
import type { SiteNumber } from '@nw/site-v2/sections/site-numbers';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';

type Step = {
  /** On the track, where room is short. */
  short: string;
  title: string;
  body: string;
  details: [string, string];
};

const STEPS: Step[] = [
  {
    short: 'Dates',
    title: 'Choose your dates and place',
    body: "Tell us when you need the car and where you'd like to collect it.",
    details: ['Any day from today', 'Bring it back somewhere else if that suits you'],
  },
  {
    short: 'Car',
    title: 'Pick your car',
    body: 'Every car shows its real total for your dates, so you can compare them fairly.',
    details: ['Narrow it down by type, like SUV or Economy', 'Mileage included is on every car'],
  },
  {
    short: 'Licence',
    title: 'Confirm your details',
    body: 'Add your driving licence. We check it before you arrive, not at the counter.',
    details: ['Done online, before you arrive', 'The name must match the card you pay with'],
  },
  {
    short: 'Extras',
    title: 'Add any extras',
    body: 'Cover or anything else you need is added to your total before you pay.',
    details: ['Everything here is optional', 'Your total updates as you add things'],
  },
  {
    short: 'Pay and sign',
    title: 'Pay and sign',
    body: 'Pay by card and sign your rental agreement on your phone.',
    details: ['Sign with your finger, on screen', 'Your copy stays in your account'],
  },
  {
    short: 'Keys',
    title: 'Collect your keys',
    body: 'Come to the place you chose at the time you chose. Your car is clean and waiting.',
    details: ['Bring the licence and card you booked with', 'Message us from your account if plans change'],
  },
];

/** Steps 1–5 are online; the last is in person. */
const ONLINE = STEPS.length - 1;

type Direction = 'next' | 'prev';

/** Up to the hero's search, with the address field ready to type in. */
function startBooking() {
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  window.setTimeout(() => document.getElementById('g2-pickup')?.focus({ preventScroll: true }), smooth ? 500 : 0);
}

export function Template2HowItWorks({ numbers }: { numbers: SiteNumber[] }) {
  const [active, setActive] = useState(0);
  const [direction, setDirection] = useState<Direction | null>(null);
  const step = STEPS[active];

  const open = (index: number) => {
    const to = (index + STEPS.length) % STEPS.length;
    if (to === active) return;
    setDirection(to > active ? 'next' : 'prev');
    setActive(to);
  };

  return (
    <section aria-labelledby="g2-how-title" className="relative lg:flex lg:min-h-svh lg:flex-col">
      <div className="mx-auto w-full max-w-[1320px] px-3 pb-10 pt-4 sm:px-5 sm:pb-16 lg:flex lg:flex-1 lg:flex-col lg:pb-5 lg:pt-[92px]">
        <div className="g2-glass flex flex-col rounded-[32px] p-3 sm:rounded-[44px] sm:p-5 lg:flex-1 lg:rounded-[40px] lg:p-5">
          <header className="flex flex-col items-center gap-4 lg:gap-3 px-2 pb-5 pt-4 text-center sm:px-3 sm:pt-5 lg:pb-4 lg:pt-2">
            <div>
              <h2 id="g2-how-title" className="text-[30px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--g2-ink)] sm:text-[40px] lg:text-[36px]">
                How renting works.
              </h2>
              <p className="mx-auto mt-2.5 max-w-[34rem] text-[15px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[17px] lg:mt-1.5 lg:text-[16px]">
                Five steps on your phone, then you collect the keys.
              </p>
            </div>
            <button
              type="button"
              onClick={startBooking}
              className={cn('g2-cta inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold', FOCUS)}
            >
              Start booking
              <ArrowRight aria-hidden className="size-4" strokeWidth={2.25} />
            </button>
          </header>

          <Track active={active} onOpen={open} />

          <div className={cn('mt-3 grid gap-3 lg:mt-4 lg:flex-1 lg:gap-4', numbers.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
            {/* The chosen step. */}
            <div
              role="tabpanel"
              id="g2-step-panel"
              aria-labelledby={`g2-step-tab-${active}`}
              className="g2-well g2-tray relative flex min-h-[340px] flex-col overflow-hidden rounded-[30px] p-5 sm:p-8 lg:p-10 lg:[@media(max-height:820px)]:p-8"
            >
              <span
                key={`n${active}`}
                aria-hidden
                data-dir={direction ?? undefined}
                className={cn(
                  'g2-step-num pointer-events-none absolute -bottom-[0.18em] right-[0.1em] select-none font-extrabold leading-none max-sm:hidden',
                  direction && 'g2-swap',
                )}
              >
                {active + 1}
              </span>

              <div key={`s${active}`} className="g2-swap-fade relative max-w-[30rem]">
                <p className="text-[13.5px] font-semibold text-[var(--g2-accent-ink)]">
                  {active < ONLINE ? `Step ${active + 1} of ${ONLINE}, on your phone` : 'Then, in person'}
                </p>
                <h3 className="mt-2 text-[28px] font-semibold leading-[1.08] tracking-[-0.035em] text-[var(--g2-ink)] [text-wrap:balance] sm:text-[38px]">
                  {step.title}
                </h3>
                <p className="mt-3 text-[16px] leading-relaxed text-[var(--g2-ink-soft)] sm:text-[17px]">{step.body}</p>
                <ul className="mt-5 flex flex-col gap-2.5">
                  {step.details.map((detail) => (
                    <li key={detail} className="flex items-start gap-3 text-[15px] font-medium text-[var(--g2-ink)]">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--g2-accent)]/14 text-[var(--g2-accent-ink)]">
                        <Check aria-hidden className="size-3" strokeWidth={3} />
                      </span>
                      {detail}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative mt-auto flex items-center gap-2 pt-8">
                <StepButton side="prev" disabled={active === 0} onClick={() => open(active - 1)} />
                <StepButton side="next" disabled={active === STEPS.length - 1} onClick={() => open(active + 1)} />
              </div>
            </div>

            <Numbers numbers={numbers} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────── track ─────────────────────────────── */

/**
 * The rail: a tablist of the six steps, the bead on the chosen one. The bead
 * and the fill are placed by measuring the stops, so the gap before the last
 * step can be any width.
 */
function Track({ active, onOpen }: { active: number; onOpen: (index: number) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const stops = useRef<Array<HTMLButtonElement | null>>([]);
  const [place, setPlace] = useState<{ x: number; start: number; end: number } | null>(null);

  const measure = () => {
    const box = rail.current?.getBoundingClientRect();
    const dot = stops.current[active]?.querySelector('[data-dot]')?.getBoundingClientRect();
    const first = stops.current[0]?.querySelector('[data-dot]')?.getBoundingClientRect();
    const last = stops.current[STEPS.length - 1]?.querySelector('[data-dot]')?.getBoundingClientRect();
    if (!box || !dot || !first || !last) return;
    const centre = (rect: DOMRect) => rect.left + rect.width / 2 - box.left;
    const next = { x: centre(dot), start: centre(first), end: centre(last) };
    setPlace((now) => (now && now.x === next.x && now.start === next.start && now.end === next.end ? now : next));
  };
  useLayoutEffect(measure); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (rail.current) observer.observe(rail.current);
    return () => observer.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="g2-well g2-tray rounded-[30px] px-2 pb-3 pt-3 sm:px-4 sm:pb-4">
      {/* What each part of the trip is: the bracket over 1–5, the label over 6. */}
      <div aria-hidden className="flex gap-3 px-1 pb-2 text-[12px] font-semibold text-[var(--g2-ink-soft)] sm:gap-6 sm:text-[12.5px]">
        <span className="flex flex-[5] items-center gap-2">
          On your phone
          <span className="h-px flex-1 bg-[var(--g2-ink)]/12" />
        </span>
        <span className="flex-[1] whitespace-nowrap text-center">
          <span className="sm:hidden">Pick-up</span>
          <span className="max-sm:hidden">At pick-up</span>
        </span>
      </div>

      <div ref={rail} className="relative">
        {/* The line, and how much of it is behind you. */}
        <span aria-hidden className="absolute top-[22px] h-[3px] rounded-full bg-[var(--g2-ink)]/10 max-[359px]:top-[18.5px]" style={{ left: place?.start ?? 0, width: place ? place.end - place.start : 0 }} />
        <span
          aria-hidden
          className="g2-rail-fill absolute top-[22px] h-[3px] rounded-full max-[359px]:top-[18.5px]"
          style={{ left: place?.start ?? 0, width: place ? place.x - place.start : 0 }}
        />
        {/* The bead. */}
        <span
          aria-hidden
          className="g2-bead absolute top-0 z-10 grid size-12 -translate-x-1/2 max-[359px]:size-10 max-[359px]:text-[15px] place-items-center rounded-full text-[17px] font-bold tabular-nums"
          style={{ left: place?.x ?? 0, opacity: place ? 1 : 0 }}
        >
          {active + 1}
        </span>

        <div
          role="tablist"
          aria-label="Steps"
          className="relative flex gap-3 sm:gap-6"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            const to = Math.min(STEPS.length - 1, Math.max(0, active + (event.key === 'ArrowRight' ? 1 : -1)));
            onOpen(to);
            stops.current[to]?.focus();
          }}
        >
          <div className="flex flex-[5]">
            {STEPS.slice(0, ONLINE).map((step, index) => (
              <Stop key={step.short} step={step} index={index} active={active} onOpen={onOpen} stopRef={(node) => (stops.current[index] = node)} />
            ))}
          </div>
          <div className="flex flex-[1]">
            <Stop step={STEPS[ONLINE]} index={ONLINE} active={active} onOpen={onOpen} stopRef={(node) => (stops.current[ONLINE] = node)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Stop({
  step,
  index,
  active,
  onOpen,
  stopRef,
}: {
  step: Step;
  index: number;
  active: number;
  onOpen: (index: number) => void;
  stopRef: (node: HTMLButtonElement | null) => void;
}) {
  const chosen = index === active;
  const done = index < active;
  return (
    <button
      ref={stopRef}
      type="button"
      role="tab"
      id={`g2-step-tab-${index}`}
      aria-selected={chosen}
      aria-controls="g2-step-panel"
      tabIndex={chosen ? 0 : -1}
      onClick={() => onOpen(index)}
      className={cn('group flex min-w-0 flex-1 flex-col items-center gap-2 rounded-[18px] pb-1 pt-0', FOCUS)}
    >
      <span
        data-dot
        className={cn(
          // 40px on the narrowest phones, so six steps fit across 320px.
          'grid size-12 place-items-center rounded-full text-[15px] font-semibold tabular-nums transition-colors duration-300 max-[359px]:size-10',
          done
            ? 'text-[var(--g2-accent-ink)]'
            : 'text-[var(--g2-ink-soft)] group-hover:text-[var(--g2-ink)]',
        )}
      >
        <span
          className={cn(
            'grid size-8 place-items-center rounded-full transition-colors duration-300',
            done ? 'bg-[color-mix(in_oklab,var(--g2-accent)_16%,#fff)]' : 'bg-white/80 shadow-[inset_0_1px_0_#fff,0_2px_6px_-3px_rgb(13_12_29/0.3)]',
          )}
        >
          {index === ONLINE ? <KeyRound aria-hidden className="size-3.5" strokeWidth={2.25} /> : index + 1}
        </span>
      </span>
      <span
        className={cn(
          'max-w-full truncate px-1 text-[12.5px] font-medium transition-colors duration-200 max-sm:sr-only sm:text-[13.5px]',
          chosen ? 'text-[var(--g2-ink)]' : 'text-[var(--g2-ink-soft)]',
        )}
      >
        {step.short}
      </span>
    </button>
  );
}

/* ──────────────────────────────── have ready ───────────────────────────── */

/** The operator's numbers, one under another, filling the pane's height. */
function Numbers({ numbers }: { numbers: SiteNumber[] }) {
  if (numbers.length === 0) return null;
  return (
    <dl className="g2-well g2-tray grid grid-cols-2 rounded-[30px] p-2 lg:flex lg:flex-col">
      {numbers.map((stat, index) => (
        <div
          key={stat.key}
          className={cn(
            'relative flex flex-col-reverse justify-center px-4 py-5 sm:px-6 lg:flex-1 lg:py-3',
            // Hairlines: between the columns and rows on a phone, between the rows on a desktop.
            index % 2 === 1 && 'max-lg:before:absolute max-lg:before:inset-y-5 max-lg:before:left-0 max-lg:before:w-px max-lg:before:bg-[var(--g2-ink)]/10',
            index >= 2 && 'max-lg:after:absolute max-lg:after:inset-x-4 max-lg:after:top-0 max-lg:after:h-px max-lg:after:bg-[var(--g2-ink)]/10',
            index > 0 && 'lg:after:absolute lg:after:inset-x-6 lg:after:top-0 lg:after:h-px lg:after:bg-[var(--g2-ink)]/10',
          )}
        >
          <dt className="mt-1.5 text-[13.5px] font-medium text-[var(--g2-ink-soft)]">{stat.label}</dt>
          <dd className="text-[38px] font-semibold leading-none tracking-[-0.045em] text-[var(--g2-ink)] tabular-nums sm:text-[46px] lg:text-[clamp(38px,5.4svh,54px)]">
            <CountUp to={stat.to} decimals={stat.decimals} prefix={stat.prefix} suffix={stat.suffix} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StepButton({ side, disabled, onClick }: { side: Direction; disabled: boolean; onClick: () => void }) {
  const Icon = side === 'next' ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'next' ? 'Next step' : 'Previous step'}
      className={cn(
        'grid size-11 place-items-center rounded-full bg-white text-[var(--g2-ink)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.45),inset_0_1px_0_#fff] transition-[transform,opacity] duration-200 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-35',
        FOCUS,
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={2.25} />
    </button>
  );
}
