"use client";

import * as React from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Side sheet (detail) — slides in from the right over a blurred scrim, with a
 * sticky action bar at the bottom. Spec: DESIGN_SYSTEM.md §7 (Side sheet) +
 * ANIMATION.md §3 (overlays). Built on shadcn Sheet (Radix) for a11y/focus-trap.
 * Use for record details opened from a table row.
 */
export function SideSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
  width = "430px",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  width?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        style={{ maxWidth: width, width: "100%" }}
        className={cn("flex flex-col gap-0 p-0", className)}
      >
        {(title || description) && (
          <SheetHeader className="space-y-1 border-b border-border p-5 text-left">
            {title && (
              <SheetTitle className="text-lg font-bold tracking-tight">
                {title}
              </SheetTitle>
            )}
            {description && (
              <SheetDescription className="text-sm text-muted-foreground">
                {description}
              </SheetDescription>
            )}
          </SheetHeader>
        )}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-5">{children}</div>
        {footer && (
          <div className="sticky bottom-0 border-t border-border bg-card p-4">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
