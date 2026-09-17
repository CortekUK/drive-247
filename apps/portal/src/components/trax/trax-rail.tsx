"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, SquarePen, X } from "lucide-react";
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
import { Skeleton } from "@/components/ui-v2/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { useTraxSupportChat } from "./support/trax-support-context";
import { cn } from "@/lib/utils";
import { SIDEBAR_HIGHLIGHT_FOCUS, SIDEBAR_HIGHLIGHT_HOVER } from "@/components/ui-v2/sidebar";
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

function groupByRecency<T extends { lastActivityAt: string }>(conversations: T[]) {
  const now = new Date();
  const groups = new Map<Bucket, T[]>();
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
  const { leaveFullPage } = useTrax();
  /* The TRAX support conversation and its stored conversations (support storage). */
  const support = useTraxSupportChat();

  /* On a phone the rail is an off-canvas sheet at full width, so the desktop
     collapsed state must not squeeze it down to icons. */
  const collapsed = state === "collapsed" && !isMobile;

  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  /* The stored conversation reopened from this rail, so it is marked and not reloaded. */
  const [activeId, setActiveId] = useState<string | null>(null);

  const recent = support.recentConversations;
  const groups = useMemo(() => groupByRecency(recent ?? []), [recent]);

  /* While a reply is in flight the thread must not change underneath it. */
  const busy = support.isLoading;
  const canStartNew = support.messages.length > 0 && !busy;

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const onBack = () => {
    closeMobile();
    leaveFullPage();
  };

  const onNew = () => {
    setOpenError(null);
    setActiveId(null);
    support.clearChat();
    closeMobile();
  };

  /* Resuming re-checks access on the server and restores that conversation. */
  const onOpen = async (id: string) => {
    if (id === activeId) {
      closeMobile();
      return;
    }
    if (openingId || busy || !support.supportRequest) return;
    setOpeningId(id);
    setOpenError(null);
    try {
      const result = await support.supportRequest("resume", { resumeId: id });
      if (result) {
        setActiveId(id);
        closeMobile();
      }
      else setOpenError("The conversation could not be opened. Check your access and try again.");
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
                  className={cn("flex h-8 w-full items-center justify-center rounded-md transition-colors", SIDEBAR_HIGHLIGHT_HOVER, SIDEBAR_HIGHLIGHT_FOCUS)}
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
              className={cn("flex h-8 items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors", SIDEBAR_HIGHLIGHT_HOVER, SIDEBAR_HIGHLIGHT_FOCUS)}
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

            {!recent && !busy && support.error ? (
              /* Shown, not swallowed: a failed access check must not read as "no conversations". */
              <div className="px-1.5">
                <p className={SECTION_LABEL}>Conversations</p>
                <p role="alert" className="break-words px-2.5 pt-1 text-[12px] text-destructive">{support.error}</p>
              </div>
            ) : !recent && busy ? (
              <div className="px-1.5" aria-busy="true" aria-label="Loading conversations">
                <p className={SECTION_LABEL}>Conversations</p>
                <div className="flex flex-col gap-1.5 pt-1">
                  {[72, 88, 64, 80, 56].map((w) => (
                    <Skeleton key={w} className="mx-1.5 h-7 rounded-lg bg-muted/80" style={{ width: `${w}%` }} />
                  ))}
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
                      const opening = openingId === c.id;
                      return (
                        <SidebarMenuItem key={c.id}>
                          <SidebarMenuButton
                            isActive={c.id === activeId}
                            aria-current={c.id === activeId ? "true" : undefined}
                            onClick={() => void onOpen(c.id)}
                            disabled={c.id !== activeId && busy}
                            aria-busy={opening || undefined}
                            title={c.summary}
                            className={cn("h-8", opening && "animate-pulse motion-reduce:animate-none")}
                          >
                            <span className="truncate text-[13px]">{c.summary}</span>
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
        {!collapsed && !!recent?.length && (
          <p className="text-[11px] leading-snug text-muted-foreground/80">
            Opening a conversation re-checks your access first.
          </p>
        )}
      </SidebarFooter>

      {/* The edge handle stays (click to collapse, like every other rail) but
          without the hairline it draws on hover — no lines anywhere in Trax. */}
      <SidebarRail className="after:hidden" />
    </Sidebar>
  );
}
