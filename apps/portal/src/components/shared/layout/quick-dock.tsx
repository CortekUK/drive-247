"use client";

import { forwardRef, useState, type ComponentProps, type ReactNode } from "react";
import { MessageCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui-v2/tooltip";
import { NotificationBell } from "@/components/shared/layout/notification-bell";
import { MessagesSheet } from "@/components/shared/layout/dock-sheets";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { useNotifications } from "@/hooks/use-notifications";
import { isNotificationCentreType } from "@/components/notifications/taxonomy";

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
 * that is exactly when the real number is worth knowing. It says "unread"
 * outright now: the label used to be a prop because Inquiries counted
 * "pending", and with that icon gone every remaining count means one thing.
 */
const DockButton = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    count?: number;
    icon: ReactNode;
  } & ComponentProps<"button">
>(({ label, count = 0, icon, ...props }, ref) => (
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
          {count} unread
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
 * TWO affordances: Messages · Notifications.
 *
 * It carried four. Ask AI and Inquiries were removed from the dock on request —
 * NEITHER FEATURE WAS DELETED. Trax still opens from the rental detail rail,
 * the vehicle overview rail and the setup guide, and /enquiries is still a page
 * in the sidebar. What went is this dock's shortcut to them, which is the only
 * thing that was asked for; ripping out the features behind two icons would
 * have taken working screens with it.
 *
 * The dock consequently no longer owns a Trax instance, so `onAskAI` is gone
 * too. The layout's own `<TraxAIDialog />` is untouched and remains the single
 * instance on screen — which was always the constraint here: two would mean two
 * `useChat()` states and two conversations that each forget what the other was
 * told.
 *
 * Both counts come from an existing tenant-scoped hook, each filtering on
 * `.eq('tenant_id', tenant.id)`. This component issues no query of its own.
 */
export function QuickDock() {
  const [tucked, setTucked] = useState(false);
  const { unreadCount: chatUnread } = useUnreadCount();
  const { notifications } = useNotifications();
  /* NOT the hook's raw unreadCount: that counts `chat_message` rows, which the
     Messages badge beside this one already counts. Adding both would show
     every unread chat twice in the collapsed handle. The notification centre
     excludes chat for the same reason — see taxonomy.ts. */
  const notifUnread = notifications.filter(
    (n) => !n.is_read && isNotificationCentreType(n.type),
  ).length;
  /* The collapsed handle's badge. It has to be the sum of exactly what the dock
     can still open, or a tucked dock advertises work that expanding it will not
     show. */
  const collective = (chatUnread || 0) + (notifUnread || 0);

  return (
    <>
      {tucked ? (
        // Collapsed: a thin handle with a pull-out arrow + the collective count.
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
      ) : (
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
              <MessagesSheet
                trigger={
                  <DockButton
                    label="Messages"
                    count={chatUnread || 0}
                    icon={<MessageCircle className={ICON} />}
                  />
                }
              />

              {/* The shared NotificationBell owns its own trigger button and
                  popover and takes no `trigger` prop here, so it is restyled in
                  place to match the dock rather than re-implemented — a second
                  copy of the mark-read / delete / navigate logic is the kind of
                  duplicate that silently drifts. It draws its own unread badge,
                  so the count still reads at a glance like the two above. */}
              <div className="[&>button]:relative [&>button]:h-9 [&>button]:w-9 [&>button]:rounded-xl [&>button]:text-muted-foreground [&>button]:transition-all [&>button]:duration-200 [&>button]:ease-out [&>button:hover]:-translate-x-1 [&>button:hover]:scale-110 [&>button:hover]:text-primary [&>button>svg]:h-[18px] [&>button>svg]:w-[18px]">
                <NotificationBell />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
