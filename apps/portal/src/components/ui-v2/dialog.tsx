import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"
import { MOTION_DIALOG, MOTION_FADE } from "@/lib/motion"
import { Button } from "@/components/ui-v2/button"
import { X } from "lucide-react"

/**
 * Pass in a DialogContent's className to make it a whole screen on a phone
 * (boss, Nov 2026: panels open full view). Below `sm` it fills the viewport,
 * square, no ring, a column with the safe areas kept clear, and it fades in
 * rather than sliding from the centre. From `sm` up it stays a centred dialog.
 * The content inside decides what scrolls (give the body `max-sm:flex-1
 * max-sm:min-h-0 max-sm:overflow-y-auto`).
 */
const PHONE_SCREEN_DIALOG =
  "max-sm:inset-0 max-sm:flex max-sm:h-dvh max-sm:w-full max-sm:max-h-none max-sm:max-w-none " +
  "max-sm:translate-x-0 max-sm:translate-y-0 max-sm:flex-col max-sm:overflow-hidden max-sm:rounded-none max-sm:shadow-none max-sm:ring-0 " +
  "max-sm:pt-[env(safe-area-inset-top,0px)] max-sm:pb-[env(safe-area-inset-bottom,0px)] " +
  "max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-bottom-0 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-bottom-0 " +
  "max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // `blur-md`, not `blur-sm`. The portal behind a dialog is dense —
        // tables, stat cards, a full sidebar — and at `sm` all of it stayed
        // legible, so the page kept reading as noise around the dialog rather
        // than receding behind it. This is v2-only: `components/ui/dialog.tsx`
        // is a separate file on its own Radix primitives, so v1 tenants are
        // untouched by this.
        "fixed inset-0 isolate z-50 bg-black/30 supports-[backdrop-filter]:backdrop-blur-md",
        MOTION_FADE,
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      {/*
        The Trax motion (`MOTION_DIALOG`, lib/motion.ts): fade + 12px rise.
        Its offsets also carry the `-translate-x-1/2 -translate-y-1/2` centring,
        which the keyframe's transform replaces while it runs.
      */}
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 rounded-4xl bg-popover p-6 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/5 outline-none sm:max-w-md dark:ring-foreground/10",
          MOTION_DIALOG,
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-4 right-4 bg-secondary"
              size="icon-sm"
            >
              <X
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground [&>a]:underline [&>a]:underline-offset-[3px] [&>a:hover]:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  PHONE_SCREEN_DIALOG,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
