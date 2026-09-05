'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Compass, LayoutDashboard, Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { useFirstRentalTour } from '@/hooks/use-first-rental-tour';
import { routePathname, type ResolvedStep, type TourSide, type TourStep } from '@/lib/first-rental-tour';

/**
 * The first-rental walkthrough — eleven steps across six pages, canary only.
 *
 * WHY THIS IS HAND-BUILT AND NOT A LIBRARY.
 * -----------------------------------------
 * The obvious candidate (Onborda) hard-depends on `framer-motion`, while this
 * app is on the renamed `motion` package. Adding it would put two copies of the
 * same animation runtime in the bundle to draw a card. What a tour library
 * actually gives you is anchoring, a step machine, and a portal — and Radix's
 * primitives plus `createPortal` already cover the last two. The step machine
 * (routing, waiting, skipping, pausing, resuming) lives in
 * `hooks/use-first-rental-tour.ts`; the rules it enforces live in
 * `lib/first-rental-tour.ts` where they can be unit-tested. This file only
 * draws what the hook says is on screen:
 *
 *   showing   →  the spotlight + card (or a centred card for Welcome / Done)
 *   transit / navigating / waiting  →  a small "Heading to Vehicles…" pill
 *   prompt    →  the Resume / Start over / Dismiss card on the dashboard
 *
 * WHY IT DOES NOT TRAP THE OPERATOR.
 * ----------------------------------
 * The dimming layer is `pointer-events-none` and only the card takes clicks. So
 * this is a coach mark, not a modal: nothing on the page stops working while it
 * is up, the operator can ignore it entirely, and clicking the very thing being
 * pointed at either advances the tour (a look-at-this step) or steps the tour
 * aside (a do-this step that opens a dialog). Every card carries a visible
 * Skip, Back and Next; Esc skips, → advances, ← goes back.
 *
 * THEME. It renders through a portal onto `<body>`, which is where `.v2-theme`
 * lives, so `bg-card`, `rounded-3xl`, `ring-foreground/5` and the rest resolve
 * to the v2 ramp exactly as they do inside the app. Outside the canary the hook
 * never leaves `idle`, so none of this mounts.
 */
export function FirstRentalTour({ suppressed = false }: { suppressed?: boolean }) {
  const tour = useFirstRentalTour(suppressed);
  const [mounted, setMounted] = useState(false);

  // Portals need a document. Next renders this on the server first.
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;

  if (tour.phase === 'prompt') {
    return createPortal(
      <ResumePrompt
        onResume={tour.resume}
        onStartOver={tour.startOver}
        onDismiss={tour.dismissPrompt}
      />,
      document.body,
    );
  }

  if (tour.phase === 'transit' || tour.phase === 'navigating' || tour.phase === 'waiting') {
    return createPortal(
      <TransitPill label={tour.steps[tour.index]?.label} onSkip={tour.end} />,
      document.body,
    );
  }

  if (tour.phase === 'showing' && tour.current) {
    return createPortal(
      <TourLayer
        resolved={tour.current}
        steps={tour.steps}
        index={tour.index}
        detail={tour.detail}
        onNext={tour.next}
        onBack={tour.back}
        onEnd={tour.end}
        onFinishToDashboard={tour.finishToDashboard}
        onAnchorLost={tour.anchorLost}
        onPause={tour.pause}
      />,
      document.body,
    );
  }

  return null;
}

// ── The card + spotlight ───────────────────────────────────────────────────

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 352;
const CENTERED_WIDTH = 408;
const GAP = 16;
const PAD = 8;

type Placement = Exclude<TourSide, 'center'>;

/** Preference order for placing the card, starting with the step's own. */
function placementsFor(preferred: TourSide): Placement[] {
  switch (preferred) {
    case 'right':
      return ['right', 'left', 'bottom', 'top'];
    case 'left':
      return ['left', 'right', 'bottom', 'top'];
    case 'top':
      return ['top', 'bottom', 'right', 'left'];
    default:
      return ['bottom', 'top', 'right', 'left'];
  }
}

function positionFor(
  placement: Placement,
  anchor: Rect,
  cardW: number,
  cardH: number,
): { left: number; top: number } {
  switch (placement) {
    case 'right':
      return { left: anchor.left + anchor.width + GAP, top: anchor.top - PAD };
    case 'left':
      return { left: anchor.left - GAP - cardW, top: anchor.top - PAD };
    case 'top':
      return { left: anchor.left + anchor.width / 2 - cardW / 2, top: anchor.top - GAP - cardH };
    default:
      return { left: anchor.left + anchor.width / 2 - cardW / 2, top: anchor.top + anchor.height + GAP };
  }
}

function TourLayer({
  resolved,
  steps,
  index,
  detail,
  onNext,
  onBack,
  onEnd,
  onFinishToDashboard,
  onAnchorLost,
  onPause,
}: {
  resolved: ResolvedStep;
  steps: readonly TourStep[];
  index: number;
  detail: string | null;
  onNext: () => void;
  onBack: () => void;
  onEnd: () => void;
  onFinishToDashboard: () => void;
  onAnchorLost: () => void;
  onPause: () => void;
}) {
  const { step, element, notes } = resolved;
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(280);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const measure = useCallback(() => {
    if (!element) return;
    // The element can be removed while the tour is up — a route change that
    // rebuilds the rail, a permissions refetch, a tab switch. Handing it back
    // to the hook (which re-resolves, then skips) is the only honest response;
    // pointing at a detached node is the exact stall this tour is built to
    // avoid.
    if (!document.contains(element)) {
      onAnchorLost();
      return;
    }
    const r = element.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      onAnchorLost();
      return;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [element, onAnchorLost]);

  // Measure before paint so the spotlight never renders at the wrong place for
  // a frame, then keep it honest through scroll, resize and layout shifts.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (!element) return;
    // `true` — capture phase, so scrolling INSIDE the sidebar (which does not
    // bubble a scroll event to window) still re-measures.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [element, measure]);

  // The card's real height, so placement and clamping use the truth rather
  // than a guess — the finale is taller than a one-liner. No deps: the card
  // only exists once the anchor has been measured, so this has to look again
  // after every render; the equality guard keeps it from looping.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const h = card.offsetHeight || 280;
    if (h !== cardH) setCardH(h);
  });

  // Bring the anchor into view if it is off screen (a long sidebar, a small
  // laptop). Only on the step change, never on every measure.
  useEffect(() => {
    element?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [element, reduceMotion]);

  // Clicking the thing being pointed at. On a look-at-this step whose next
  // step is on the same page, that counts as "understood" and moves on. On a
  // do-this step (Add Vehicle opens a dialog) the tour steps aside instead —
  // a coach mark floating over the dialog they just opened is in the way.
  // When the next step is on another page, a click is left alone: the click
  // itself may be a navigation, and the hook will notice the route change.
  const nextStep = steps[index + 1];
  const nextIsSamePage =
    !!nextStep &&
    (nextStep.route === null ||
      (step.route !== null && routePathname(nextStep.route) === routePathname(step.route)));
  useEffect(() => {
    if (!element) return;
    const onClick = () => {
      if (step.pauseOnAnchorClick) onPause();
      else if (nextIsSamePage) onNext();
    };
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, [element, step.pauseOnAnchorClick, nextIsSamePage, onNext, onPause]);

  // Keyboard. Escape always ends it — a tour you cannot dismiss with Escape is
  // a tour people resent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEnd();
      } else if (e.key === 'ArrowRight') {
        onNext();
      } else if (e.key === 'ArrowLeft') {
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEnd, onNext, onBack]);

  // Move focus to the card so the buttons are immediately reachable, and put it
  // back where it was when the layer goes away.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [step.id]);

  const centered = element === null;
  if (!centered && !rect) return null;

  const isLast = index === steps.length - 1;
  const isFirst = index === 0;
  const onDashboard = typeof window !== 'undefined' && window.location.pathname === '/';
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight;
  const cardW = centered ? Math.min(CENTERED_WIDTH, viewportW - GAP * 2) : Math.min(CARD_WIDTH, viewportW - GAP * 2);

  // Place to the preferred side, falling through the alternatives until one
  // fits, then clamp into the viewport whatever happens. Narrow screens end up
  // under the anchor rather than hanging off the edge.
  let left: number;
  let top: number;
  if (centered || !rect) {
    left = (viewportW - cardW) / 2;
    top = Math.max(GAP, viewportH * 0.4 - cardH / 2);
  } else {
    const fits = (p: { left: number; top: number }) =>
      p.left >= GAP &&
      p.left + cardW <= viewportW - GAP &&
      p.top >= GAP &&
      p.top + cardH <= viewportH - GAP;
    const candidates = placementsFor(step.side).map((p) => positionFor(p, rect, cardW, cardH));
    const chosen = candidates.find(fits) ?? candidates[0];
    left = Math.min(Math.max(GAP, chosen.left), Math.max(GAP, viewportW - cardW - GAP));
    top = Math.min(Math.max(GAP, chosen.top), Math.max(GAP, viewportH - cardH - GAP));
  }

  const progress = Math.round(((index + 1) / steps.length) * 100);
  const outline = step.showOutline
    ? steps.filter((s) => s.anchors.length > 0).map((s) => s.label)
    : [];

  return (
    <div
      className="fixed inset-0 z-[65]"
      // The layer itself takes NO clicks. Only the card below opts back in, so
      // the whole app keeps working underneath and nobody is ever trapped.
      style={{ pointerEvents: 'none' }}
      aria-live="polite"
    >
      {centered ? (
        // No anchor: a plain wash, so the card reads as the one thing on screen.
        <motion.div
          aria-hidden
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
          className="absolute inset-0"
          style={{ background: 'hsl(0 0% 4% / 0.45)', pointerEvents: 'none' }}
        />
      ) : (
        // Spotlight. One box-shadow does the dimming — a 9999px spread from the
        // hole outward — which is far cheaper than four positioned panels and
        // keeps the cut-out perfectly aligned with the ring around it.
        <motion.div
          aria-hidden
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{
            opacity: 1,
            top: rect!.top - PAD,
            left: rect!.left - PAD,
            width: rect!.width + PAD * 2,
            height: rect!.height + PAD * 2,
          }}
          transition={
            reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }
          }
          className="absolute rounded-2xl ring-2 ring-primary/60"
          style={{
            boxShadow: '0 0 0 9999px hsl(0 0% 4% / 0.45)',
            pointerEvents: 'none',
          }}
        />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={cardRef}
          role="dialog"
          aria-modal="false"
          aria-label={`${step.title} — step ${index + 1} of ${steps.length}`}
          tabIndex={-1}
          data-first-rental-tour=""
          data-tour-step={step.id}
          initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
          className="absolute flex flex-col gap-4 rounded-3xl bg-card p-5 text-card-foreground shadow-md outline-none ring-1 ring-foreground/10 dark:ring-foreground/15"
          style={{ top, left, width: cardW, pointerEvents: 'auto' }}
        >
          {/* Header — mark, step counter */}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                <Sparkles className="size-4" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">Walkthrough</span>
            </span>
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {index + 1} of {steps.length}
            </span>
          </div>

          {/* Progress. Thin, quiet, and always moving forward. */}
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-foreground/[0.07]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={false}
              animate={{ width: `${progress}%` }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-lg font-medium leading-snug text-foreground">
              {step.title}
            </h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{step.body}</p>
            {detail && (
              <p className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/[0.07] px-2.5 py-1 text-[12px] font-medium text-primary ring-1 ring-primary/10">
                <Compass className="size-3" />
                {detail}
              </p>
            )}
          </div>

          {/* What we'll cover — the Welcome card only. Built from THIS user's
              steps, so it never promises a page they cannot reach. */}
          {outline.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {outline.map((label) => (
                <li
                  key={label}
                  className="rounded-full bg-foreground/[0.05] px-2.5 py-1 text-[11px] font-medium text-foreground/70"
                >
                  {label}
                </li>
              ))}
            </ul>
          )}

          {/* The quiet lines. One each, no depth. Notes whose anchor was absent
              were already dropped when the step resolved, so nothing here
              points at a screen this operator cannot see. */}
          {notes.length > 0 && (
            <ul className="flex flex-col gap-1.5 border-t border-foreground/[0.07] pt-3">
              {notes.map((note) => (
                <li
                  key={note}
                  className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground"
                >
                  <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Actions. Skip is present on EVERY step but the last (where
              finishing IS skipping) — it is the left-hand item so it never
              moves as the step counter changes. */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            {isLast ? (
              <span />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={onEnd}
              >
                Skip tour
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              {!isFirst && (
                <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                  Back
                </Button>
              )}
              {isLast ? (
                onDashboard ? (
                  <Button type="button" size="sm" onClick={onEnd}>
                    Done
                    <Check className="size-3.5" />
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={onEnd}>
                      Done
                    </Button>
                    <Button type="button" size="sm" onClick={onFinishToDashboard}>
                      Go to dashboard
                      <LayoutDashboard className="size-3.5" />
                    </Button>
                  </>
                )
              ) : (
                <Button type="button" size="sm" onClick={onNext}>
                  {isFirst ? "Let's go" : 'Next'}
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Between pages ──────────────────────────────────────────────────────────

/**
 * Shown while the hook is routing to a step or waiting for its anchor. Held
 * back for a beat so an anchor that is already on screen never flashes it.
 * Carries a way out: a pill with no exit is a stall with a spinner on it.
 */
function TransitPill({ label, onSkip }: { label?: string; onSkip: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 350);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[65] flex justify-center">
      <div
        data-tour-transit=""
        role="status"
        className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-card py-1.5 pl-3.5 pr-1.5 text-[13px] text-foreground shadow-md ring-1 ring-foreground/10 dark:ring-foreground/15"
      >
        <Loader2 className="size-3.5 animate-spin text-primary" />
        <span>{label ? `Heading to ${label}…` : 'One moment…'}</span>
        <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={onSkip}>
          Skip tour
        </Button>
      </div>
    </div>
  );
}

// ── Picking up where they left off ─────────────────────────────────────────

function ResumePrompt({
  onResume,
  onStartOver,
  onDismiss,
}: {
  onResume: () => void;
  onStartOver: () => void;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[65] flex justify-center px-4">
      <motion.div
        data-tour-prompt=""
        role="dialog"
        aria-modal="false"
        aria-label="Pick up the walkthrough where you left off?"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-3xl bg-card p-4 text-card-foreground shadow-md ring-1 ring-foreground/10 dark:ring-foreground/15 sm:flex-row sm:items-center"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Sparkles className="size-4" />
        </span>
        <p className="flex-1 text-[13px] leading-snug text-foreground">
          Pick up the walkthrough where you left off?
        </p>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onDismiss}>
            Dismiss
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onStartOver}>
            Start over
          </Button>
          <Button type="button" size="sm" onClick={onResume}>
            Resume
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
