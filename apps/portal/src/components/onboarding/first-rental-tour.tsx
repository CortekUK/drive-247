'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Check, Compass, LayoutDashboard, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui-v2/button';
import { cn } from '@/lib/utils';
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

const CARD_WIDTH = 400;
const CENTERED_WIDTH = 468;
/**
 * The Welcome card only. It is the one card that is an introduction rather
 * than a label on something — Trax says who it is and what the next minute is
 * for — and at 408px that landed as a notification. Wide enough to carry a
 * two-line headline at a size worth reading.
 */
const WELCOME_WIDTH = 640;
/** Visible space between the spotlight's outer edge and the card. */
const GAP = 16;
/**
 * How far the spotlight stands off the element it is presenting.
 *
 * Was 8, which put the edge on the text's own bounding box — it read as a
 * border drawn around the words rather than a light pointed at them.
 */
const PAD = 12;

/**
 * The spotlight's corner radius. ONE constant, THREE consumers: the pane, the
 * lift, and the radius handed to `scrimHolePath`. Typed as a literal in any of
 * them they drift by a pixel and the seam shows through the corners.
 */
const SPOT_RADIUS = 20;

/**
 * ONE NOTE KEPT FROM A REMOVED CONSTANT, so nobody re-derives it the hard way:
 * an outer `box-shadow`'s inner edge cannot be feathered at any blur radius.
 * The 9999px spread pushes the shadow's own blurred perimeter off-screen, so
 * `0 0 28px 9999px` renders pixel-identical to `0 0 0 9999px`.
 *
 * A `BLUR_FEATHER` once cut the blur's hole 20px outside the dim's, to keep the
 * two edges apart. It was removed: that ring ended up dimmed but NOT blurred,
 * and around a floating panel it showed the page behind it sharp — a stray
 * bright card under the highlighted one. The dim and the blur now share one
 * hole, hugging the anchor exactly, and the rim floats outside both.
 */

/**
 * How hard the page behind the tour is pushed back.
 *
 * A dim alone was not enough. At `0.45` every card, table row and sidebar label
 * behind the tour stayed legible, so the eye kept reading the app instead of
 * the one sentence the step is trying to say — the screen read as noise with a
 * box on top of it. Blur is what actually separates the two planes: text stops
 * resolving as text, and the card becomes the only thing in focus.
 *
 * Kept deliberately light. This is a guide, not a modal — the operator is meant
 * to keep their bearings and see WHERE the thing being described sits on their
 * own screen. Blur it out completely and the tour stops teaching the layout.
 */
const SCRIM = 'hsl(0 0% 4% / 0.38)';
const SCRIM_BLUR = 'blur(5px)';

/**
 * The spotlight's edge, stacked outward from the hole.
 *
 * Every entry is ZERO-BLUR, which is what keeps it cheap enough to re-rasterise
 * on every frame of the spring. Outer box-shadows paint front-to-back — first
 * listed is on top — and are clipped OUT of the border box, so none of this can
 * touch the highlighted element's own pixels. That matters: the target is
 * arbitrary page content and must not be restyled.
 *
 *   0   – 1.5px  a near-white hairline: the lit lip of a raised surface, and
 *                the reason the indigo below is legible at all. The old
 *                `ring-2 ring-primary/60` sat straight on the seam with dimmed
 *                grey on one side and white page on the other, and at that
 *                alpha a single indigo hairline had contrast against neither —
 *                so it read as the cut line rather than as an accent.
 *   1.5 – 4.5px  the indigo band, tinted toward 250 so it belongs to the
 *                primary ramp rather than sitting on it.
 *   4.5 – 5.5px  a faint outer hairline, so the band has an edge of its own
 *                and does not bleed into the dim.
 *   5.5 – ∞      the dim.
 */
const SPOT_EDGE = [
  '0 0 0 1.5px hsl(250 100% 99% / 0.62)',
  '0 0 0 4.5px hsl(var(--primary) / 0.62)',
  '0 0 0 5.5px hsl(250 100% 99% / 0.20)',
].join(', ');

/**
 * The dim, carried by its own element sitting on the EXACT anchor rect.
 *
 * Split away from the rim above, and the split is the fix for a real artifact.
 * The rim is drawn PAD outside the anchor so it does not sit on the element's
 * own edge — but when the dim rode along with it, the ring between the element
 * and the rim was left BRIGHT. Around a floating panel like the Setup guide
 * dock, that ring is not empty space: it is the dashboard behind the dock,
 * shown sharp and undimmed, and it reads as a stray card or toast wedged under
 * the one being highlighted.
 *
 * Dimming from the exact rect means everything that is not the anchor is dark,
 * and the rim floats over that instead of fencing off a bright margin.
 */
const SPOT_DIM = `0 0 0 9999px ${SCRIM}`;

/**
 * The lift — the reason this reads as presented rather than punched.
 *
 * A hole in a sheet and an object raised above one differ by exactly one thing:
 * the second casts a shadow. These paint over the dim and are clipped out of
 * the border box, so they darken the page around and below the anchor without
 * laying a single pixel on the anchor itself.
 *
 * The 30px indigo bloom is doing separate work from the drop shadows. It is
 * laid directly over the seam that cannot be feathered, spreading the visual
 * transition across 30px so the eye reads a gradient instead of a cut.
 */
const SPOT_LIFT = [
  '0 1px 3px -1px hsl(248 60% 4% / 0.40)',
  '0 0 30px 0 hsl(var(--primary) / 0.26)',
  '0 12px 26px -10px hsl(248 60% 4% / 0.45)',
  '0 34px 60px -24px hsl(248 60% 4% / 0.60)',
].join(', ');

/** Keep the spotlight this far off the viewport edge. */
const SPOT_EDGE_INSET = 6;

/**
 * Slack required between the card and the spotlight — see `clear()`.
 *
 * Large enough to absorb a one-render-stale card height and a dock that
 * resizes itself, small enough that it never pushes a placement that genuinely
 * fits into the centred fallback.
 */
const CLEAR_MARGIN = 10;

/**
 * The spotlight's box: the anchor, padded, clamped to the viewport.
 *
 * ONE function, FOUR consumers — the blur hole, the pane, the lift and the
 * card's placement. They must agree to the pixel or the rim slides off the blur
 * hole and shows a soft-edged sliver, so none of them may compute this again.
 *
 * The clamp is not cosmetic. Two live steps anchor full-width content, and
 * unclamped the padded rect runs past the right edge of the screen and 12px
 * into the 280px sidebar on the left — losing the treatment on exactly the
 * targets where the seam is longest and most visible.
 */
function spotlightBox(anchor: Rect, viewportW: number, viewportH: number, pad: number): Rect {
  const left = Math.max(SPOT_EDGE_INSET, anchor.left - pad);
  const top = Math.max(SPOT_EDGE_INSET, anchor.top - pad);
  const right = Math.min(viewportW - SPOT_EDGE_INSET, anchor.left + anchor.width + pad);
  const bottom = Math.min(viewportH - SPOT_EDGE_INSET, anchor.top + anchor.height + pad);
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * The whole viewport, minus a rounded hole over the highlighted element.
 *
 * `backdrop-filter` blurs everything under an element, and there is no way to
 * exempt a region of it — so the spotlight's cut-out has to be cut out of the
 * blur layer itself. `clip-path: path(evenodd, …)` does that in one property:
 * an outer rectangle covering the screen and an inner rounded rect, with the
 * even-odd fill rule leaving the inner one empty.
 *
 * Without this the highlighted control would be blurred along with everything
 * else — which is precisely backwards, since it is the one thing the step is
 * pointing at.
 */
function scrimHolePath(rect: Rect, radius: number, viewportW: number, viewportH: number): string {
  const { top: y, left: x, width: w, height: h } = rect;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const hole =
    `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} ` +
    `V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} ` +
    `H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} ` +
    `V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return `path(evenodd, "M0,0 H${viewportW} V${viewportH} H0 Z ${hole}")`;
}

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
  // `anchor` here is the SPOTLIGHT's box, not the raw element rect — it already
  // carries PAD and the viewport clamp. So GAP is measured from the edge the
  // operator can actually see, which is what the constant is supposed to mean.
  //
  // Previously this took the raw rect and offset by GAP, leaving only
  // GAP - PAD of real space: the card and the highlight read as touching, and
  // on the Payments step the card's corner sat directly against the rim.
  switch (placement) {
    case 'right':
      return { left: anchor.left + anchor.width + GAP, top: anchor.top };
    case 'left':
      return { left: anchor.left - GAP - cardW, top: anchor.top };
    case 'top':
      return { left: anchor.left + anchor.width / 2 - cardW / 2, top: anchor.top - GAP - cardH };
    default:
      return {
        left: anchor.left + anchor.width / 2 - cardW / 2,
        top: anchor.top + anchor.height + GAP,
      };
  }
}

/**
 * Where the card goes — or `null` if there is nowhere honest to put it.
 *
 * Returns only a placement that is BOTH fully on screen AND disjoint from the
 * spotlight. There is deliberately no fallback and no clamping: a returned
 * position is used verbatim.
 *
 * That is the whole point. The previous version chose a side, then clamped the
 * result into the viewport on both axes — and the clamp was what broke the
 * invariant. For a `right` placement on a wide anchor, `left` is
 * `spot.right + GAP`, and clamping it back to `viewportW - cardW - GAP` yields
 * a coordinate INSIDE the spotlight. Choosing well and then clamping undoes the
 * choice on the very next line, which is how the card ended up sitting in the
 * middle of the Brand Identity panel.
 *
 * So the check and the result are the same value. Two axis-aligned boxes are
 * disjoint if they are disjoint on either axis, and an accepted candidate is
 * disjoint by construction — nothing downstream may move it.
 *
 * `null` means "no side has room", and the caller degrades to the centred wash.
 * Refusing to place is the correct answer there; squeezing is what produced the
 * mess.
 */
function placeCard(
  spot: Rect,
  side: TourSide,
  cardW: number,
  cardH: number,
  viewportW: number,
  viewportH: number,
): { left: number; top: number } | null {
  const onScreen = (p: { left: number; top: number }) =>
    p.left >= GAP &&
    p.left + cardW <= viewportW - GAP &&
    p.top >= GAP &&
    p.top + cardH <= viewportH - GAP;

  /**
   * Clear of the spotlight, with room to spare.
   *
   * The margin is not padding — it is tolerance for the two ways the inputs go
   * stale between placement and paint:
   *
   *   1. `cardH` is measured from the rendered card, so on a step change the
   *      first render uses the PREVIOUS step's height. Underestimate it and a
   *      card placed above the spotlight extends past its top edge.
   *   2. Several anchors resize under their own steam. The Setup guide dock is
   *      `position: fixed` and expands and minimises; when it grows, the
   *      spotlight grows with it and can reach a card that was clear when it
   *      was placed.
   *
   * Exact adjacency — the old test — turns either of those into a visible
   * overlap, which is precisely what was happening on the Setup guide step.
   * Requiring a real gap means a few pixels of drift costs nothing.
   */
  const clear = (p: { left: number; top: number }) =>
    p.left + cardW + CLEAR_MARGIN <= spot.left ||
    p.left >= spot.left + spot.width + CLEAR_MARGIN ||
    p.top + cardH + CLEAR_MARGIN <= spot.top ||
    p.top >= spot.top + spot.height + CLEAR_MARGIN;

  for (const placement of placementsFor(side)) {
    const p = positionFor(placement, spot, cardW, cardH);
    if (onScreen(p) && clear(p)) return p;
  }
  return null;
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
  /** True when the anchor floats over the page — see `measure`. */
  const [elevated, setElevated] = useState(false);
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

    // Does this anchor FLOAT OVER the page, or sit in it?
    //
    // It decides how much room the spotlight leaves around it, and the two
    // cases genuinely want opposite things. A page heading is text on the page:
    // padding the hole reveals more of the same page, and without that room the
    // rim crops the words. A docked panel — `position: fixed`, its own surface,
    // its own shadow — has OTHER CONTENT behind it, so the same padding reveals
    // the dashboard underneath it, sharp and undimmed, and reads as a stray
    // card wedged under the highlighted one.
    //
    // Asking the element which it is costs one `getComputedStyle` per measure
    // and needs no per-step configuration, so a future step cannot forget it.
    const position = window.getComputedStyle(element).position;
    setElevated(position === 'fixed' || position === 'sticky');
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

  const hasAnchor = element !== null;
  if (hasAnchor && !rect) return null;

  const isLast = index === steps.length - 1;
  const isFirst = index === 0;
  const onDashboard = typeof window !== 'undefined' && window.location.pathname === '/';
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight;
  const isWelcome = step.id === 'welcome';

  // The spotlight's geometry, computed ONCE. The blur hole, the pane, the lift
  // and the card placement all read from this — recomputing it anywhere else is
  // how the rim and the blur hole drift apart.
  // Zero for a floating panel, PAD for anything sitting in the page.
  const pad = elevated ? 0 : PAD;
  const rawSpot = rect ? spotlightBox(rect, viewportW, viewportH, pad) : null;

  /**
   * Is this anchor too big to be worth pointing at?
   *
   * A spotlight is a gesture: "that one, there". It only carries meaning while
   * the thing it surrounds is smaller than the thing it excludes. Past roughly
   * two-thirds of the viewport there is nothing left to exclude — the rim runs
   * around the whole screen, the dim survives only as a strip down one side,
   * and the operator is being pointed at everything, which is to say nothing.
   *
   * This happened for real. The Booking-site step anchored to the whole Brand
   * Identity card, which is taller than the viewport: the rim enclosed the
   * screen, no card placement fitted, and the card was clamped down on top of
   * the highlight. It read, in the team lead's words, "like a dropdown".
   *
   * So past the threshold the step degrades to the treatment the Welcome and
   * Done steps already use — an even wash, no rim, card centred. That is honest
   * about what it can say, and it still works: the page is behind the wash,
   * legible enough to place, just not competing.
   *
   * Fixing the step's anchor is the better fix and is done separately. This is
   * the floor under every future step, so a badly chosen anchor degrades to
   * something calm instead of covering the screen.
   */
  const OVERSIZE = 0.66;
  const oversized =
    rawSpot !== null &&
    (rawSpot.width * rawSpot.height) / (viewportW * viewportH) > OVERSIZE;

  // The card's width in spotlight mode, needed BEFORE we know whether we are in
  // spotlight mode — placement feasibility is one of the things that decides it.
  const spotCardW = Math.min(CARD_WIDTH, viewportW - GAP * 2);

  // Where the card would go, if a spotlight is even viable. `null` means no side
  // has room for it without overlapping the highlight.
  const placement =
    hasAnchor && !oversized && rawSpot
      ? placeCard(rawSpot, step.side, spotCardW, cardH, viewportW, viewportH)
      : null;

  // Three ways to end up on the even wash, and they get identical treatment:
  // no anchor at all (Welcome, Done), an anchor too big to point at, or an
  // anchor with nowhere to stand the card. The last is what stops the tour ever
  // covering the thing it is describing.
  const centered = !hasAnchor || oversized || placement === null;
  const spot = centered ? null : rawSpot;

  const cardW = centered
    ? Math.min(isWelcome ? WELCOME_WIDTH : CENTERED_WIDTH, viewportW - GAP * 2)
    : spotCardW;

  // `placement` was already resolved above, and is used verbatim — see
  // `placeCard`. Nothing clamps it here: an accepted placement is on screen and
  // clear of the spotlight by construction, and re-clamping is exactly what
  // used to drop the card on top of the anchor.
  let left: number;
  let top: number;
  if (centered || !placement) {
    left = (viewportW - cardW) / 2;
    // Trax sits to the LEFT of the Welcome card now, not under it, so there is
    // no vertical overhang to make room for and the card centres normally.
    top = Math.max(GAP, viewportH * 0.4 - cardH / 2);
  } else {
    left = placement.left;
    top = placement.top;
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
        //
        <motion.div
          aria-hidden
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
          className="absolute inset-0"
          style={{
            background: SCRIM,
            backdropFilter: SCRIM_BLUR,
            WebkitBackdropFilter: SCRIM_BLUR,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <>
          {/* The blur that goes with the spotlight's dim.
              Separate from the ring below because `backdrop-filter` cannot be
              applied by a box-shadow: the shadow paints OVER the page, while
              the blur has to be an element that sits over it and filters what
              shows through. Clipped to everything-but-the-hole so the
              highlighted control stays sharp while the rest of the app softens.

              Rendered BEFORE the ring on purpose. A blur layer painted after it
              would filter the ring itself — the ring sits 2px outside the hole,
              so it falls in the blurred region — and the one element the step
              is pointing at would come out softer than the page around it.

              Not animated: framer cannot interpolate two `path()` strings, so
              this is a plain CSS transition instead. */}
          {spot && (
            <div
              aria-hidden
              className="absolute inset-0 transition-[clip-path] duration-200 ease-out"
              style={{
                backdropFilter: SCRIM_BLUR,
                WebkitBackdropFilter: SCRIM_BLUR,
                // The hole is the anchor, EXACTLY — no feather ring.
                //
                // It used to be cut BLUR_FEATHER (20px) further out, to keep
                // the blur's edge away from the dim's. But that ring was then
                // dimmed and NOT blurred, and around a floating panel like the
                // Setup guide dock the thing inside it is the dashboard behind
                // the dock, shown sharp. It read as a stray card wedged under
                // the highlighted one. Hugging the anchor means the only sharp
                // pixels on screen are the anchor's own.
                clipPath: scrimHolePath(spot, SPOT_RADIUS, viewportW, viewportH),
                pointerEvents: 'none',
              }}
            />
          )}
          {/* The pane — hard edges, the dim, and a breath of indigo inside.
              Nothing here is blurred, so this is the layer that stays
              pixel-locked to the geometry. No transform, ever: a fraction of a
              percent of scale would slide the rim off its own edge.

              The interior wash is small and load-bearing. The complaint was a
              "pale lavender-grey slab" — undisturbed page, framed by a razor.
              Framing it better does not fix that; the region has to stop being
              an absence of scrim and become a tinted surface. 5% is a fraction
              of a contrast step and it is the whole difference. */}
          <motion.div
            aria-hidden
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{
              opacity: 1,
              top: spot!.top,
              left: spot!.left,
              width: spot!.width,
              height: spot!.height,
            }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }
            }
            className="absolute bg-primary/[0.05] dark:bg-primary/[0.12]"
            style={{
              borderRadius: SPOT_RADIUS,
              // Rim and dim on ONE element, both keyed to the same box.
              // Splitting them put the rim `PAD` outside the dim's hole, which
              // left a bright margin between the two — fine in theory, and in
              // practice the page showing through around a floating panel. The
              // padding now lives in the box itself (`pad` above), so there is
              // no gap for anything to show through.
              boxShadow: `${SPOT_EDGE}, ${SPOT_DIM}`,
              pointerEvents: 'none',
            }}
          />
          {/* The lift. Rendered AFTER the pane so its shadows fall on the dim
              rather than under it, and after the blur so the bloom is not
              itself blurred. This layer carries the settle precisely because
              everything on it is feathered — half a percent of scale is nothing
              on a soft shadow and would have been a visible misalignment on the
              rim above. */}
          <motion.div
            aria-hidden
            initial={reduceMotion ? false : { opacity: 0, scale: 0.99 }}
            animate={{
              opacity: 1,
              scale: 1,
              top: spot!.top,
              left: spot!.left,
              width: spot!.width,
              height: spot!.height,
            }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38 }
            }
            className="absolute"
            style={{
              borderRadius: SPOT_RADIUS,
              boxShadow: SPOT_LIFT,
              pointerEvents: 'none',
            }}
          />
        </>
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
          className={cn(
            'absolute flex flex-col rounded-3xl bg-card text-card-foreground shadow-md outline-none ring-1 ring-foreground/10 dark:ring-foreground/15',
            isWelcome ? 'gap-5 p-7 sm:p-8' : 'gap-4 p-5',
          )}
          style={{ top, left, width: cardW, pointerEvents: 'auto' }}
        >
          {/* Header — who is talking, and where you are. No mark: a mascot was
              tried here and dropped, and a generic AI glyph in its place would
              say less than the name does. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-foreground/55">
              Trax
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
            <h2
              className={cn(
                'font-heading font-medium text-foreground',
                isWelcome
                  ? 'text-[28px] leading-[1.15] tracking-[-0.02em] sm:text-[32px]'
                  : 'text-lg leading-snug',
              )}
            >
              {step.title}
            </h2>
            <p
              className={cn(
                'leading-relaxed text-muted-foreground',
                isWelcome ? 'mt-1 text-[15px]' : 'text-[13px]',
              )}
            >
              {step.body}
            </p>
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
