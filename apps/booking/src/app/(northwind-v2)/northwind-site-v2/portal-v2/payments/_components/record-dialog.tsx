'use client';

/**
 * The operator portal v2's dialog (`ui-v2/dialog.tsx`), for the customer
 * portal's record views — an invoice, an agreement.
 *
 * The surface (card, scrim, close chip, motion) is `PvDialogContent`, the one
 * copy every v2 screen shares; this adds the record layout on top: header,
 * scrolling body, a footer with the one action.
 *
 * Dialogs, not sheets: a record opened from a list is a dialog in v2.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';

import { Dialog } from '@nw/components/ui/dialog';
import { cn } from '@nw/lib/utils';
import { PvDialogContent } from '@nw/portal-v2/dialog';

export function RecordDialog({
  open,
  onOpenChange,
  title,
  description,
  status,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A line under the description — usually the status text and a date. */
  status?: React.ReactNode;
  children?: React.ReactNode;
  /** The one action, pinned under the body. */
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PvDialogContent
        className={cn('max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:p-0', className)}
      >
        <div className="flex flex-col gap-1.5 px-6 pt-6">
          <DialogPrimitive.Title className="text-[18px] font-semibold leading-snug tracking-[-0.01em] text-pv-fg">
            {title}
          </DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-sm text-pv-muted-fg">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>
          )}
          {status ? <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">{status}</div> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">{children}</div>

        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-pv-border px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </PvDialogContent>
    </Dialog>
  );
}

/** A label and an amount, one line. */
export function MoneyRow({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', className)}>
      <span className={cn('text-sm', strong ? 'font-semibold text-pv-fg' : 'text-pv-muted-fg')}>{label}</span>
      <span className={cn('tabular-nums', strong ? 'text-base font-semibold text-pv-fg' : 'text-sm font-medium text-pv-fg')}>
        {value}
      </span>
    </div>
  );
}
