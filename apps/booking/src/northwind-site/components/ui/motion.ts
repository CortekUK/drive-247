/**
 * The TRAX motion, for the Northwind design (Tailwind 4 + tw-animate-css). The
 * same standard as src/components/ui/motion.ts and the Trax panel in the portal:
 *
 *   IN   opacity 0 → 1 and rises 12px into place, 200ms ease-out
 *   OUT  the reverse — opacity 1 → 0 and sinks 12px, 200ms ease-in
 *
 * Transform and opacity only: no zoom, no rotate. Tailwind 4's translate
 * utilities use the `translate` property, which composes with the keyframe's
 * `transform`, so a centred dialog needs no special case here.
 *
 * Reduced motion switches the animation off (`!` because the state-scoped
 * `animate-in` utilities carry an attribute selector and would outrank it).
 *
 * These are class names: after changing any of them, re-run
 * `node scripts/build-northwind-css.mjs` so the committed stylesheet has them.
 */

/** Overlays and scrims: fade only. Also the base of a sheet, which adds its own edge. */
export const MOTION_FADE =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:animate-none!"

/** Dialogs and other panels: fade and rise 12px. */
export const MOTION_RISE =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-3 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-3 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:animate-none!"

/**
 * The 12px travel of anything anchored to a trigger: it comes from, and goes
 * back toward, the trigger — whichever side Radix actually resolved.
 */
const ANCHORED_TRAVEL =
  "data-[side=bottom]:slide-in-from-top-3 data-[side=top]:slide-in-from-bottom-3 data-[side=left]:slide-in-from-right-3 data-[side=right]:slide-in-from-left-3 data-[side=bottom]:slide-out-to-top-3 data-[side=top]:slide-out-to-bottom-3 data-[side=left]:slide-out-to-right-3 data-[side=right]:slide-out-to-left-3"

/** Popover, select. */
export const MOTION_ANCHORED = `${MOTION_FADE} ${ANCHORED_TRAVEL}`

/**
 * Tooltip. Radix opens it as `delayed-open` (animated) or `instant-open` (when
 * moving between tooltips — deliberately left instant), never `open`.
 */
export const MOTION_TOOLTIP = `data-[state=delayed-open]:animate-in fade-in-0 duration-200 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:animate-none! ${ANCHORED_TRAVEL}`
