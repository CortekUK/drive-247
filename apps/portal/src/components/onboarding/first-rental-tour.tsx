'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Compass, LayoutDashboard, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { cn } from '@/lib/utils';
import { useFirstRentalTour } from '@/hooks/use-first-rental-tour';
import { useSystemAnnouncementPriority } from '@/lib/announcements/system-priority';
import { findAnchor, isTourStop, routePathname, type ResolvedStep, type TourAction, type TourSide, type TourStep } from '@/lib/first-rental-tour';
import { CustomersEmptyArt, VehiclesEmptyArt } from '@/components/illustrations-v2/empty-scenes';
import { PaymentsEmptyArt } from '@/components/illustrations-v2/scenes/payments';
import { MOTION_IN, MOTION_OFFSET, MOTION_OUT } from '@/lib/motion';
import { endFakeQuickTour } from '@/lib/fake-quick-tour';

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
 * SYSTEM ANNOUNCEMENTS GO FIRST. A run that started BY ITSELF (autostart, silent
 * resume) and that nobody has touched yet, the transit pill of such a run, and the
 * resume prompt carry `data-yields-to-system`: they step aside for a system
 * announcement dialog (the hook does the stepping aside, recording nothing), so the
 * announcement host does not wait for them. A run the operator started or has pressed
 * Next / Back in carries no such attribute, and the host waits for it to end. See
 * lib/announcements/system-priority.ts.
 *
 * THEME. It renders through a portal onto `<body>`, which is where `.v2-theme`
 * lives, so `bg-card`, `rounded-3xl`, `ring-foreground/5` and the rest resolve
 * to the v2 ramp exactly as they do inside the app. Outside the canary the hook
 * never leaves `idle`, so none of this mounts.
 */
export function FirstRentalTour({ suppressed = false }: { suppressed?: boolean }) {
  const tour = useFirstRentalTour(suppressed);
  const [mounted, setMounted] = useState(false);
  // The hook steps an untouched run aside in an effect; this keeps it off screen from the
  // very render in which a system announcement dialog became due, so it is never painted.
  const systemPriority = useSystemAnnouncementPriority();
  const stepAside = tour.yieldsToSystem && systemPriority !== 'idle';

  // Portals need a document. Next renders this on the server first.
  useEffect(() => setMounted(true), []);

  // The pointed-at thing, as the card layer measured it: the veil leaves it
  // clear. Kept here, not in the card layer, because that layer remounts on
  // every step and the veil must NOT, or the page would flash between steps.
  const [spot, setSpot] = useState<Rect | null>(null);
  useEffect(() => {
    // A new page (a tab tour moving on) or the end of the run: no hole.
    if (tour.phase === 'navigating' || tour.phase === 'idle') setSpot(null);
  }, [tour.phase]);

  // A /fake-quick-tour run keeps the dashboard's dialogs shut. Once the tour
  // goes back to idle (finished, skipped or paused) the portal is normal again.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (tour.phase !== 'idle') {
      wasRunning.current = true;
      return;
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      endFakeQuickTour();
    }
  }, [tour.phase]);

  if (!mounted || stepAside) return null;

  if (tour.phase === 'prompt') {
    return createPortal(
      <ResumePrompt
        yieldsToSystem
        onResume={tour.resume}
        onStartOver={tour.startOver}
        onDismiss={tour.dismissPrompt}
      />,
      document.body,
    );
  }

  // Tones the rest of the app down while a card is up, and stays up across
  // the step change (same element, same place in both branches below, so
  // React keeps it). Off while a tab tour navigates.
  const veil = tour.phase !== 'navigating' ? <TourVeil spot={spot} /> : null;

  if (tour.phase === 'transit' || tour.phase === 'navigating' || tour.phase === 'waiting') {
    return createPortal(
      <>
        {veil}
        <TransitPill
          label={tour.steps[tour.index]?.label}
          onSkip={tour.end}
          yieldsToSystem={tour.yieldsToSystem}
        />
      </>,
      document.body,
    );
  }

  if (tour.phase === 'showing' && tour.current) {
    return createPortal(
      <>
        {veil}
        <TourLayer
          onSpot={setSpot}
          resolved={tour.current}
          steps={tour.steps}
          index={tour.index}
          detail={tour.detail}
          body={tour.body}
          actions={tour.actions}
          onAction={tour.runAction}
          onNext={tour.next}
          onBack={tour.back}
          onEnd={tour.end}
          onFinishToDashboard={tour.finishToDashboard}
          onAnchorLost={tour.anchorLost}
          onPause={tour.pause}
          yieldsToSystem={tour.yieldsToSystem}
        />
      </>,
      document.body,
    );
  }

  return null;
}

// ── The card + cursor ──────────────────────────────────────────────────────
//
// The look (Ghulam, 23 Nov 2026, from PostHog's own product tour): the page
// stays sharp and usable, with NO blur and NO spotlight ring, only toned down
// by a light veil of its own background colour (`TourVeil`), the pointed-at
// thing left clear. A small cursor glides from one thing to the next and points
// at it, and a plain popover card sits beside the cursor: title and a close
// button, the words, a hairline, then "2 of 11" with Back and Next.
//
// The spotlight it replaced (blur layer, dim, rim, lift, placement latch) was
// heavy enough that the app behind it stopped reading as the app, which is the
// opposite of what an orientation is for.

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The veil: the rest of the app, toned down (Ghulam, 23 Nov: "tone down the
 * rest of the UI, not the tour card", then "blackish", lighter). A light black
 * dim; no blur, so the app still reads as the app. The pointed-at thing is
 * left clear.
 */
const VEIL = 'hsl(0 0% 4% / 0.28)';
/** How far the clear hole stands off the pointed-at thing, and its corners. */
const VEIL_PAD = 6;
const VEIL_RADIUS = 10;

/** The viewport minus a rounded hole (even-odd), for `clip-path`. */
function veilPath(r: Rect, viewportW: number, viewportH: number): string {
  const x = Math.max(0, r.left - VEIL_PAD);
  const y = Math.max(0, r.top - VEIL_PAD);
  const w = Math.min(viewportW, r.left + r.width + VEIL_PAD) - x;
  const h = Math.min(viewportH, r.top + r.height + VEIL_PAD) - y;
  const rad = Math.max(0, Math.min(VEIL_RADIUS, w / 2, h / 2));
  const hole =
    `M${x + rad},${y} H${x + w - rad} A${rad},${rad} 0 0 1 ${x + w},${y + rad} ` +
    `V${y + h - rad} A${rad},${rad} 0 0 1 ${x + w - rad},${y + h} ` +
    `H${x + rad} A${rad},${rad} 0 0 1 ${x},${y + h - rad} ` +
    `V${y + rad} A${rad},${rad} 0 0 1 ${x + rad},${y} Z`;
  return `path(evenodd, "M0,0 H${viewportW} V${viewportH} H0 Z ${hole}")`;
}

function TourVeil({ spot }: { spot: Rect | null }) {
  const reduceMotion = useReducedMotion();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  return (
    <motion.div
      aria-hidden
      // Under the card layer (z-65). Takes no clicks: the app stays usable.
      className="fixed inset-0 z-[64] transition-[clip-path] duration-300 ease-out"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : MOTION_IN}
      style={{
        background: VEIL,
        clipPath: spot ? veilPath(spot, viewportW, viewportH) : undefined,
        pointerEvents: 'none',
      }}
    />
  );
}

/** Card width beside the cursor. */
const CARD_WIDTH = 360;
/** Card width for a step with nothing to point at (Done, phone stops). */
const CENTERED_WIDTH = 420;
/** The Welcome card: wide enough for the three illustrated tiles in a row. */
const WELCOME_WIDTH = 640;
/** Keep the card at least this far inside the viewport. */
const GAP = 16;
/**
 * An anchor covering more than this share of the viewport is pointing at
 * everything, which is to say nothing: the card goes centre instead.
 */
const OVERSIZE = 0.66;

/**
 * Where the cursor's tip was last, across steps. The card layer remounts on
 * every step (the hook passes through `waiting` in between), so the cursor
 * would otherwise appear from nowhere each time instead of gliding over.
 */
let lastTip: { x: number; y: number } | null = null;

/**
 * Where the cursor's tip lands: just inside the anchor's edge on the side the
 * card goes, so the cursor sits BETWEEN the thing and the card, as in
 * PostHog's tour. (It used to land 55% across, and the card was placed off the
 * tip, so on a wide anchor like the Portal / Website switch the card covered
 * the very thing it was describing.)
 */
function tipFor(r: Rect, side: TourSide): { x: number; y: number } {
  if (side === 'bottom') return { x: r.left + r.width / 2, y: r.top + r.height * 0.72 };
  if (side === 'top') return { x: r.left + r.width / 2, y: r.top + r.height * 0.3 };
  const inset = Math.min(18, r.width / 3);
  return { x: side === 'left' ? r.left + inset : r.left + r.width - inset, y: r.top + r.height * 0.55 };
}

/** Space between the anchor's edge and the card: room for the cursor. */
const CARD_OFFSET = 24;

/**
 * Where the card goes: beside the ANCHOR, never on top of it. Tries the
 * step's own side first, then the others, and takes the first that fits on
 * screen. Beside it, the card's top sits a little above the cursor tip.
 */
function cardBeside(
  r: Rect,
  tip: { x: number; y: number },
  side: TourSide,
  cardW: number,
  cardH: number,
  viewportW: number,
  viewportH: number,
): { left: number; top: number } {
  const right = r.left + r.width;
  const bottom = r.top + r.height;
  const clampX = (l: number) => Math.min(Math.max(l, GAP), Math.max(GAP, viewportW - GAP - cardW));
  const clampY = (t: number) => Math.min(Math.max(t, GAP), Math.max(GAP, viewportH - GAP - cardH));
  const fitsX = (l: number) => l >= GAP && l + cardW <= viewportW - GAP;

  type Try = () => { left: number; top: number } | null;
  const onRight: Try = () => {
    const left = right + CARD_OFFSET;
    return fitsX(left) ? { left, top: clampY(tip.y - 28) } : null;
  };
  const onLeft: Try = () => {
    const left = r.left - CARD_OFFSET - cardW;
    return fitsX(left) ? { left, top: clampY(tip.y - 28) } : null;
  };
  // Below: clear of the anchor AND of the cursor hanging off its bottom edge.
  const below: Try = () => {
    const top = Math.max(bottom, tip.y + 26) + 12;
    return top + cardH <= viewportH - GAP ? { left: clampX(tip.x - 28), top } : null;
  };
  const above: Try = () => {
    const top = r.top - 12 - cardH;
    return top >= GAP ? { left: clampX(tip.x - 28), top } : null;
  };

  const order: Try[] =
    side === 'left'
      ? [onLeft, below, onRight, above]
      : side === 'bottom'
        ? [below, onRight, onLeft, above]
        : side === 'top'
          ? [above, below, onRight, onLeft]
          : [onRight, below, onLeft, above];
  for (const t of order) {
    const p = t();
    if (p) return p;
  }
  return { left: clampX(right + CARD_OFFSET), top: clampY(tip.y - 28) };
}

/** The pointer itself: an arrow in the accent colour with a white edge. */
function TourCursor({ x, y, reduceMotion }: { x: number; y: number; reduceMotion: boolean | null }) {
  // Read once, on mount: where to glide FROM. A first appearance fades in from
  // a little below and to the right of where it lands.
  const [from] = useState(() => lastTip);
  useEffect(() => {
    lastTip = { x, y };
  }, [x, y]);
  // The SVG's tip is at (3, 2); shift so that point lands on (x, y).
  const at = { x: x - 3, y: y - 2 };
  return (
    <motion.div
      aria-hidden
      className="absolute left-0 top-0"
      style={{ pointerEvents: 'none' }}
      initial={
        reduceMotion
          ? false
          : from
            ? { x: from.x - 3, y: from.y - 2, opacity: 1 }
            : { x: at.x + 40, y: at.y + 32, opacity: 0 }
      }
      animate={{ x: at.x, y: at.y, opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 22, mass: 0.9 }}
    >
      <svg width="26" height="28" viewBox="0 0 26 28" className="drop-shadow-[0_2px_3px_rgba(15,23,42,0.35)]">
        <path
          d="M3 2 L3 22 L8.4 17.2 L12.4 26 L16.6 24.2 L12.7 15.6 L20 15.6 Z"
          fill="hsl(var(--primary))"
          stroke="white"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  );
}

/**
 * The hello card's picture: what a first rental needs AT LEAST, illustrated
 * with the app's own empty-state art (ILLUSTRATION_GUIDE.md). A car, a
 * customer and Stripe: without any one of them New Rental cannot finish. The
 * rest comes with the rental itself, and the line under the tiles says so.
 */
const RENTAL_NEEDS = [
  { id: 'car', label: 'A car', caption: 'With its prices and photos, added in Vehicles.', Art: VehiclesEmptyArt },
  { id: 'customer', label: 'A customer', caption: 'Who is renting. Bookings on your site add them for you.', Art: CustomersEmptyArt },
  { id: 'stripe', label: 'Your Stripe account', caption: 'Your customers pay you directly into it. Connect it under Integrations.', Art: PaymentsEmptyArt },
] as const;

function RentalNeeds() {
  return (
    <div className="mt-2 flex flex-col gap-3">
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {RENTAL_NEEDS.map(({ id, label, caption, Art }) => (
          <li
            key={id}
            className="flex items-center gap-3 overflow-hidden rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] pr-3 sm:flex-col sm:items-stretch sm:gap-0 sm:pr-0"
          >
            <div className="w-24 shrink-0 bg-card px-2 py-1.5 sm:w-full sm:border-b sm:border-foreground/[0.06] sm:px-3 sm:pb-0 sm:pt-2">
              <Art className="w-full max-w-[180px]" />
            </div>
            <div className="flex flex-col gap-0.5 py-2.5 sm:px-3">
              <span className="text-[13px] font-semibold text-foreground">{label}</span>
              <span className="text-[12px] leading-snug text-muted-foreground">{caption}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        The driver check, the agreement and insurance come with the rental itself. I will show you where each one
        lives.
      </p>
    </div>
  );
}

function TourLayer({
  resolved,
  steps,
  index,
  detail,
  body,
  actions = [],
  onAction,
  onNext,
  onBack,
  onEnd,
  onFinishToDashboard,
  onAnchorLost,
  onPause,
  onSpot,
  yieldsToSystem = false,
}: {
  /** Tells the veil what to leave clear (null: nothing, the card is centred). */
  onSpot?: (spot: Rect | null) => void;
  resolved: ResolvedStep;
  steps: readonly TourStep[];
  index: number;
  detail: string | null;
  /** The step's words as worked out for this company (`bodyFor`), else `step.body`. */
  body?: string;
  /** Buttons that end the tour and do something (the last card's Connect Stripe, Book a call). */
  actions?: readonly TourAction[];
  onAction?: (id: TourAction['id']) => void;
  onNext: () => void;
  onBack: () => void;
  onEnd: () => void;
  onFinishToDashboard: () => void;
  onAnchorLost: () => void;
  onPause: () => void;
  /** Launched by itself and untouched: steps aside for a system announcement dialog. */
  yieldsToSystem?: boolean;
}) {
  const { step, element, notes } = resolved;
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const measure = useCallback(() => {
    if (!element) return;
    // The element can be removed while the tour is up — a route change that
    // rebuilds the rail, a permissions refetch, a tab switch. Hand it back to
    // the hook (which re-resolves, then skips) rather than point at nothing.
    if (!document.contains(element)) {
      onAnchorLost();
      return;
    }
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) {
      onAnchorLost();
      return;
    }
    // Take in the step's neighbours (`span`): Customers with Vehicles, the
    // money and paperwork rows as one block.
    let top = box.top;
    let left = box.left;
    let right = box.right;
    let bottom = box.bottom;
    for (const selector of step.span ?? []) {
      const other = findAnchor([selector], document);
      if (!other) continue;
      const o = other.getBoundingClientRect();
      top = Math.min(top, o.top);
      left = Math.min(left, o.left);
      right = Math.max(right, o.right);
      bottom = Math.max(bottom, o.bottom);
    }
    setRect({ top, left, width: right - left, height: bottom - top });
  }, [element, onAnchorLost, step.span]);

  // Measure before paint so the cursor never lands in the wrong place for a
  // frame, then keep it honest through scroll, resize and layout shifts.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (!element) return;
    // `true` — capture phase, so scrolling INSIDE the sidebar (which does not
    // bubble a scroll event to window) still re-measures.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [element, measure]);

  // The card's real height, so it is kept inside the viewport by the truth
  // rather than a guess. The equality guard keeps this from looping.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const h = card.offsetHeight || 200;
    if (h !== cardH) setCardH(h);
  });

  // Bring the anchor into view if it is off screen (a long sidebar, a small
  // laptop). Only on the step change, never on every measure.
  useEffect(() => {
    element?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [element, reduceMotion]);

  // Clicking the thing being pointed at. On a look-at-this step whose next
  // step is on the same page, that counts as "understood" and moves on. On a
  // do-this step the tour steps aside instead. When the next step is on
  // another page, a click is left alone: the hook notices the route change.
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

  // Tell the veil what to leave clear: the anchor, unless this card is centred.
  useEffect(() => {
    if (!onSpot) return;
    if (!element || !rect || step.side === 'center') {
      onSpot(null);
      return;
    }
    const tooBig = (rect.width * rect.height) / (window.innerWidth * window.innerHeight) > OVERSIZE;
    onSpot(tooBig ? null : rect);
  }, [element, rect, step.side, onSpot]);

  // A fresh run starts the cursor fresh: it fades in at the first stop
  // instead of gliding over from wherever the last run left it.
  useEffect(() => {
    if (index === 0) lastTip = null;
  }, [index]);

  // Move focus to the card so the buttons are immediately reachable, and put it
  // back where it was when the layer goes away.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cardRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [step.id]);

  const hasAnchor = element !== null;
  if (hasAnchor && !rect) return null;

  const isLast = index === steps.length - 1;
  const isFirst = index === 0;
  const onDashboard = typeof window !== 'undefined' && window.location.pathname === '/';
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight;
  const isWelcome = step.id === 'welcome';

  const oversized = rect !== null && (rect.width * rect.height) / (viewportW * viewportH) > OVERSIZE;
  const centered = !hasAnchor || oversized || step.side === 'center';
  const tip = !centered && rect ? tipFor(rect, step.side) : null;

  const cardW = Math.min(
    centered ? (isWelcome ? WELCOME_WIDTH : CENTERED_WIDTH) : CARD_WIDTH,
    viewportW - GAP * 2,
  );
  const { left, top } = tip
    ? cardBeside(rect!, tip, step.side, cardW, cardH, viewportW, viewportH)
    : { left: (viewportW - cardW) / 2, top: Math.max(GAP, viewportH * 0.4 - cardH / 2) };

  const outline = step.showOutline ? steps.filter(isTourStop).map((s) => s.label) : [];
  // The counter counts the STOPS only ("2 of 5"): the hello and last cards are
  // not stops and carry none, and the hello card says how many there are.
  const stops = steps.filter(isTourStop);
  const stopNumber = stops.findIndex((s) => s.id === step.id) + 1;
  const counter =
    stopNumber > 0
      ? `${stopNumber} of ${stops.length}`
      : isFirst && stops.length > 0
        ? `${stops.length} quick stops`
        : '';

  return (
    <div
      className="fixed inset-0 z-[65]"
      // The layer itself takes NO clicks. Only the card opts back in, so the
      // whole app keeps working underneath and nobody is ever trapped.
      style={{ pointerEvents: 'none' }}
      aria-live="polite"
    >
      {tip && <TourCursor x={tip.x} y={tip.y} reduceMotion={reduceMotion} />}

      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          ref={cardRef}
          role="dialog"
          aria-modal="false"
          aria-label={`${step.title} — step ${index + 1} of ${steps.length}`}
          tabIndex={-1}
          data-first-rental-tour=""
          data-yields-to-system={yieldsToSystem ? '' : undefined}
          data-tour-step={step.id}
          initial={reduceMotion ? false : { opacity: 0, y: MOTION_OFFSET }}
          animate={{ opacity: 1, y: 0, transition: reduceMotion ? { duration: 0 } : MOTION_IN }}
          exit={reduceMotion ? undefined : { opacity: 0, y: MOTION_OFFSET, transition: MOTION_OUT }}
          // Stands apart from the page (Ghulam, 23 Nov): an accent edge, a soft
          // accent halo, and a glow under it in the same colour. The veil
          // behind it does the rest.
          className="absolute flex flex-col overflow-hidden rounded-xl border border-primary/35 bg-card text-card-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.10),0_24px_50px_-14px_hsl(var(--primary)/0.45),0_4px_12px_-4px_rgba(15,23,42,0.16)] outline-none"
          style={{ top, left, width: cardW, pointerEvents: 'auto' }}
        >
          <div className={cn('flex flex-col gap-2', isWelcome ? 'px-6 pb-5 pt-5' : 'px-5 pb-4 pt-4')}>
            {/* Title and the way out. The X ends the tour, as Escape does. */}
            <div className="flex items-start justify-between gap-3">
              <h2
                className={cn(
                  'font-heading font-semibold text-foreground',
                  isWelcome ? 'text-[21px] leading-tight tracking-[-0.01em]' : 'text-[17px] leading-snug',
                )}
              >
                {step.title}
              </h2>
              <button
                type="button"
                onClick={onEnd}
                aria-label="Close the tour"
                title="Close"
                className="-mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <p className="text-[14px] leading-relaxed text-muted-foreground">{body || step.body}</p>

            {isWelcome && <RentalNeeds />}

            {detail && (
              <p className="mt-0.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/[0.07] px-2.5 py-1 text-[12px] font-medium text-primary ring-1 ring-primary/10">
                <Compass className="size-3" />
                {detail}
              </p>
            )}

            {/* What we'll cover — the Welcome card only. Built from THIS user's
                steps, so it never promises a page they cannot reach. */}
            {outline.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1.5">
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

            {/* The quiet lines. Notes whose anchor was absent were already
                dropped when the step resolved. */}
            {notes.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1.5">
                {notes.map((note) => (
                  <li key={note} className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
                    <Check className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* The last card's own buttons (Connect Stripe, Book a free call):
                each ends the tour, then does its thing. The first is primary.
                "Later" in the footer closes the tour without either. */}
            {isLast && actions.length > 0 && onAction && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {actions.map((action, i) => (
                  <Button
                    key={action.id}
                    type="button"
                    size="sm"
                    variant={i === 0 ? 'default' : 'outline'}
                    onClick={() => onAction(action.id)}
                  >
                    {action.label}
                    {i === 0 && <ArrowRight className="size-3.5" />}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Footer: where you are, and the way on. */}
          <div className="flex items-center justify-between gap-2 border-t border-primary/15 bg-primary/[0.05] px-5 py-3">
            <span className="text-[13px] tabular-nums text-muted-foreground">{counter}</span>
            <div className="flex items-center gap-1.5">
              {!isFirst && (
                <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                  Back
                </Button>
              )}
              {isLast ? (
                actions.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={onEnd}>
                    Later
                  </Button>
                ) : onDashboard ? (
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
function TransitPill({
  label,
  onSkip,
  yieldsToSystem = false,
}: {
  label?: string;
  onSkip: () => void;
  yieldsToSystem?: boolean;
}) {
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
        data-yields-to-system={yieldsToSystem ? '' : undefined}
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
  yieldsToSystem = false,
}: {
  /** Always true from the tour: the prompt opens by itself, and any answer to it ends it. */
  yieldsToSystem?: boolean;
  onResume: () => void;
  onStartOver: () => void;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[65] flex justify-center px-4">
      <motion.div
        data-tour-prompt=""
        data-yields-to-system={yieldsToSystem ? '' : undefined}
        role="dialog"
        aria-modal="false"
        aria-label="Pick up the walkthrough where you left off?"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-3xl bg-card p-4 text-card-foreground shadow-md ring-1 ring-foreground/10 dark:ring-foreground/15 sm:flex-row sm:items-center"
      >
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
