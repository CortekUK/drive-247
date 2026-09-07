"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * The overview slot, as a card that turns over.
 *
 * One slot, two faces: the charts row (`rentals-overview.tsx`) on the front,
 * the filter panel (`rentals-filter-panel.tsx`) on the back. The filter button
 * inside the search field flips it; the panel's own ✕ — and Escape — flips it
 * back. The panel used to drop DOWN out of the search cell, which pushed the
 * whole table on every open and left the charts and the filters competing for
 * the same eye at the same time. They are alternatives, so they now occupy one
 * space and you only ever see one of them.
 *
 * Presentation only. No filter semantics live here: the page still owns the
 * open state, the filters object and the URL it serialises to.
 */

interface Props {
  /** Front face — the charts. */
  front: ReactNode;
  /** Back face — the filter panel. */
  back: ReactNode;
  /** True shows the back face. */
  flipped: boolean;
  /** Asked for the charts back (Escape). The panel's ✕ calls the page directly. */
  onFlipBack: () => void;
}

/**
 * The easing the rest of the v2 filter surface uses, held a good deal longer:
 * a 0.2s flip reads as a flicker rather than as one object turning over. Same
 * curve, so it still belongs to the same family of motion — and that curve
 * decelerates hard into place rather than stopping dead, which is what makes
 * the landing read as weight rather than as a cut.
 *
 * The HEIGHT animation below shares this exact object. That is not tidiness:
 * if the two ever drift apart, the card finishes turning while the box is
 * still resizing under it, which is the precise broken look this whole
 * component exists to avoid.
 */
const FLIP = { duration: 0.62, ease: [0.22, 1, 0.36, 1] as const };
/** Reduced motion: no rotation at all, just the swap — kept brisk. */
const FADE = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

export function RentalsOverviewFlip({ front, back, flipped, onFlipBack }: Props) {
  const reduceMotion = useReducedMotion();

  /**
   * HEIGHT IS THE WHOLE PROBLEM.
   *
   * The charts row and the filter panel are nothing like the same height, and a
   * flip between two different heights either clips the taller face or leaves a
   * hole under the shorter one — and if the height snaps at either end of the
   * rotation it stops reading as one object and starts reading as two.
   *
   * So both faces are measured and the container's height is animated to the
   * ACTIVE face's height on the same transition as the rotation: the two settle
   * together, at the same instant, on the same curve.
   *
   * `ResizeObserver` rather than a one-off measurement because neither face is
   * a fixed size — the panel grows when a date is picked or a section wraps,
   * and the charts row reflows at every breakpoint. A stale number here is a
   * clipped panel.
   *
   * The faces are laid out `items-start` (below) precisely so this measurement
   * can never feed back on itself: were they stretched to the row, an inactive
   * face would report the height we just set and the two would chase each other.
   */
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const [frontHeight, setFrontHeight] = useState<number | null>(null);
  const [backHeight, setBackHeight] = useState<number | null>(null);

  useEffect(() => {
    const watch = (el: HTMLDivElement | null, set: (h: number) => void) => {
      if (!el) return () => {};
      // `offsetHeight`, not `getBoundingClientRect()`: the back face carries a
      // 180° rotation and the rect would come back transformed.
      const read = () => set(el.offsetHeight);
      const ro = new ResizeObserver(read);
      ro.observe(el);
      read();
      return () => ro.disconnect();
    };
    const stopFront = watch(frontRef.current, setFrontHeight);
    const stopBack = watch(backRef.current, setBackHeight);
    return () => {
      stopFront();
      stopBack();
    };
  }, []);

  const target = flipped ? backHeight : frontHeight;

  /**
   * `inert` takes the hidden face out of the tab order, out of hit-testing and
   * out of the accessibility tree in one go — the fix for the classic flip-card
   * bug where Tab walks into the face you cannot see and focus vanishes off
   * screen. It is set as a DOM PROPERTY rather than a JSX attribute because
   * this app is on React 18, which does not know `inert`: `inert={true}` warns
   * and `inert=""` is dropped as falsy, so neither ever reaches the element.
   *
   * Applied here rather than only via the `visibility: hidden` below because
   * that lands only once the card has settled — this covers the frames in
   * between, when a Tab press would otherwise find the turning face.
   */
  useEffect(() => {
    const setInert = (el: HTMLElement | null, hidden: boolean) => {
      if (!el) return;
      (el as any).inert = hidden;
    };
    setInert(frontRef.current, flipped);
    setInert(backRef.current, !flipped);
  }, [flipped]);

  /**
   * Escape returns to the charts — the panel is a mode, and every mode needs a
   * keyboard way out.
   *
   * The guard is for the date pickers: a Radix popover mounts
   * `[data-radix-popper-content-wrapper]` while it is open and closes itself on
   * Escape, so without this one press would dismiss the calendar AND flip the
   * card, which is one undo too many.
   */
  useEffect(() => {
    if (!flipped) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      onFlipBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flipped, onFlipBack]);

  /**
   * Both faces have to be visible WHILE the card turns — you are looking at the
   * edge of one and the front of the other — but once it has settled the face
   * that is not showing goes `visibility: hidden`, which is the one thing every
   * browser agrees removes an element from the tab order.
   */
  const [settled, setSettled] = useState(true);
  const [lastFlipped, setLastFlipped] = useState(flipped);
  if (flipped !== lastFlipped) {
    setLastFlipped(flipped);
    setSettled(false);
  }

  // A backstop for `onAnimationComplete`, which does not fire when there is no
  // rotation to run — the reduced-motion path animates `rotateX` from 0 to 0,
  // and without this the outgoing face would sit there at `opacity: 0` but
  // still `visible`, leaning entirely on `inert` to stay out of the way. One
  // timer, only ever while unsettled.
  useEffect(() => {
    if (settled) return;
    const t = setTimeout(
      () => setSettled(true),
      (reduceMotion ? FADE : FLIP).duration * 1000 + 80
    );
    return () => clearTimeout(t);
  }, [settled, flipped, reduceMotion]);

  const faceBase = "col-start-1 row-start-1 w-full";
  const hiddenFace = (isHidden: boolean) =>
    `${isHidden ? "pointer-events-none " : ""}${isHidden && settled ? "invisible " : ""}`;

  return (
    // `perspective` belongs on the wrapper, never on the element that rotates:
    // it is the viewer's distance from the card, and set on the card itself it
    // would move with it.
    //
    // 1100px, not the 1600 a left-to-right flip wanted. The card turns around
    // its HORIZONTAL axis, so the dimension swinging through depth is the
    // slot's height (~220px) rather than its width (~1160px) — the same
    // perspective number that gave a Y-flip real depth leaves an X-flip almost
    // flat. Brought in until the turn reads as a card with a thickness to it,
    // and no further: shorter than this and the near edge fans out far enough
    // to be clipped at the slot's sides mid-turn.
    //
    // `overflow-hidden` keeps the turn inside the slot — both the taller face
    // during the frames in which the height is still catching up, and the near
    // edge's perspective fan — so it can never paint over the header above or
    // the table below.
    <motion.div
      className="relative overflow-hidden"
      style={{ perspective: 1100, height: target == null ? "auto" : undefined }}
      initial={false}
      animate={target == null ? undefined : { height: target }}
      transition={reduceMotion ? FADE : FLIP}
    >
      <motion.div
        className="grid h-full items-start"
        // `preserve-3d` is what makes the two faces sides of one card rather
        // than two flat layers; without it the back face never turns away and
        // `backface-visibility` has nothing to hide.
        //
        // The origin stays at the CENTRE of the box. A hinge at the top or
        // bottom edge would swing the whole card up over the page header or
        // down across the table — with the centre, every point that travels
        // forward is matched by one travelling back, so the turn stays in its
        // own slot. It is also why the perspective above has to be gentle:
        // origin and perspective are one decision on this axis.
        style={{ transformStyle: "preserve-3d", transformOrigin: "50% 50%" }}
        initial={false}
        // Top over bottom, not left over right.
        animate={{ rotateX: reduceMotion ? 0 : flipped ? 180 : 0 }}
        transition={reduceMotion ? FADE : FLIP}
        onAnimationComplete={() => setSettled(true)}
      >
        {/* Front — the charts. */}
        <motion.div
          ref={frontRef}
          className={`${faceBase} ${hiddenFace(flipped)}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
          initial={false}
          // Reduced motion has no rotation to hide the outgoing face, so it
          // cross-fades instead. With rotation, opacity stays at 1 and the
          // backface does the hiding — fading as well would look like two
          // things dissolving rather than one thing turning.
          animate={{ opacity: reduceMotion && flipped ? 0 : 1 }}
          transition={FADE}
          aria-hidden={flipped}
        >
          {front}
        </motion.div>

        {/* Back — the filter panel, pre-turned on the same axis so the parent's
            180° lands it the right way up rather than upside down. */}
        <motion.div
          ref={backRef}
          className={`${faceBase} ${hiddenFace(!flipped)}`}
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            // Reduced motion never rotates the card, so the back must sit the
            // right way round and simply fade in.
            transform: reduceMotion ? undefined : "rotateX(180deg)",
          }}
          initial={false}
          animate={{ opacity: reduceMotion && !flipped ? 0 : 1 }}
          transition={FADE}
          aria-hidden={!flipped}
        >
          {back}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
