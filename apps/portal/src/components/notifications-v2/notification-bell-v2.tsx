"use client";

/**
 * The v2 bell — `components/shared/layout/notification-bell.tsx`, opening the
 * v2 panel instead of the v1 one. Mounted only by `TopBarV2`; the v1 header
 * keeps the original bell and panel for every other tenant.
 *
 * The root must stay a single <button>: TopBarV2 restyles it in place with
 * `[&>button]:…` selectors (BELL_FIX), and wrapping it un-styles it there.
 */

import { Bell } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { useNotificationCounts } from "@/hooks/use-notifications";
import { NotificationSheetV2 } from "@/components/notifications-v2/notification-sheet-v2";

export function NotificationBellV2() {
  const { data: counts } = useNotificationCounts();
  const unread = counts?.unread ?? 0;

  return (
    <NotificationSheetV2
      trigger={
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {/* Hidden at zero: an empty badge is a permanent small alarm. */}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      }
    />
  );
}
