"use client";

import { forwardRef, useState, type ComponentProps, type ReactNode } from "react";
import { Sparkles, MessageCircle, Inbox, ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
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

/**
 * Tooltip surface — deliberately not the default dark blob. It borrows the
 * dock's own card and hairline border so a label reads as part of the dock
 * rather than a system tooltip floating over it.
 */
const TIP =
  "gap-2 rounded-xl border border-border/70 bg-card px-3 py-1.5 text-[12px] text-foreground shadow-[-8px_0_24px_-14px_rgba(0,0,0,0.25)]";

function DockBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
      {count > 9 ? "9+" : count}
    </span>
  );
}

/**
 * A dock icon and its tooltip.
 *
 * forwardRef is load-bearing, not ceremony: two of these are handed to a
 * `<SheetTrigger asChild>`, which needs a ref on the real button to anchor and
 * toggle its sheet. Wrapping the *sheet component* in a TooltipTrigger instead
 * — as this dock first did — hands the ref to a plain function component,
 * where it lands nowhere and the tooltip never opens.
 *
 * The tooltip also spells out the count, because the badge caps at "9+" and
 * that is exactly when the real number is worth knowing.
 */
const DockButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    count?: number;
    /** What the count means here — "unread" for messages, "pending" for enquiries. */
    countLabel?: string;
    icon: ReactNode;
  } & ComponentProps<"button">
>(({ label, count = 0, countLabel = "unread", icon, ...props }, ref) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button ref={ref} type="button" aria-label={label} className={BTN} {...props}>
        {icon}
        <DockBadge count={count} />
      </button>
    </TooltipTrigger>
    <TooltipContent side="left" sideOffset={10} className={TIP}>
      <span className="font-medium">{label}</span>
      {count > 0 && (
        <span className="font-semibold text-primary">
          {count} {countLabel}
        </span>
      )}
    </TooltipContent>
  </Tooltip>
));
DockButton.displayName = "DockButton";

/**
 * Persistent quick-access dock pinned to the right edge. Sits at a low opacity
 * so it doesn't compete with content, and can be collapsed into a thin handle
 * that still surfaces the collective unread count.
 *
 * `onAskAI` is optional. On the branch this dock replaced the top header, so
 * the layout owned the single Trax instance and handed the opener down. Here
 * the v1 header stays (V2_PLAN §3 allows exactly one branch line in
 * `(dashboard)/layout.tsx`, and mounting Trax state is not it), so Trax is
 * still opened from its own header button and this slot simply does not render
 * unless a caller supplies an opener. Two entry points into two separate Trax
 * instances would mean two separate conversations, which is the bug the
 * branch's single-instance note was written about.
 *
 * Every count below comes from an existing tenant-scoped hook — all three
 * filter on `.eq('tenant_id', tenant.id)`. This component issues no query of
 * its own.
 */
export function QuickDock({ onAskAI }: { onAskAI?: () => void } = {}) {
  const [tucked, setTucked] = useState(false);
  const { unreadCount: chatUnread } = useUnreadCount();
  const { data: enquiryStats } = useEnquiryStats();
  const { unreadCount: notifUnread } = useNotifications();
  const enquiryPending = enquiryStats?.pending || 0;
  const collective = (chatUnread || 0) + enquiryPending + (notifUnread || 0);

  // Collapsed: a thin handle with a pull-out arrow + the collective count.
  if (tucked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setTucked(false)}
            aria-label="Show quick actions"
            className={`fixed right-0 top-1/2 z-40 flex -translate-y-1/2 cursor-pointer items-center justify-center px-1.5 py-2.5 text-muted-foreground transition-colors hover:text-foreground ${PANEL}`}
          >
            <ChevronLeft className="h-4 w-4" />
            {collective > 0 && (
              <span className="absolute -top-2 right-3 z-10 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white ring-2 ring-card">
                {collective > 9 ? "9+" : collective}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={10} className={TIP}>
          <span className="font-medium">Quick actions</span>
          {collective > 0 && (
            <span className="font-semibold text-primary">{collective} waiting</span>
          )}
        </TooltipContent>
      </Tooltip>
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
          <ChevronRight className="h-4 w-4 shrink-0" />
        </button>
        <div className="my-1.5 w-0 self-stretch bg-border/60 opacity-0 transition-all duration-200 group-hover:w-px group-hover:opacity-100" />

        <div className="flex flex-col items-center gap-0.5 p-1">
          {onAskAI && (
            <DockButton label="Ask AI" onClick={onAskAI} icon={<Sparkles className={ICON} />} />
          )}

          <MessagesSheet
            trigger={
              <DockButton
                label="Messages"
                count={chatUnread || 0}
                icon={<MessageCircle className={ICON} />}
              />
            }
          />

          <EnquiriesSheet
            trigger={
              <DockButton
                label="Enquiries"
                count={enquiryPending}
                countLabel="pending"
                icon={<Inbox className={ICON} />}
              />
            }
          />

          {/* The shared NotificationBell owns its own trigger button and popover
              and takes no props on this branch, so it is restyled in place to
              match the dock rather than re-implemented — a second copy of the
              mark-read / delete / navigate logic is the kind of duplicate that
              silently drifts. */}
          <div className="[&>button]:h-9 [&>button]:w-9 [&>button]:rounded-xl [&>button]:text-muted-foreground [&>button]:transition-all [&>button]:duration-200 [&>button:hover]:text-primary [&_svg]:h-[18px] [&_svg]:w-[18px]">
            <NotificationBell />
          </div>
        </div>
      </div>
    </div>
  );
}
