/**
 * The portal's ONE enter/exit motion — the "Trax motion", taken from the Trax
 * panel (`components/trax/trax-panel.tsx`):
 *
 *   in:  opacity 0 → 1 while rising 12px into place, 200ms ease-out
 *   out: the reverse, sinking 12px,                  200ms ease-in
 *
 * Transform + opacity only — no zoom, no rotate — and nothing moves under
 * `prefers-reduced-motion`. Every primitive (ui + ui-v2) and hand-built panel
 * takes its enter/exit from here, so the timing lives in one place.
 *
 * The strings below drive `tailwindcss-animate`. Its `duration-*` / `ease-*`
 * set animation-duration / animation-timing-function, and they are gated on
 * the same `data-[state=*]` as `animate-in` / `animate-out` on purpose:
 * `animate-in` resets the duration to the 150ms default, and a variant rule
 * always outranks an ungated `duration-200`.
 *
 * Reduced motion uses `!animate-none`: the `data-[state=*]` rules carry an
 * attribute selector and would out-specify a plain `motion-reduce:` class.
 */

/** Scrims / overlays, and any surface that should only fade. */
export const MOTION_FADE =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/**
 * A dialog centred with `-translate-x-1/2 -translate-y-1/2`. The keyframe's
 * transform replaces that centring while it runs, so the offsets carry it:
 * x stays at -50%, y starts at -50% + 12px and rises into place.
 */
export const MOTION_DIALOG =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-bottom-[calc(-50%_+_0.75rem)] data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-bottom-[calc(-50%_+_0.75rem)] data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/** A surface that is NOT translate-centred (a hand-built panel, a toast). */
export const MOTION_RISE =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-3 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-3 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/**
 * Popovers, menus, selects, hover cards, tooltips. Same fade + 12px, but the
 * offset starts on the trigger's side (Radix's `data-side`) so the panel
 * moves away from what opened it. The enter is ungated because tooltips open
 * as `delayed-open` / `instant-open`, not `open`; `closed` then overrides it.
 */
export const MOTION_FLOATING =
  "animate-in fade-in-0 duration-200 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in data-[side=bottom]:slide-in-from-top-3 data-[side=bottom]:slide-out-to-top-3 data-[side=top]:slide-in-from-bottom-3 data-[side=top]:slide-out-to-bottom-3 data-[side=left]:slide-in-from-right-3 data-[side=left]:slide-out-to-right-3 data-[side=right]:slide-in-from-left-3 data-[side=right]:slide-out-to-left-3 motion-reduce:!animate-none";

/**
 * For a mount-time entrance with no `data-state` (a banner, a list row, a
 * conditionally rendered panel). Enter only — pair with `motion-reduce`.
 */
export const MOTION_ENTER =
  "animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none";

/** Mount-time fade only — a hand-built scrim, a badge. */
export const MOTION_FADE_ENTER =
  "animate-in fade-in-0 duration-200 ease-out motion-reduce:animate-none";

/** Mount-time entrance for a hand-built, translate-centred dialog. */
export const MOTION_DIALOG_ENTER =
  "animate-in fade-in-0 slide-in-from-left-1/2 slide-in-from-bottom-[calc(-50%_+_0.75rem)] duration-200 ease-out motion-reduce:animate-none";

/** CSS-transition form, for elements toggled by class rather than mounted. */
export const MOTION_SHOWN =
  "visible translate-y-0 opacity-100 [transition:transform_200ms_ease-out,opacity_200ms_ease-out] motion-reduce:transition-none";
export const MOTION_HIDDEN =
  "invisible translate-y-3 opacity-0 [transition:transform_200ms_ease-in,opacity_200ms_ease-in,visibility_0s_linear_200ms] motion-reduce:transition-none";

/** motion/react equivalents. */
export const MOTION_OFFSET = 12;
export const MOTION_IN = { duration: 0.2, ease: "easeOut" } as const;
export const MOTION_OUT = { duration: 0.2, ease: "easeIn" } as const;

/**
 * Ready-made motion/react props: `<motion.div {...motionRise(reduce)} />`,
 * where `reduce` comes from `useReducedMotion()`.
 */
export function motionRise(reduce: boolean | null | undefined) {
  const y = reduce ? 0 : MOTION_OFFSET;
  return {
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0, transition: reduce ? { duration: 0 } : MOTION_IN },
    exit: { opacity: 0, y, transition: reduce ? { duration: 0 } : MOTION_OUT },
  };
}
