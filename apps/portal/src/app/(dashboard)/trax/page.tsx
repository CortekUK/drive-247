"use client";

import { Minimize2 } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { SidebarTrigger } from "@/components/ui-v2/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { TraxThread } from "@/components/trax/trax-thread";
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
 * minimising back to the panel keeps it too. Neither surface calls `useChat()`
 * itself; doing so is what would fork the thread.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE HISTORY COMES FROM, AND WHAT IT CANNOT DO YET
 *
 * The edge function has always written every exchange to `chat_messages`;
 * `useTraxConversations` is the read. Two honest limits, both surfaced in the
 * rail rather than hidden: the list folds a bounded page of recent messages
 * client-side (PostgREST cannot GROUP BY, and a view would be a production
 * schema change), and there is no rename or delete, because both need endpoints
 * that do not exist and a delete that only cleared local state would be a lie.
 */
export default function TraxPage() {
  const { chat, history, minimiseToPanel } = useTrax();

  /* The stored title (the first question) once the list knows the thread; the
     first question on screen before it does — a new conversation only reaches
     the list after its first reply lands. Empty for a fresh thread. */
  const title =
    (chat.conversationId
      ? history.conversations.find((c) => c.conversationId === chat.conversationId)?.title
      : undefined) ??
    chat.messages.find((m) => m.role === "user")?.content ??
    "";

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

      <TraxThread density="page" autoFocus />
    </div>
  );
}
