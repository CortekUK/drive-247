"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui-v2/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-v2/tabs";
import { cn } from "@/lib/utils";
import "./timeline.css";

type ContextTab = { id: string; label: string; content: React.ReactNode; keepMounted?: boolean; scroll?: boolean; padded?: boolean };

/** Radix supplies tab navigation and focus handling. Messages mount only when opened. */
export function ContextTabs({ tabs, defaultValue, label }: { tabs: ContextTab[]; defaultValue: string; label: string }) {
  const [value, setValue] = useState(defaultValue);
  return <Tabs value={value} onValueChange={setValue} className="h-full min-h-0 min-w-0 gap-0">
    <TabsList aria-label={label} variant="line" className="tl-context-tabs">
      {tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>)}
    </TabsList>
    {tabs.map(tab => <TabsContent key={tab.id} value={tab.id} forceMount={tab.keepMounted ? true : undefined} className={cn("tl-context-body min-h-0", value !== tab.id && "!hidden", tab.padded === false && "tl-context-unpadded", tab.scroll === false ? "tl-context-pinned flex flex-col" : "overflow-y-auto")}>
      {tab.content}
    </TabsContent>)}
  </Tabs>;
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
