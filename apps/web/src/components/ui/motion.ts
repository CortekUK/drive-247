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
 * build these strings dynamically. Built on `tw-animate-css` (Tailwind 4), where
 * `duration-*` / `ease-*` feed the animation through `--tw-duration` /
 * `--tw-ease`, and centring translates live on the separate `translate`
 * property, so the keyframes' `transform` composes with them cleanly.
 */

/** Scrims behind dialogs: fade only. */
export const MOTION_OVERLAY =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:animate-none!"

/** Dialogs and other content panels: fade plus the 12px lift. */
export const MOTION_CONTENT =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-3 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-3 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:animate-none!"

/**
 * Anything anchored to a trigger (select, popover, menu): the 12px travel comes
 * from, and returns to, the trigger's side.
 */
export const MOTION_FLOATING =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:animate-none! data-[side=bottom]:slide-in-from-top-3 data-[side=bottom]:slide-out-to-top-3 data-[side=top]:slide-in-from-bottom-3 data-[side=top]:slide-out-to-bottom-3 data-[side=left]:slide-in-from-right-3 data-[side=left]:slide-out-to-right-3 data-[side=right]:slide-in-from-left-3 data-[side=right]:slide-out-to-left-3"

/*
 * Something that simply mounts (a step, a notice, a panel swapped in) takes
 * the enter half of the standard inline — unmounting is instant, so there is
 * no exit half:
 *   animate-in fade-in-0 slide-in-from-bottom-3 duration-200 ease-out motion-reduce:animate-none
 */
