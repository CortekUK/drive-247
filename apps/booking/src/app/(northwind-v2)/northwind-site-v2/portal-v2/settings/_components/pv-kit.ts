/**
 * Class recipes for the customer portal's forms and dialogs.
 *
 * BUTTONS ARE THE OPERATOR'S, EXACTLY (owner, Oct 21 2026: "fix it against the
 * admin portal's button"). Each one is a shared ui-v2 Button string from
 * shared/portal-v2/button-styles.ts — the 2rem pill, 36px default / 32px
 * small, 14px medium text, primary hovering to primary/80, outline and ghost
 * hovering with the light purple tint — which the operator test suite
 * recomputes from the operator Button itself, so the two cannot drift.
 * They ride on the site's `Button` with `variant="ghost"`; tailwind-merge lets
 * these classes win over that variant's own.
 */

import {
  V2_BUTTON_DEFAULT,
  V2_BUTTON_DEFAULT_SM,
  V2_BUTTON_DESTRUCTIVE,
  V2_BUTTON_GHOST,
  V2_BUTTON_GHOST_ICON_SM,
  V2_BUTTON_GHOST_SM,
  V2_BUTTON_OUTLINE,
  V2_BUTTON_OUTLINE_SM,
} from '@portal-v2-shared/button-styles';

export const PV_BUTTON = V2_BUTTON_DEFAULT;
export const PV_BUTTON_OUTLINE = V2_BUTTON_OUTLINE;
export const PV_BUTTON_GHOST = V2_BUTTON_GHOST;
export const PV_BUTTON_DANGER = V2_BUTTON_DESTRUCTIVE;

export const PV_BUTTON_SM = V2_BUTTON_DEFAULT_SM;
export const PV_BUTTON_OUTLINE_SM = V2_BUTTON_OUTLINE_SM;
export const PV_BUTTON_GHOST_SM = V2_BUTTON_GHOST_SM;

/** A round icon-only button — the operator's `size="icon-sm"` ghost. */
export const PV_ICON_BUTTON = V2_BUTTON_GHOST_ICON_SM;

/**
 * The v2 field: no rim at rest, a soft grey fill (`bg-input/50` there), and a
 * primary ring on focus. 44px tall, 14px text — a size up from the operator's.
 */
export const PV_INPUT =
  'h-11 w-full rounded-3xl border border-transparent bg-pv-muted px-4 text-[14px] text-pv-fg shadow-none ' +
  'placeholder:text-pv-muted-fg/70 selection:bg-pv-primary selection:text-pv-primary-fg ' +
  'transition-[color,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none ' +
  'focus-visible:border-pv-primary/40 focus-visible:ring-3 focus-visible:ring-pv-primary/20 ' +
  'aria-[invalid=true]:border-pv-danger aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-pv-danger/15';

/** `data-[size=default]:h-11` out-specifies the trigger's own `h-9`; see field-primitives. */
export const PV_SELECT_TRIGGER =
  `${PV_INPUT} data-[size=default]:h-11 justify-between data-[placeholder]:text-pv-muted-fg/70`;

export const PV_SELECT_ITEM = 'rounded-xl text-[14px] text-pv-fg focus:bg-pv-muted focus:text-pv-fg';

export const PV_DIALOG_TITLE = 'text-[17px] font-semibold tracking-tight text-pv-fg';
export const PV_DIALOG_DESCRIPTION = 'text-[14px] leading-relaxed text-pv-muted-fg';
