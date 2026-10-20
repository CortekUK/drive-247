"use client";

/**
 * The operator ui-v2 tooltip (apps/portal/src/components/ui-v2/tooltip.tsx),
 * in the shared `v2-*` colours, for the shared rentals timeline. Same classes
 * otherwise (the class-map twins of the operator's), checked by
 * shared-v2-copies.test.ts.
 */

import type { ComponentProps } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "./cn";
import { MOTION_FLOATING } from "./menu";

export function TooltipProvider({ delayDuration = 0, ...props }: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />;
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({ className, sideOffset = 0, children, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-[var(--radix-tooltip-content-transform-origin)] items-center gap-1.5 rounded-[var(--v2-radius-xl,0.75rem)] bg-v2-fg/75 px-3 py-1.5 text-xs text-v2-bg has-[[data-slot=kbd]]:pr-1.5 [&_[data-slot=kbd]]:relative [&_[data-slot=kbd]]:isolate [&_[data-slot=kbd]]:z-50 [&_[data-slot=kbd]]:rounded-[var(--v2-radius,var(--radius))]",
          MOTION_FLOATING,
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
