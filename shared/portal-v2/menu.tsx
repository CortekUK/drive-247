"use client";

/**
 * The operator ui-v2 dropdown (apps/portal/src/components/ui-v2/dropdown-menu.tsx),
 * only the parts the shared hero chart uses, in the shared `v2-*` colours so it
 * paints the same in both portals. Same classes otherwise: a translucent
 * popover over a blur, a 24px radius, light-purple highlight, check on the
 * chosen item, and the same floating motion (lib/motion.ts MOTION_FLOATING).
 *
 * The content portals to <body>, outside the customer portal's `.pv2`; the
 * shell puts `.pv2-tokens` on <body> so the tokens still resolve there.
 */

import type { ComponentProps } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "./cn";

const MOTION_FLOATING =
  "animate-in fade-in-0 duration-200 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200 data-[state=closed]:ease-in data-[side=bottom]:slide-in-from-top-3 data-[side=bottom]:slide-out-to-top-3 data-[side=top]:slide-in-from-bottom-3 data-[side=top]:slide-out-to-bottom-3 data-[side=left]:slide-in-from-right-3 data-[side=left]:slide-out-to-right-3 data-[side=right]:slide-in-from-left-3 data-[side=right]:slide-out-to-left-3 motion-reduce:!animate-none";

export const DropdownMenu = DropdownMenuPrimitive.Root;

export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        data-tone="dark"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "bg-v2-popover/70 z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-[var(--radix-dropdown-menu-trigger-width)] min-w-48 origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-x-hidden overflow-y-auto rounded-3xl p-1.5 text-v2-popover-fg shadow-lg ring-1 ring-v2-fg/5 data-[state=closed]:overflow-hidden dark:ring-v2-fg/10 relative before:pointer-events-none before:absolute before:inset-0 before:-z-[1] before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 [&_[data-slot$=-item][data-highlighted]]:bg-v2-hover",
          MOTION_FLOATING,
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuRadioGroup(props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2.5 rounded-2xl py-2 pr-8 pl-3 text-sm font-medium outline-none select-none focus:bg-v2-hover focus:text-v2-accent-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}
