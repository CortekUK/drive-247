'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { useFirstRentalTour } from '@/hooks/use-first-rental-tour';

/**
 * The first-rental tour — three stops, about sixty seconds, canary only.
 *
 * WHY THIS IS HAND-BUILT AND NOT A LIBRARY.
 * -----------------------------------------
 * The obvious candidate (Onborda) hard-depends on `framer-motion`, while this
 * app is on the renamed `motion` package. Adding it would put two copies of the
 * same animation runtime in the bundle to draw three cards. What a tour library
 * actually gives you is anchoring, a step machine, and a portal — and Radix's
 * primitives plus `createPortal` already cover the last two. So the whole thing
 * is ~200 lines using what is installed, and the anchoring rule that matters
 * (drop stops whose target is missing) lives in `lib/first-rental-tour.ts`
 * where it can be unit-tested.
 *
 * WHY IT DOES NOT TRAP THE OPERATOR.
 * ----------------------------------
 * The dimming layer is `pointer-events-none` and only the card takes clicks. So
 * this is a coach mark, not a modal: nothing on the page stops working while it
 * is up, the operator can ignore it entirely, and clicking the very thing being
 * pointed at advances the tour rather than being swallowed by a scrim. Every
 * step also carries a visible Skip, which is a hard requirement — skipping ends
 * it for good and it never re-prompts.
 *
 * THEME. It renders through a portal onto `<body>`, which is where `.v2-theme`
 * lives, so `bg-card`, `rounded-3xl`, `ring-foreground/5` and the rest resolve
 * to the v2 ramp exactly as they do inside the app. Outside the canary this
 * component returns null before any of that matters.
 */
export function FirstRentalTour({ suppressed = false }: { suppressed?: boolean }) {
  const { active, stops, index, next, back, end } = useFirstRentalTour(suppressed);
  const [mounted, setMounted] = useState(false);

  // Portals need a document. Next renders this on the server first.
  useEffect(() => setMounted(true), []);

  if (!mounted || !active || stops.length === 0) return null;

  return createPortal(
    <TourLayer
      stops={stops}
      index={index}
      onNext={next}
      onBack={back}
      onEnd={end}
    />,
    document.body,
  );
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 344;
const GAP = 16;
const PAD = 8;

function TourLayer({
  stops,
  index,
  onNext,
  onBack,
  onEnd,
}: {
  stops: readonly { stop: { id: string; title: string; body: string; side: 'right' | 'bottom' }; element: Element; notes: readonly string[] }[];
  index: number;
  onNext: () => void;
  onBack: () => void;
  onEnd: () => void;
}) {
  const current = stops[index];
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const element = current?.element ?? null;

  const measure = useCallback(() => {
    if (!element) return;
    // The element can be removed while the tour is up — a route change that
    // rebuilds the rail, a permissions refetch, a manager losing a tab. Ending
    // is the only honest response; pointing at a detached node is the exact
    // stall this tour is built to avoid.
    if (!document.contains(element)) {
      onEnd();
      return;
    }
    const r = element.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      onEnd();
      return;
    }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [element, onEnd]);

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

  // Bring the anchor into view if it is off screen (a long sidebar, a small
  // laptop). Only on the step change, never on every measure.
  useEffect(() => {
    element?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [element, reduceMotion]);

  // Clicking the thing being pointed at is the point of the tour, so it counts
  // as "understood" and moves on rather than leaving the card behind.
  useEffect(() => {
    if (!element) return;
    const onClick = () => onNext();
    element.addEventListener('click', onClick);
    return () => element.removeEventListener('click', onClick);
  }, [element, onNext]);

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
  // back where it was when the tour ends.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
    // Once per mount — refocusing on every step would fight the scroll above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!current || !rect) return null;

  const isLast = index === stops.length - 1;
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight;

  // Place to the preferred side, then clamp into the viewport. Narrow screens
  // fall back to sitting under the anchor rather than hanging off the edge.
  const roomRight = viewportW - (rect.left + rect.width) - GAP * 2;
  const placeRight = current.stop.side === 'right' && roomRight >= CARD_WIDTH;

  const rawLeft = placeRight
    ? rect.left + rect.width + GAP
    : rect.left + rect.width / 2 - CARD_WIDTH / 2;
  const left = Math.min(
    Math.max(GAP, rawLeft),
    Math.max(GAP, viewportW - CARD_WIDTH - GAP),
  );

  const rawTop = placeRight ? rect.top - 8 : rect.top + rect.height + GAP;
  // 260px is a generous guess at the card's height; it only affects the clamp,
  // and clamping a little early is invisible while clamping late is not.
  const top = Math.min(Math.max(GAP, rawTop), Math.max(GAP, viewportH - 260));

  return (
    <div
      className="fixed inset-0 z-[65]"
      // The layer itself takes NO clicks. Only the card below opts back in, so
      // the whole app keeps working underneath and nobody is ever trapped.
      style={{ pointerEvents: 'none' }}
      aria-live="polite"
    >
      {/* Spotlight. One box-shadow does the dimming — a 9999px spread from the
          hole outward — which is far cheaper than four positioned panels and
          keeps the cut-out perfectly aligned with the ring around it. */}
      <motion.div
        aria-hidden
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{
          opacity: 1,
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
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

      <AnimatePresence mode="wait">
        <motion.div
          key={current.stop.id}
          ref={cardRef}
          role="dialog"
          aria-modal="false"
          aria-label={`${current.stop.title} — step ${index + 1} of ${stops.length}`}
          tabIndex={-1}
          data-first-rental-tour=""
          initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -6, scale: 0.98 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
          className="absolute flex flex-col gap-4 rounded-3xl bg-card p-5 text-card-foreground shadow-md outline-none ring-1 ring-foreground/10 dark:ring-foreground/15"
          style={{ top, left, width: CARD_WIDTH, pointerEvents: 'auto' }}
        >
          {/* Header — mark, step counter */}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
                <Sparkles className="size-4" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Your first rental
              </span>
            </span>
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {index + 1} of {stops.length}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-lg font-medium leading-snug text-foreground">
              {current.stop.title}
            </h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {current.stop.body}
            </p>
          </div>

          {/* The quiet lines. One each, no depth — agreements and insurance are
              taught by the setup checklist and by their own empty states, not
              here. Notes whose anchor was absent were already dropped at launch,
              so nothing here points at a screen this operator cannot see. */}
          {current.notes.length > 0 && (
            <ul className="flex flex-col gap-1.5 border-t border-foreground/[0.07] pt-3">
              {current.notes.map((note) => (
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

          {/* Actions. Skip is present on EVERY step, by requirement — it is the
              left-hand item so it never moves as the step counter changes. */}
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={onEnd}
            >
              Skip
            </Button>
            <div className="flex items-center gap-1.5">
              {index > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                  Back
                </Button>
              )}
              <Button type="button" size="sm" onClick={onNext}>
                {isLast ? 'Got it' : 'Next'}
                {isLast ? (
                  <Check className="size-3.5" />
                ) : (
                  <ArrowRight className="size-3.5" />
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
