"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Modal (create / confirm) — centred, radius 24, spring scale-in, blurred scrim.
 * Spec: DESIGN_SYSTEM.md §7 (Modal) + ANIMATION.md §3. Built on shadcn Dialog
 * (Radix) so focus trap / Esc / a11y come for free. Use for create + confirm forms.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("gap-0 rounded-[24px] p-0", className)}
      >
        {(title || description) && (
          <DialogHeader className="space-y-1 p-6 pb-2 text-left">
            {title && (
              <DialogTitle className="text-lg font-bold tracking-tight">
                {title}
              </DialogTitle>
            )}
            {description && (
              <DialogDescription className="text-sm text-muted-foreground">
                {description}
              </DialogDescription>
            )}
          </DialogHeader>
        )}
        <div className="p-6 pt-2">{children}</div>
        {footer && (
          <DialogFooter className="border-t border-border p-4">{footer}</DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
