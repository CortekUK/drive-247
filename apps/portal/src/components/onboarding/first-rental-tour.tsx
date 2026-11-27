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
import {
  RentalNeedCarArt,
  RentalNeedCustomerArt,
  RentalNeedStripeArt,
} from '@/components/illustrations-v2/scenes/rental-needs';
import { MOTION_IN, MOTION_OFFSET, MOTION_OUT } from '@/lib/motion';
import { endFakeQuickTour } from '@/lib/fake-quick-tour';
import { useFirstRentalTourEligible } from '@/hooks/use-first-rental-tour';
import { TourSync } from '@/components/onboarding/tour-sync';

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
  // Tour progress kept in the database, so it follows the person (Northwind v2 only).
  const syncEnabled = useFirstRentalTourEligible();
  return (
    <>
      <TourSync enabled={syncEnabled} />
      <FirstRentalTourLayer suppressed={suppressed} />
    </>
  );
}

function FirstRentalTourLayer({ suppressed }: { suppressed: boolean }) {
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
  const [spot, setSpot] = useState<Rect[] | null>(null);
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
  // A required run: the page behind takes no clicks, so the only way on is
  // the card. Transparent, so the look is the same as any other run.
  const blocker = tour.required ? <div aria-hidden className="fixed inset-0 z-[64]" data-tour-blocker="" /> : null;

  if (tour.phase === 'transit' || tour.phase === 'navigating' || tour.phase === 'waiting') {
    return createPortal(
      <>
        {veil}
        {blocker}
        <TransitPill
          label={tour.steps[tour.index]?.label}
          onSkip={tour.required ? undefined : tour.end}
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
        {blocker}
        <TourLayer
          topic={tour.tabTopic}
          required={tour.required}
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

/** One rounded hole (a closed sub-path). */
function holePath(r: Rect, viewportW: number, viewportH: number): string {
  const x = Math.max(0, r.left - VEIL_PAD);
  const y = Math.max(0, r.top - VEIL_PAD);
  const w = Math.min(viewportW, r.left + r.width + VEIL_PAD) - x;
  const h = Math.min(viewportH, r.top + r.height + VEIL_PAD) - y;
  const rad = Math.max(0, Math.min(VEIL_RADIUS, w / 2, h / 2));
  return (
    `M${x + rad},${y} H${x + w - rad} A${rad},${rad} 0 0 1 ${x + w},${y + rad} ` +
    `V${y + h - rad} A${rad},${rad} 0 0 1 ${x + w - rad},${y + h} ` +
    `H${x + rad} A${rad},${rad} 0 0 1 ${x},${y + h - rad} ` +
    `V${y + rad} A${rad},${rad} 0 0 1 ${x + rad},${y} Z`
  );
}

/** The viewport minus rounded holes (even-odd), for `clip-path`. Holes must not overlap. */
function veilPath(holes: readonly Rect[], viewportW: number, viewportH: number): string {
  const cut = holes.map((r) => holePath(r, viewportW, viewportH)).join(' ');
  return `path(evenodd, "M0,0 H${viewportW} V${viewportH} H0 Z ${cut}")`;
}

const union = (a: Rect, b: Rect): Rect => {
  const top = Math.min(a.top, b.top);
  const left = Math.min(a.left, b.left);
  return {
    top,
    left,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
};

/**
 * Holes for the pointed-at things. Two that would touch once padded become
 * one (even-odd would fill their overlap back in), so neighbouring sidebar
 * rows read as one block while the phone's Vehicles and Customers tabs, with
 * Rental between them, stay two.
 */
function mergeHoles(rects: readonly Rect[]): Rect[] {
  const out: Rect[] = [];
  const near = (a: Rect, b: Rect) =>
    a.left - VEIL_PAD * 2 <= b.left + b.width &&
    b.left - VEIL_PAD * 2 <= a.left + a.width &&
    a.top - VEIL_PAD * 2 <= b.top + b.height &&
    b.top - VEIL_PAD * 2 <= a.top + a.height;
  for (const r of rects) {
    let merged = r;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (near(out[i], merged)) {
        merged = union(out[i], merged);
        out.splice(i, 1);
      }
    }
    out.push(merged);
  }
  return out;
}

function TourVeil({ spot }: { spot: Rect[] | null }) {
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
        clipPath: spot && spot.length > 0 ? veilPath(spot, viewportW, viewportH) : undefined,
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
  // A small control (a menu button, a tab): point at its lower right, so the
  // arrow does not sit on top of the icon it is pointing at.
  if (r.width < 64 && r.height < 64) return { x: r.left + r.width * 0.74, y: r.top + r.height * 0.8 };
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
  { id: 'car', label: 'A car', caption: 'With its prices and photos, added in Vehicles.', Art: RentalNeedCarArt },
  { id: 'customer', label: 'A customer', caption: 'Who is renting. I check their licence and face.', Art: RentalNeedCustomerArt },
  { id: 'stripe', label: 'Your Stripe account', caption: 'Customers pay you directly into it. Connect it under Integrations.', Art: RentalNeedStripeArt },
] as const;

function RentalNeeds() {
  return (
    <div className="mt-2 flex flex-col gap-3">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-2.5" data-tour-rental-needs="">
        {RENTAL_NEEDS.map(({ id, label, caption, Art }, i) => (
          <li
            key={id}
            className="flex items-center gap-3 overflow-hidden rounded-xl border border-foreground/[0.08] bg-card pr-3 sm:flex-col sm:items-stretch sm:gap-0 sm:pr-0"
          >
            <div className="relative w-[118px] shrink-0 self-stretch bg-primary/[0.04] px-1.5 py-1 sm:w-full sm:border-b sm:border-foreground/[0.06] sm:px-2.5 sm:pb-0.5 sm:pt-2 dark:bg-primary/[0.08]">
              <span className="absolute left-2 top-2 z-[1] inline-flex size-[22px] items-center justify-center rounded-full bg-primary text-[12px] font-semibold tabular-nums text-primary-foreground sm:left-2.5 sm:top-2.5">
                {i + 1}
              </span>
              {/* Short screens (a phone on its side): smaller pictures, so the card fits without scrolling. */}
              <Art className="flex h-full w-full max-w-[200px] items-center sm:[@media(max-height:560px)]:max-w-[118px]" />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5 py-2.5 sm:px-3 sm:pb-3">
              <span className="text-[14px] font-semibold leading-snug text-foreground">{label}</span>
              <span className="text-[12.5px] leading-snug text-muted-foreground">{caption}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground [@media(max-height:560px)]:leading-snug">
        The driver check, the agreement and insurance come with the rental itself. I will show you where each one
        lives.
      </p>
    </div>
  );
}

/**
 * The last card's handover to the tab tours: the same compass button the
 * tabs carry, drawn as it looks, so it is recognised when they meet it.
 */
function TabTourHint() {
  return (
    <div
      data-tour-tab-hint=""
      className="mt-1.5 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-3 dark:bg-primary/[0.12]"
    >
      <span
        aria-hidden
        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/5 text-primary dark:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))]"
      >
        <Compass className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[14px] font-semibold leading-snug text-foreground">Every tab has its own tour</span>
        <span className="text-[13px] leading-snug text-muted-foreground">
          Look for this button at the top of any tab. Each tour is split into short topics you can take one at a
          time, whenever you like.
        </span>
      </span>
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
  required = false,
  topic = null,
}: {
  /** A tab tour topic: its name above the title, and "2 of 6" in the footer. */
  topic?: { tourLabel: string; topicTitle: string } | null;
  /** A required run: no close button, and Esc does nothing. */
  required?: boolean;
  /** Tells the veil what to leave clear (null: nothing, the card is centred). */
  onSpot?: (spot: Rect[] | null) => void;
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
  /** The anchor alone (the cursor points here), and the clear holes. */
  const [anchorBox, setAnchorBox] = useState<Rect | null>(null);
  const [holes, setHoles] = useState<Rect[]>([]);
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
    const own: Rect = { top: box.top, left: box.left, width: box.width, height: box.height };
    const parts: Rect[] = [own];
    let all = own;
    for (const selector of step.span ?? []) {
      const other = findAnchor([selector], document);
      if (!other || other === element) continue;
      const o = other.getBoundingClientRect();
      const r = { top: o.top, left: o.left, width: o.width, height: o.height };
      parts.push(r);
      all = union(all, r);
    }
    setRect(all);
    setAnchorBox(own);
    setHoles(mergeHoles(parts));
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

  // The phone record dock scrolls with the page, so it can land on the target.
  // Hide it while it covers what is being pointed at.
  useEffect(() => {
    const root = document.documentElement;
    const dock = document.querySelector('[data-record-dock] > *');
    const off =
      !!rect && !!dock && !!element && !element.closest('[data-record-dock]') &&
      (() => {
        const d = dock.getBoundingClientRect();
        return d.top < rect.top + rect.height && d.bottom > rect.top && d.left < rect.left + rect.width && d.right > rect.left;
      })();
    if (off) root.setAttribute('data-tour-dock-off', '');
    else root.removeAttribute('data-tour-dock-off');
  }, [rect, element]);
  useEffect(() => () => document.documentElement.removeAttribute('data-tour-dock-off'), []);

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
    if (!element) return;
    const behavior = reduceMotion ? 'auto' : 'smooth';
    // A phone has no room beside the target, so the card goes above or below it:
    // a small target near the top or bottom edge is brought to the middle first.
    const r = element.getBoundingClientRect();
    const vh = window.innerHeight;
    const phone = window.innerWidth < 640;
    const small = r.height < vh * 0.35;
    const cramped = r.top < vh * 0.15 || r.bottom > vh * 0.62;
    const fixed = element.closest('[data-mobile-tab-bar], [data-record-dock], header, [data-sidebar="sidebar"]');
    element.scrollIntoView({ block: phone && small && cramped && !fixed ? 'center' : 'nearest', behavior });
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
        // A step that closes a dialog sends its own Escape; that one is not the operator's.
        if ((e as KeyboardEvent & { __tour?: boolean }).__tour) return;
        e.preventDefault();
        if (!required) onEnd();
      } else if (e.key === 'ArrowRight') {
        onNext();
      } else if (e.key === 'ArrowLeft') {
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEnd, onNext, onBack, required]);

  // Tell the veil what to leave clear: the anchor, unless this card is centred.
  useEffect(() => {
    if (!onSpot) return;
    if (!element || !rect || step.side === 'center') {
      onSpot(null);
      return;
    }
    const tooBig = (rect.width * rect.height) / (window.innerWidth * window.innerHeight) > OVERSIZE;
    onSpot(tooBig ? null : holes);
  }, [element, rect, holes, step.side, onSpot]);

  // A tab tour step can sit beside an open dialog. Radix closes a dialog on a
  // press or focus outside it, and this card is outside it, so its presses and
  // focus stop here instead of reaching the document.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const stop = (e: Event) => e.stopPropagation();
    card.addEventListener('pointerdown', stop);
    card.addEventListener('focusin', stop);
    card.addEventListener('focusout', stop);
    return () => {
      card.removeEventListener('pointerdown', stop);
      card.removeEventListener('focusin', stop);
      card.removeEventListener('focusout', stop);
    };
  });

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
  // The cursor points at the anchor itself, even when neighbours are cleared with it.
  const tip = !centered && rect ? tipFor(anchorBox ?? rect, step.side) : null;

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
  const counter = topic
    ? `${index + 1} of ${steps.length}`
    : stopNumber > 0
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
      <style>{'html[data-tour-dock-off] [data-record-dock] { visibility: hidden; }'}</style>
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
          style={{ top, left, width: cardW, maxHeight: viewportH - GAP * 2, pointerEvents: 'auto' }}
        >
          <div
            className={cn(
              'flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain',
              isWelcome ? 'px-6 pb-5 pt-5 max-sm:px-5 max-sm:pb-4 max-sm:pt-4' : 'px-5 pb-4 pt-4',
            )}
          >
            {/* Title and the way out. The X ends the tour, as Escape does. */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                {topic && (
                  <p className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-primary" data-tour-topic="">
                    {topic.tourLabel} · {topic.topicTitle}
                  </p>
                )}
                <h2
                  className={cn(
                    'font-heading font-semibold text-foreground',
                    isWelcome ? 'text-[21px] leading-tight tracking-[-0.01em]' : 'text-[17px] leading-snug',
                  )}
                >
                  {step.title}
                </h2>
              </div>
              {!required && (
                <button
                  type="button"
                  onClick={onEnd}
                  aria-label="Close the tour"
                  title="Close"
                  // Sits in the top corner, level with the first line of the header.
                  className={cn(
                    'v2-phone-hit -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
                    topic ? '-mt-1.5' : '-mt-0.5',
                  )}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <p className="text-[14px] leading-relaxed text-muted-foreground">{body || step.body}</p>

            {isWelcome && <RentalNeeds />}

            {step.tabTourHint && <TabTourHint />}

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
              <div className="mt-1.5 flex flex-wrap gap-2 [&_button]:max-sm:h-10 [&_button]:max-sm:text-[14px]">
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
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-primary/15 bg-primary/[0.05] px-5 py-3 max-sm:px-4 max-sm:py-2.5 [&_button]:max-sm:h-10 [&_button]:max-sm:min-w-[72px] [&_button]:max-sm:px-4 [&_button]:max-sm:text-[14px]">
            <span className="text-[13px] tabular-nums text-muted-foreground">{counter}</span>
            <div className="flex items-center gap-1.5">
              {!isFirst && (
                <Button type="button" variant="ghost" size="sm" onClick={onBack}>
                  Back
                </Button>
              )}
              {isLast && topic ? (
                <Button type="button" variant={actions.length > 0 ? 'ghost' : 'default'} size="sm" onClick={onNext}>
                  Done
                  {actions.length === 0 && <Check className="size-3.5" />}
                </Button>
              ) : isLast ? (
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
                  {isFirst && !topic ? "Let's go" : 'Next'}
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
  /** Absent on a required run: there is no skipping it. */
  onSkip?: () => void;
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
        <span className={onSkip ? undefined : 'pr-2'}>{label ? `Heading to ${label}…` : 'One moment…'}</span>
        {onSkip && (
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={onSkip}>
            Skip tour
          </Button>
        )}
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
