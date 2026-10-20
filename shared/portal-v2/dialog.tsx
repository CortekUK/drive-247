"use client";

/**
 * The operator ui-v2 dialog (apps/portal/src/components/ui-v2/dialog.tsx), the
 * parts the shared agreement drawer uses, in the shared `v2-*` colours so it
 * paints the same in both portals. Same classes otherwise (the class-map twins
 * of the operator's), checked by shared-v2-copies.test.ts: a 30% black scrim
 * with a medium blur, the 2rem-radius panel with a 5% hairline, the Trax
 * motion, and the ghost close button in the top right corner.
 *
 * The content portals to <body>, outside the customer portal's `.pv2`; the
 * shell puts `.pv2-tokens` on <body> so the tokens still resolve there.
 */

import type { ComponentProps } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./timeline/button";

/** lib/motion.ts MOTION_FADE. */
const MOTION_FADE =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

/** lib/motion.ts MOTION_DIALOG: fade and a 12px rise, carrying the centring offsets. */
const MOTION_DIALOG =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-bottom-[calc(-50%_+_0.75rem)] data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-bottom-[calc(-50%_+_0.75rem)] data-[state=closed]:duration-200 data-[state=closed]:ease-in motion-reduce:!animate-none";

export function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn("fixed inset-0 isolate z-50 bg-black/30 supports-[backdrop-filter]:backdrop-blur-md", MOTION_FADE)}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-[var(--v2-radius-4xl,2rem)] bg-v2-popover p-6 text-sm text-v2-popover-fg shadow-xl ring-1 ring-v2-fg/5 outline-none sm:max-w-md dark:ring-v2-fg/10",
          MOTION_DIALOG,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-4 right-4 bg-[hsl(var(--v2-secondary,var(--secondary)))]">
              <X />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-v2-muted-fg [&>a]:underline [&>a]:underline-offset-[3px] [&>a:hover]:text-v2-fg", className)}
      {...props}
    />
  );
}
