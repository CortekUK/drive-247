"use client";

import { useState } from "react";
import { Sparkle, ChatCircleDots, Tray, Bell, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/shared/layout/notification-bell";
import { MessagesSheet, EnquiriesSheet } from "@/components/shared/layout/dock-sheets";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useEnquiryStats } from "@/hooks/use-enquiry-stats";
import { useNotifications } from "@/hooks/use-notifications";

const BTN =
  "relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 ease-out hover:-translate-x-1 hover:scale-110 hover:text-primary";
const ICON = "h-[18px] w-[18px]";
const PANEL =
  "rounded-l-2xl border border-r-0 border-border/70 bg-card shadow-[-6px_0_20px_-12px_rgba(0,0,0,0.18)]";

function DockBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

/**
 * Persistent quick-access dock pinned to the right edge. Sits at a low opacity
 * so it doesn't compete with content, and can be collapsed into a thin handle
 * that still surfaces the collective unread count.
 */
export function QuickDock({ onAskAI }: { onAskAI: () => void }) {
  const [tucked, setTucked] = useState(false);
  const { unreadCount: chatUnread } = useUnreadCount();
  const { data: enquiryStats } = useEnquiryStats();
  const { unreadCount: notifUnread } = useNotifications();
  const enquiryPending = enquiryStats?.pending || 0;
  const collective = (chatUnread || 0) + enquiryPending + (notifUnread || 0);

  // Collapsed: a thin handle with a pull-out arrow + the collective count.
  if (tucked) {
    return (
      <button
        onClick={() => setTucked(false)}
        aria-label="Show quick actions"
        className={`fixed right-0 top-1/2 z-40 flex -translate-y-1/2 cursor-pointer items-center justify-center px-1.5 py-2.5 text-muted-foreground transition-colors hover:text-foreground ${PANEL}`}
      >
        <CaretLeft className="h-4 w-4" />
        {collective > 0 && (
          <span className="absolute -top-2 right-3 z-10 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white ring-2 ring-card">
            {collective > 9 ? "9+" : collective}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="group fixed right-0 top-1/2 z-40 -translate-y-1/2">
      <div className={`flex items-stretch overflow-hidden ${PANEL}`}>
        {/* Collapse handle — integrated left strip, revealed on hover */}
        <button
          onClick={() => setTucked(true)}
          aria-label="Collapse"
          className="flex w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden text-muted-foreground opacity-0 transition-all duration-200 ease-out hover:bg-accent hover:text-foreground group-hover:w-7 group-hover:opacity-100"
        >
          <CaretRight className="h-4 w-4 shrink-0" />
        </button>
        <div className="my-1.5 w-0 self-stretch bg-border/60 opacity-0 transition-all duration-200 group-hover:w-px group-hover:opacity-100" />

        <div className="flex flex-col items-center gap-0.5 p-1">
          {/* Ask AI */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={onAskAI} className={BTN} aria-label="Ask AI">
                <Sparkle className={ICON} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Ask AI</TooltipContent>
          </Tooltip>

          {/* Messages */}
          <Tooltip>
            <TooltipTrigger asChild>
              <MessagesSheet
                trigger={
                  <button className={BTN} aria-label="Messages">
                    <ChatCircleDots className={ICON} />
                    <DockBadge count={chatUnread || 0} />
                  </button>
                }
              />
            </TooltipTrigger>
            <TooltipContent side="left">Messages</TooltipContent>
          </Tooltip>

          {/* Enquiries */}
          <Tooltip>
            <TooltipTrigger asChild>
              <EnquiriesSheet
                trigger={
                  <button className={BTN} aria-label="Enquiries">
                    <Tray className={ICON} />
                    <DockBadge count={enquiryPending} />
                  </button>
                }
              />
            </TooltipTrigger>
            <TooltipContent side="left">Enquiries</TooltipContent>
          </Tooltip>

          {/* Notifications */}
          <Tooltip>
            <TooltipTrigger asChild>
              <NotificationBell
                trigger={(unread) => (
                  <button className={BTN} aria-label="Notifications">
                    <Bell className={ICON} />
                    <DockBadge count={unread} />
                  </button>
                )}
              />
            </TooltipTrigger>
            <TooltipContent side="left">Notifications</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
