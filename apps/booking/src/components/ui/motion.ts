/**
 * The TRAX motion — the one way anything appears and disappears on the booking
 * site and the customer portal (the same standard as the Trax panel in the
 * portal).
 *
 *   IN   opacity 0 → 1 and rises 12px into place, 200ms ease-out
 *   OUT  the reverse — opacity 1 → 0 and sinks 12px, 200ms ease-in
 *
 * Transform and opacity only: no zoom, no rotate. Reduced motion switches the
 * animation off entirely (`!` because the state-scoped `animate-in` utilities
 * carry an attribute selector and would otherwise outrank it; with the
 * animation gone Radix unmounts on close straight away).
 *
 * These live under src/components so Tailwind's content scan compiles them —
 * a class string in src/lib would be dropped from the stylesheet.
 */

/** Overlays and scrims: fade only. Also the base of a sheet, which adds its own edge. */
export const MOTION_FADE =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/**
 * A panel centred with translate(-50%, -50%) — dialogs, alert dialogs, the
 * lightbox. The keyframe replaces the element's transform while it runs, so
 * the centring is restated in the start/end point, 12px lower.
 */
export const MOTION_RISE_CENTERED =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:[--tw-enter-translate-y:calc(-50%_+_0.75rem)] data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:[--tw-exit-translate-y:calc(-50%_+_0.75rem)] data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/** A panel with no transform of its own: fade and rise 12px. */
export const MOTION_RISE =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-3 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-3 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/**
 * The 12px travel of anything anchored to a trigger (popover, dropdown,
 * select, tooltip): it comes from, and goes back toward, the trigger —
 * whichever side Radix actually resolved.
 */
const ANCHORED_TRAVEL =
  "data-[side=bottom]:slide-in-from-top-3 data-[side=top]:slide-in-from-bottom-3 data-[side=left]:slide-in-from-right-3 data-[side=right]:slide-in-from-left-3 data-[side=bottom]:slide-out-to-top-3 data-[side=top]:slide-out-to-bottom-3 data-[side=left]:slide-out-to-right-3 data-[side=right]:slide-out-to-left-3";

/** Popover, dropdown menu, select. */
export const MOTION_ANCHORED = `${MOTION_FADE} ${ANCHORED_TRAVEL}`;

/**
 * Tooltip. Radix opens it as `delayed-open` / `instant-open`, never `open`,
 * so the entrance runs on mount and only the exit is state-scoped.
 */
export const MOTION_TOOLTIP = `animate-in fade-in-0 duration-200 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none ${ANCHORED_TRAVEL}`;
