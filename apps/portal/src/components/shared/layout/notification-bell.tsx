"use client";

/**
 * The bell: a trigger and a count. Nothing else.
 *
 * ── what this file used to be ───────────────────────────────────────────────
 *
 * 232 lines: a Popover, two tabs (General and Messages), row markup, mark-read
 * and delete buttons, and two empty states. All of that now lives in
 * `components/notifications/notification-sheet.tsx`, for two reasons.
 *
 * A popover was the wrong container. It is anchored to its trigger, so its
 * width came from where the bell happened to sit, it had no fixed header, and
 * it overlapped page content. The panel is a right-side Sheet — the same
 * primitive `dock-sheets.tsx` already uses — with a backdrop, a fixed header
 * and its own scroll region.
 *
 * And MESSAGES WERE NEVER NOTIFICATIONS. The Messages tab counted the same
 * thing the dock's own Messages badge counted, and put the answer in two
 * places. `chat_message` is excluded from the centre entirely now.
 *
 * ── the count comes from the database, not from a loaded page ───────────────
 *
 * This used to count the rows `useNotifications()` happened to have in memory —
 * which was the newest 50, capped. A tenant with 65 notifications and 20 unread
 * older ones showed a badge that was simply wrong, and no amount of opening the
 * panel corrected it.
 *
 * `useNotificationCounts()` asks the database for an exact count over the same
 * filter the panel lists by (chat excluded, tenant and audience scoped), so the
 * badge and the panel are two readings of one query. A badge promising four and
 * opening onto three is the specific bug that makes people stop trusting a
 * badge.
 *
 * ── the root must stay a single <button> ────────────────────────────────────
 *
 * `quick-dock.tsx` restyles this in place with `[&>button]:…` selectors rather
 * than re-implementing it. Wrapping the button in anything here silently
 * un-styles it in the dock.
 */

import { Bell } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { useNotificationCounts } from "@/hooks/use-notifications";
import { NotificationSheet } from "@/components/notifications/notification-sheet";

export function NotificationBell() {
  const { data: counts } = useNotificationCounts();
  const unread = counts?.unread ?? 0;

  return (
    <NotificationSheet
      trigger={
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {/* Hidden at zero, deliberately: an empty badge is a permanent small
              alarm that trains people to ignore the real one. */}
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
