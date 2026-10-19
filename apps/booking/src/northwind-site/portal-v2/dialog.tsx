'use client';

/**
 * The operator portal v2's dialog surface (apps/portal components/ui-v2/dialog.tsx)
 * for every customer portal v2 screen: a rounded-4xl card on a black/30 scrim
 * with a medium blur, a ghost close chip in the corner, the shared Trax rise.
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

export function PvDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay className="bg-black/30 backdrop-blur-md" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 rounded-4xl bg-pv-card p-6 text-sm text-pv-fg shadow-xl ring-1 ring-black/5 outline-none sm:max-w-md sm:p-7',
          MOTION_RISE,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className="absolute top-4 right-4 inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-pv-muted text-pv-muted-fg transition-colors duration-200 ease-out outline-none hover:bg-pv-tint hover:text-pv-fg focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
          >
            <X aria-hidden className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}
