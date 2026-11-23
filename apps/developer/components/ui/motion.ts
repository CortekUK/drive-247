/**
 * TRAX motion — the one enter/exit standard for everything that appears and
 * disappears. It mirrors the portal's Trax panel
 * (`apps/portal/src/components/trax/trax-panel.tsx`):
 *
 *   IN   opacity 0 → 1 and a 12px rise into place, 200ms ease-out
 *   OUT  the reverse — opacity 1 → 0 and a 12px sink, 200ms ease-in
 *
 * Transform and opacity only: no zoom, no rotate. Reduced motion switches the
 * animation off entirely (`!` because the `data-[state]` variants that start it
 * out-rank a bare media-query utility).
 *
 * Every class is written out in full so Tailwind's scanner sees it — never
 * build these strings dynamically. Built on `tailwindcss-animate` (Tailwind 3).
 */

/** Scrims behind dialogs and sheets: fade only. */
export const MOTION_OVERLAY =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/**
 * Centred dialogs. The content is centred with a -50%/-50% transform, and the
 * keyframes animate `transform`, so the start/end offsets carry the centring
 * too: x holds at -50%, y travels from (-50% + 12px) to -50%.
 */
export const MOTION_DIALOG =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-bottom-[calc(12px_-_50%)] data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-bottom-[calc(12px_-_50%)] data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/**
 * Sheets: the fade and timing only — each side adds its own edge slide, so a
 * sheet still enters from the edge it lives on.
 */
export const MOTION_SHEET =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/** The 12px travel for anything anchored to a trigger: it comes from, and returns to, the trigger's side. */
const FLOATING_SIDES =
  "data-[side=bottom]:slide-in-from-top-3 data-[side=bottom]:slide-out-to-top-3 data-[side=top]:slide-in-from-bottom-3 data-[side=top]:slide-out-to-bottom-3 data-[side=left]:slide-in-from-right-3 data-[side=left]:slide-out-to-right-3 data-[side=right]:slide-in-from-left-3 data-[side=right]:slide-out-to-left-3";

/** Popover, dropdown menu (and sub-menus), select — Radix `data-state="open" | "closed"`. */
export const MOTION_FLOATING =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none " +
  FLOATING_SIDES;

/**
 * Tooltip. Radix marks an open tooltip `delayed-open` / `instant-open`, never
 * `open`, so the enter half is unconditional and `closed` overrides it.
 */
export const MOTION_TOOLTIP =
  "animate-in fade-in-0 duration-200 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:ease-in motion-reduce:!animate-none " +
  FLOATING_SIDES;
