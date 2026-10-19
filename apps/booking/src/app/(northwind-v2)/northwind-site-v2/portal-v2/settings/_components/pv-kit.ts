/**
 * Class recipes for Messages, Notifications and Settings — the operator portal
 * v2's controls (`apps/portal/src/components/ui-v2/*`) redrawn on the `--pv-*`
 * tokens, one step roomier because a customer visits now and then rather than
 * all day.
 *
 * WHY STRINGS AND NOT VARIANTS. These ride on `variant="ghost"` with the full
 * recipe spelled out, so the size steps (44px on a phone, 40/36px from md) and
 * the danger fill live in one place. They draw the same pill and the same
 * `--pv-hover` tint that `styles/site.css` gives the shared `brand*` variants.
 *
 * Hover and focus follow V2_PLAN §12: 200ms, ease-out, colour fade only, and
 * nothing moves for someone who asked their OS for less motion.
 */

const MOTION = 'transition-colors duration-200 ease-out motion-reduce:transition-none';

const BUTTON_BASE =
  `rounded-full font-medium shadow-none ${MOTION} ` +
  'focus-visible:border-transparent focus-visible:ring-3 focus-visible:ring-pv-primary/25 ' +
  'disabled:opacity-50';

/** 44px on a phone (touch floor), 40px from md up — the operator's `lg`. */
const SIZE = 'h-11 gap-2 px-5 text-[14px] md:h-10 md:px-4';
const SIZE_SM = 'h-11 gap-1.5 px-4 text-[13px] md:h-9 md:px-3.5';

export const PV_BUTTON = `${BUTTON_BASE} ${SIZE} bg-pv-primary text-pv-primary-fg hover:bg-pv-primary-hover hover:text-pv-primary-fg`;
export const PV_BUTTON_OUTLINE = `${BUTTON_BASE} ${SIZE} border border-pv-border bg-pv-card text-pv-fg hover:bg-pv-hover hover:text-pv-fg`;
export const PV_BUTTON_GHOST = `${BUTTON_BASE} ${SIZE} text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg`;
export const PV_BUTTON_DANGER = `${BUTTON_BASE} ${SIZE} bg-pv-danger-light text-pv-danger hover:bg-pv-danger/15 hover:text-pv-danger`;

export const PV_BUTTON_SM = `${BUTTON_BASE} ${SIZE_SM} bg-pv-primary text-pv-primary-fg hover:bg-pv-primary-hover hover:text-pv-primary-fg`;
export const PV_BUTTON_OUTLINE_SM = `${BUTTON_BASE} ${SIZE_SM} border border-pv-border bg-pv-card text-pv-fg hover:bg-pv-hover hover:text-pv-fg`;
export const PV_BUTTON_GHOST_SM = `${BUTTON_BASE} ${SIZE_SM} text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg`;

/** A round icon-only button — the operator's `size="icon"` ghost. */
export const PV_ICON_BUTTON =
  `${BUTTON_BASE} size-11 p-0 text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg md:size-9`;

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
