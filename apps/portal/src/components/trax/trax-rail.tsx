"use client";

import { useMemo, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { ArrowLeft, RotateCw, SquarePen, X } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui-v2/sidebar";
import { Button } from "@/components/ui-v2/button";
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import type { TraxConversationSummary } from "@/hooks/use-trax-conversations";
import { cn } from "@/lib/utils";
import { TraxMark } from "./trax-greeting";
import { useTrax } from "./trax-provider";

/**
 * The Trax conversation rail — what the app sidebar BECOMES on `/trax`.
 *
 * The same move the sidebar already makes for Settings and for the customer,
 * vehicle and rental records (see `AppSidebarV2`): a full-screen destination
 * gets a scoped rail in the sidebar's own slot rather than a second column
 * beside it. This is also exactly how Claude's full page is laid out — the
 * conversation list replaces the navigation, with a way back at the top — so
 * the page itself is free to be one centred conversation column.
 *
 * Built from the Settings/customer rail anatomy (h-16 back row, title block,
 * scrolling body, footer slot, icon-only collapsed state) so all five rails
 * read as one piece of furniture. What it does NOT copy is their dividers:
 * no `border-t` between groups, no `h-px` rule. Groups are separated by space
 * and a quiet label, and the sidebar is transparent, so the layout's one app
 * gradient runs behind it uninterrupted.
 *
 * Back is a button, not a link: it goes to wherever the operator came from
 * (`returnPath`, tracked by the provider), which no static href can know.
 */

type Bucket = "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older";
const BUCKET_ORDER: Bucket[] = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

/** Calendar-day buckets in local time. Day starts are built with the Date
 *  constructor rather than by subtracting 86_400_000, so a DST change inside
 *  the window cannot move a conversation into the wrong group. */
function bucketOf(iso: string, now: Date): Bucket {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "Older";
  const dayStart = (daysAgo: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo).getTime();
  if (ts >= dayStart(0)) return "Today";
  if (ts >= dayStart(1)) return "Yesterday";
  if (ts >= dayStart(7)) return "Previous 7 days";
  if (ts >= dayStart(30)) return "Previous 30 days";
  return "Older";
}

function groupByRecency(conversations: TraxConversationSummary[]) {
  const now = new Date();
  const groups = new Map<Bucket, TraxConversationSummary[]>();
  for (const c of conversations) {
    const b = bucketOf(c.lastActivityAt, now);
    const list = groups.get(b);
    if (list) list.push(c);
    else groups.set(b, [c]);
  }
  return BUCKET_ORDER.filter((b) => groups.has(b)).map((label) => ({
    label,
    items: groups.get(label)!,
  }));
}

const SECTION_LABEL =
  "px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60";

export function TraxRail() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { chat, history, openConversation, startNewConversation, leaveFullPage } = useTrax();

  /* On a phone the rail is an off-canvas sheet at full width, so the desktop
     collapsed state must not squeeze it down to icons. */
  const collapsed = state === "collapsed" && !isMobile;

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  /* The list query is `enabled`-gated and `history` does not expose its fetch
     state, so Retry reads it from the cache directly — otherwise a retry of an
     errored query shows the old error, unchanged, until it lands. */
  const refetching = useIsFetching({ queryKey: ["trax-conversations"] }) > 0;

  const groups = useMemo(() => groupByRecency(history.conversations), [history.conversations]);

  /* While a reply is in flight, the thread must not change underneath it:
     `useChat` appends the answer to whatever messages are on screen when it
     lands, so switching now would graft this reply onto another conversation
     (and a brand-new one would adopt the wrong conversation id). */
  const busy = chat.isLoading;
  const canStartNew = chat.messages.length > 0 && !busy;

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const onBack = () => {
    closeMobile();
    leaveFullPage();
  };

  const onNew = () => {
    setOpenError(null);
    startNewConversation();
    closeMobile();
  };

  const onOpen = async (conversationId: string) => {
    if (conversationId === chat.conversationId) {
      closeMobile();
      return;
    }
    if (openingId || busy) return;
    setOpeningId(conversationId);
    setOpenError(null);
    try {
      await openConversation(conversationId);
      closeMobile();
    } catch (err) {
      /* `openConversation` rethrows the read's {error}. Caught here, or a
         failed read is an unhandled rejection and a click that did nothing. */
      setOpenError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Sidebar collapsible="icon" className="transition-all duration-300 ease-in-out">
      <SidebarHeader className="h-16">
        <div className="flex h-full w-full items-center px-2 transition-all duration-300 ease-in-out">
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onBack}
                  aria-label="Back"
                  className="flex h-8 w-full items-center justify-center rounded-md transition-colors hover:bg-muted/50"
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Back</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={onBack}
              className="flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="text-[13px]">Back</span>
            </button>
          )}
        </div>
      </SidebarHeader>

      {!collapsed && (
        <div className="flex items-center gap-2.5 px-4 pb-1 pt-2">
          <TraxMark size="sm" animated={false} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">Trax</h2>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Your conversations</p>
          </div>
        </div>
      )}

      {/* New conversation sits OUTSIDE the scrolling list, so it is always one
          click away however long the history gets. */}
      <SidebarGroup className={collapsed ? "p-1.5" : "p-1.5 pb-0 pt-3"}>
        <SidebarMenu>
          <SidebarMenuItem>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    onClick={onNew}
                    disabled={!canStartNew}
                    aria-label="New conversation"
                    className="h-8"
                  >
                    <SquarePen className="h-4 w-4 shrink-0" />
                  </SidebarMenuButton>
                </TooltipTrigger>
                <TooltipContent side="right">New conversation</TooltipContent>
              </Tooltip>
            ) : (
              <SidebarMenuButton onClick={onNew} disabled={!canStartNew} className="h-8 gap-2.5">
                <SquarePen className="h-4 w-4 shrink-0" />
                <span className="text-[13px]">New conversation</span>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <SidebarContent className="gap-0 pb-2">
        {!collapsed && (
          <>
            {openError && (
              <div role="alert" className="mx-3 mt-3 flex items-start gap-2 text-[12px]">
                <div className="min-w-0 flex-1">
                  <p className="text-destructive">Couldn&apos;t open that conversation.</p>
                  <p className="mt-0.5 break-words text-muted-foreground">{openError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenError(null)}
                  aria-label="Dismiss"
                  className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {history.isLoading ? (
              <div className="px-1.5" aria-busy="true" aria-label="Loading conversations">
                <p className={SECTION_LABEL}>Conversations</p>
                <div className="flex flex-col gap-1.5 pt-1">
                  {[72, 88, 64, 80, 56].map((w) => (
                    <Skeleton key={w} className="mx-1.5 h-7 rounded-lg bg-muted/80" style={{ width: `${w}%` }} />
                  ))}
                </div>
              </div>
            ) : history.error ? (
              /* Shown, not swallowed: supabase-js resolves with {error} rather
                 than throwing, so a failed read that fell through to the empty
                 copy would read as "you have no conversations" — data loss. */
              <div className="px-1.5">
                <p className={SECTION_LABEL}>Conversations</p>
                <div role="alert" className="px-2.5 pt-1 text-[12px]">
                  <p className="text-destructive">Couldn&apos;t load past conversations.</p>
                  <p className="mt-0.5 break-words text-muted-foreground">{history.error}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={history.refresh}
                    disabled={refetching}
                    className="-ml-2 mt-1.5 h-7 gap-1.5 px-2 text-[12px]"
                  >
                    <RotateCw className={cn("size-3.5", refetching && "animate-spin motion-reduce:animate-none")} />
                    {refetching ? "Retrying…" : "Retry"}
                  </Button>
                </div>
              </div>
            ) : groups.length === 0 ? (
              <div className="px-1.5">
                <p className={SECTION_LABEL}>Conversations</p>
                <p className="px-2.5 pt-1 text-[12px] leading-relaxed text-muted-foreground">
                  Past conversations appear here once you&apos;ve asked something.
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <SidebarGroup key={group.label} className="p-1.5 pb-0">
                  <p className={SECTION_LABEL}>{group.label}</p>
                  <SidebarMenu>
                    {group.items.map((c) => {
                      const active = c.conversationId === chat.conversationId;
                      const opening = openingId === c.conversationId;
                      return (
                        <SidebarMenuItem key={c.conversationId}>
                          <SidebarMenuButton
                            isActive={active}
                            onClick={() => void onOpen(c.conversationId)}
                            disabled={!active && busy}
                            aria-current={active ? "true" : undefined}
                            aria-busy={opening || undefined}
                            title={c.title}
                            className={cn("h-8", opening && "animate-pulse motion-reduce:animate-none")}
                          >
                            <span className="truncate text-[13px]">{c.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroup>
              ))
            )}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="px-4 pb-4 pt-2">
        {!collapsed && history.conversations.length > 0 && (
          <p className="text-[11px] leading-snug text-muted-foreground/80">
            Showing conversations from your most recent {history.scanLimit} messages.
          </p>
        )}
      </SidebarFooter>

      {/* The edge handle stays (click to collapse, like every other rail) but
          without the hairline it draws on hover — no lines anywhere in Trax. */}
      <SidebarRail className="after:hidden" />
    </Sidebar>
  );
}
