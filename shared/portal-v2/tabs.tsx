"use client";

/**
 * The operator ui-v2 tabs (apps/portal/src/components/ui-v2/tabs.tsx), the
 * default horizontal pill only, in the shared `v2-*` colours (the class-map
 * twins of the operator's, checked by shared-v2-copies.test.ts). For the
 * shared agreement drawer's Details / Activity switch.
 */

import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "./cn";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation="horizontal"
      data-orientation="horizontal"
      className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
      {...props}
    />
  );
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant="default"
      className={cn(
        "group-data-[orientation=horizontal]/tabs:h-9 group/tabs-list inline-flex w-fit items-center justify-center rounded-full p-1 text-v2-muted-fg bg-v2-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 rounded-full border !border-transparent px-3 py-1 text-sm font-medium whitespace-nowrap text-v2-fg/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[orientation=vertical]/tabs:rounded-[var(--v2-radius-2xl,1rem)] group-data-[orientation=vertical]/tabs:px-3 group-data-[orientation=vertical]/tabs:py-1.5 hover:text-v2-fg focus-visible:border-v2-ring focus-visible:ring-[3px] focus-visible:ring-v2-ring/50 focus-visible:outline-1 focus-visible:outline-v2-ring disabled:pointer-events-none disabled:opacity-50 has-[[data-icon=inline-end]]:pr-2 has-[[data-icon=inline-start]]:pl-2 dark:text-v2-muted-fg dark:hover:text-v2-fg [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-[state=active]:bg-v2-bg data-[state=active]:text-v2-fg dark:data-[state=active]:border-v2-input dark:data-[state=active]:bg-v2-input/30 dark:data-[state=active]:text-v2-fg",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 text-sm outline-none", className)} {...props} />;
}
