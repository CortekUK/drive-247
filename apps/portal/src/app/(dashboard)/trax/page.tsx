"use client";

import { Minimize2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { SidebarTrigger } from "@/components/ui-v2/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { TraxSupportThread } from "@/components/trax/support/TraxSupportThread";
import { useTraxSupportChat } from "@/components/trax/support/trax-support-context";
import { useTrax } from "@/components/trax/trax-provider";

/**
 * Trax, full screen — laid out the way Claude lays out its own.
 *
 * The page is ONE centred conversation column and nothing else. The list of
 * conversations is not drawn here: on this route the app sidebar becomes the
 * Trax rail (components/trax/trax-rail.tsx, swapped in by `AppSidebarV2` the
 * same way it becomes the Settings rail), with Back at the top, so the
 * conversations take the navigation's place instead of squeezing in beside it.
 * The dashboard layout also drops the global top bar here, for the same reason.
 *
 * No rules and no panels: the header is transparent and set apart by space, and
 * the thread floats on the layout's one app gradient.
 *
 * ---------------------------------------------------------------------------
 * THE CONVERSATION SURVIVES THE TRIP HERE
 *
 * This page and the docked panel render the SAME thread, because `TraxProvider`
 * is mounted in the dashboard layout — above the route — and Next keeps a layout
 * mounted across navigations inside its own group. So "full screen" from the
 * panel continues the conversation rather than starting a second one, and
 * minimising back to the panel keeps it too. Neither surface calls
 * `useTraxSupport()` itself; doing so is what would fork the thread.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE HISTORY COMES FROM
 *
 * The conversation is the TRAX support conversation (TraxSupportProvider). The
 * rail lists stored support conversations when support storage is enabled and
 * reopens one through the server, which re-checks access first.
 */
export default function TraxPage() {
  const { minimiseToPanel } = useTrax();
  const support = useTraxSupportChat();

  /* The conversation's first question, as its title. Empty for a fresh thread. */
  const title = support.messages.find((m) => m.role === "user")?.content ?? "";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* 64px, the rail's back row, so the two line up across the screen. */}
      <header className="flex h-16 shrink-0 items-center gap-2 px-3 sm:px-4">
        {/* Below `md` the rail is an off-canvas sheet; this is its opener. */}
        <SidebarTrigger className="md:hidden" aria-label="Open conversations" />

        <p className="min-w-0 truncate text-[13px] text-muted-foreground" title={title || undefined}>
          {title}
        </p>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={minimiseToPanel}
              aria-label="Open as side panel"
              className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Minimize2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open as side panel · ⌘J</TooltipContent>
        </Tooltip>
      </header>

      <TraxSupportThread density="page" autoFocus />
    </div>
  );
}
