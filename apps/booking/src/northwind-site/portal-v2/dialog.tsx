'use client';

/**
 * The operator portal v2's dialog surface for every customer portal v2 screen,
 * in the operator's Integrations standard (integrations-board.tsx, Stripe and
 * the rest): the page wash as the dialog's background — brand-derived radial
 * layers, so it follows the tenant's colour and dark mode — the status
 * top-left, then the title.
 *
 * No illustration and no Close control (owner, Oct 23 2026): the status takes
 * the illustration's place, and Esc or a click outside closes.
 *
 *   <PvDialogContent className="sm:max-w-xl">
 *     <PvDialogHeader title="Cards" description="…" status={<PvStatus tone="success">Active</PvStatus>} />
 *     …
 *   </PvDialogContent>
 *
 * The ONE copy. Built from the booking app's exported dialog parts plus Radix's
 * Content, because the shared `components/ui/dialog` carries the booking flow's
 * tinted scrim and 18px card and is used by the v1 site.
 */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react-nw';

import { DialogOverlay, DialogPortal } from '@nw/components/ui/dialog';
import { MOTION_RISE } from '@nw/components/ui/motion';
import { cn } from '@nw/lib/utils';

/** integrations-board.tsx SCREEN_LED_WASH, on the customer portal's tokens. */
export const PV_DIALOG_WASH = [
  'radial-gradient(40rem 26rem at 105% -10%, color-mix(in srgb, var(--pv-wash) 30%, transparent), transparent 62%)',
  'radial-gradient(34rem 24rem at -8% -6%, color-mix(in srgb, var(--pv-chart-3) 24%, transparent), transparent 58%)',
  'radial-gradient(36rem 22rem at 50% 118%, color-mix(in srgb, var(--pv-wash) 20%, transparent), transparent 62%)',
  'linear-gradient(180deg, color-mix(in srgb, var(--pv-wash) 8%, transparent) 0%, transparent 45%)',
].join(', ');

export function PvDialogContent({
  className,
  children,
  style,
  showCloseButton = true,
  variant = 'portal',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * 'portal' (default): the customer portal's dialog — the wash, no close
   * control. 'site': the public booking site's (quick book, fleet, time clock,
   * the booking payment panel) — plain card and the round × chip, as before.
   */
  variant?: 'portal' | 'site';
}) {
  const portal = variant === 'portal';
  return (
    <DialogPortal>
      <DialogOverlay className="bg-black/30 backdrop-blur-md" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        style={portal ? { backgroundImage: PV_DIALOG_WASH, ...style } : style}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 rounded-4xl bg-pv-card p-6 text-sm text-pv-fg shadow-xl ring-1 ring-black/5 outline-none',
          portal ? 'sm:max-w-lg sm:p-8' : 'sm:max-w-md sm:p-7',
          MOTION_RISE,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && !portal ? (
          <DialogPrimitive.Close className="absolute top-4 right-4 inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-pv-muted text-pv-muted-fg transition-colors duration-200 ease-out outline-none hover:bg-pv-tint hover:text-pv-fg focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none">
            <X aria-hidden className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/** The "Close" pill: a word in the corner. Only the invoice sheet's phone layout still uses it. */
export const PV_DIALOG_CLOSE =
  'absolute top-5 right-5 inline-flex h-7 cursor-pointer items-center rounded-full border border-pv-border bg-pv-card/70 px-3 text-[12px] font-medium text-pv-fg/80 backdrop-blur-sm ' +
  'transition-colors duration-200 ease-out outline-none hover:bg-pv-card hover:text-pv-fg focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none';

type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const STATUS_TONE: Record<StatusTone, string> = {
  success: 'border-pv-success/30 bg-pv-success/10 text-pv-success',
  warning: 'border-pv-warning/30 bg-pv-warning/10 text-pv-warning',
  danger: 'border-pv-danger/30 bg-pv-danger/10 text-pv-danger',
  info: 'border-pv-primary/30 bg-pv-primary/10 text-pv-primary',
  neutral: 'border-pv-border bg-pv-card/60 text-pv-muted-fg',
};

const DOT: Record<StatusTone, string> = {
  success: 'bg-pv-success',
  warning: 'bg-pv-warning',
  danger: 'bg-pv-danger',
  info: 'bg-pv-primary',
  neutral: 'bg-pv-muted-fg/50',
};

/** The operator's dialog status pill (integrations _kit.tsx StatusChip): a dot and a word. */
export function PvStatus({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 min-w-[4.5rem] items-center justify-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium leading-none',
        STATUS_TONE[tone],
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}

/**
 * The header every dialog opens on: the status top-left (when there is one),
 * then the title and one muted line. The wash is always there.
 */
export function PvDialogHeader({
  title,
  description,
  status,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  status?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {status ? <div className="flex h-7 items-center">{status}</div> : null}
      <div>
        <DialogPrimitive.Title className="font-heading text-xl font-semibold tracking-tight text-pv-fg">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-sm text-pv-muted-fg">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}
