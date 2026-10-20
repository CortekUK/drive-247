"use client";

/**
 * The operator ui-v2 popover (apps/portal/src/components/ui-v2/popover.tsx),
 * only the parts the shared rentals timeline uses, in the shared `v2-*`
 * colours so it paints the same in both portals. Same classes otherwise (the
 * class-map twins of the operator's), checked by shared-v2-copies.test.ts.
 *
 * The content portals to <body>, outside the customer portal's `.pv2`; the
 * shell puts `.pv2-tokens` on <body> so the tokens still resolve there.
 */

import type { ComponentProps } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "./cn";
import { MOTION_FLOATING } from "./menu";

export function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex w-72 origin-[var(--radix-popover-content-transform-origin)] flex-col gap-4 rounded-[var(--v2-radius-3xl,1.5rem)] bg-v2-popover p-4 text-sm text-v2-popover-fg shadow-lg ring-1 ring-v2-fg/5 outline-none dark:ring-v2-fg/10",
          MOTION_FLOATING,
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
