"use client";

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui-v2/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { cn } from "@/lib/utils";
import "./timeline.css";

/**
 * `icon` is for the dock, not for this strip.
 *
 * Below the width where this column fits, each of these tabs becomes its own
 * icon on the record's dock — asked for Sep 24 2026, because one dock button
 * that opened a sheet with a tab strip inside it made every context view two
 * taps away and hid their names behind the first one. The list lives here so
 * the strip and the dock cannot end up offering different tabs.
 */
export type ContextTab = {
  id: string;
  label: string;
  content: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** With `iconsOnly`: this tab keeps its word beside its icon. */
  showLabel?: boolean;
  keepMounted?: boolean;
  scroll?: boolean;
  padded?: boolean;
};

/**
 * Radix supplies tab navigation and focus handling. Messages mount only when opened.
 *
 * `iconsOnly` (the rental rail, Oct 2 2026): each tab is its icon, named by a
 * tooltip and an accessible label, so five views fit one row at 360px. Off by
 * default — the customer and vehicle rails keep their words.
 */
export function ContextTabs({ tabs, defaultValue, label, iconsOnly = false }: { tabs: ContextTab[]; defaultValue: string; label: string; iconsOnly?: boolean }) {
  const [held, setValue] = useState(defaultValue);
  /* A held id that no longer names a tab (a tab renamed or removed under a
     live page) falls back to the default instead of rendering an empty body. */
  const value = tabs.some(t => t.id === held) ? held : defaultValue;
  return <Tabs value={value} onValueChange={setValue} className="h-full min-h-0 min-w-0 gap-0">
    {iconsOnly
      ? <IconStrip tabs={tabs} value={value} label={label} />
      : <TabsList aria-label={label} variant="line" className="tl-context-tabs">
          {tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>)}
        </TabsList>}
    {tabs.map(tab => <TabsContent key={tab.id} value={tab.id} forceMount={tab.keepMounted ? true : undefined} className={cn("tl-context-body min-h-0", value !== tab.id && "!hidden", tab.padded === false && "tl-context-unpadded", tab.scroll === false ? "tl-context-pinned flex flex-col" : "overflow-y-auto")}>
      {tab.content}
    </TabsContent>)}
  </Tabs>;
}

/**
 * The `iconsOnly` strip (the rental rail, Oct 2 2026): rectangular tabs, end
 * to end, no rule underneath. A `showLabel` tab is as wide as its icon and
 * word; the icon-only tabs share the rest of the row and say their name on
 * hover. The selection is ONE accent-tinted block that slides and resizes to
 * the chosen tab (200ms ease-out, the app's motion) rather than jumping.
 *
 * Built on the Radix primitive directly, not ui-v2's TabsTrigger: the block
 * measures each tab and the tooltip anchors to it, and both need the ref that
 * the ui-v2 function-component trigger does not forward.
 */
function IconStrip({ tabs, value, label }: { tabs: ContextTab[]; value: string; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  const index = Math.max(0, tabs.findIndex(t => t.id === value));
  useLayoutEffect(() => {
    const measure = () => {
      const el = refs.current[index];
      if (el) setBox({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    refs.current.forEach(el => el && ro.observe(el));
    return () => ro.disconnect();
  }, [index, tabs.length]);

  return <TabsPrimitive.List aria-label={label} className="relative flex min-h-[44px] w-full shrink-0 items-center gap-0.5 px-2">
    {box && <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 h-[34px] -translate-y-1/2 rounded-[7px] bg-primary/[0.08] [transition:transform_200ms_ease-out,width_200ms_ease-out] motion-reduce:transition-none dark:bg-[hsl(var(--v2-link,var(--primary))/0.12)]" style={{ width: box.w, transform: `translate(${box.x}px, -50%)` }} />}
    {tabs.map((tab, i) => {
      const active = tab.id === value;
      const Icon = tab.icon;
      const labelled = tab.showLabel || !Icon;
      const trigger = <TabsPrimitive.Trigger
        value={tab.id}
        ref={el => { refs.current[i] = el; }}
        aria-label={labelled ? undefined : tab.label}
        className={cn(
          "relative z-10 flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-[7px] text-[13px] whitespace-nowrap outline-none transition-colors duration-200 motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring/50",
          labelled ? "shrink-0 px-3" : "min-w-0 flex-1",
          active
            ? "font-[550] text-[hsl(var(--v2-link,var(--primary)))] dark:text-[hsl(var(--sidebar-primary))]"
            : "text-muted-foreground hover:text-foreground",
          active && !box && "bg-primary/[0.08]",
        )}
      >
        {Icon && <Icon className="size-[18px]" />}
        {labelled && tab.label}
      </TabsPrimitive.Trigger>;
      return labelled
        ? <span key={tab.id} className="contents">{trigger}</span>
        : <Tooltip key={tab.id}><TooltipTrigger asChild>{trigger}</TooltipTrigger><TooltipContent side="bottom">{tab.label}</TooltipContent></Tooltip>;
    })}
  </TabsPrimitive.List>;
}

/** The same right-hand tabs remain reachable below the existing desktop breakpoint. */
export function ResponsiveContextRail({ children, label, breakpoint = 1280, width = 360 }: { children: React.ReactNode; label: string; breakpoint?: number; width?: number }) {
  const [open, setOpen] = useState(false);
  const media = `(min-width: ${breakpoint}px)`;
  const subscribe = useCallback((listener: () => void) => {
    const query = window.matchMedia(media);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [media]);
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(media).matches, () => false);
  if (wide) return <aside className="flex min-h-0 shrink-0 flex-col border-l border-foreground/10" style={{ width }} aria-label={label}>{children}</aside>;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="fixed bottom-5 right-5 z-30 shadow-md" size="sm"><CalendarDays size={15} />{label}</Button></DialogTrigger>
    <DialogContent className="tl-dialog flex h-[min(820px,92svh)] w-[calc(100vw-1.5rem)] flex-col gap-3 rounded-2xl p-0 sm:max-w-[440px]">
      <DialogHeader className="px-4 pt-5 pr-10"><DialogTitle>{label}</DialogTitle><DialogDescription>Context for the selected record.</DialogDescription></DialogHeader>
      <div className="min-h-0 flex-1">{children}</div>
    </DialogContent>
  </Dialog>;
}
