"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useNotifications, Notification } from "@/hooks/use-notifications";
import { formatDistanceToNow } from "date-fns";

const NotificationItem = ({
  notification,
  onMarkRead,
  onDelete,
  onClick,
}: {
  notification: Notification;
  onMarkRead: () => void;
  onDelete: () => void;
  onClick: () => void;
}) => {
  return (
    <div
      className="group relative cursor-pointer px-5 py-4 transition-colors hover:bg-accent/40"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Unread dot — calm, fixed gutter so read/unread align */}
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${notification.is_read ? "bg-transparent" : "bg-primary"}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-[13px] ${notification.is_read ? "font-medium text-foreground/80" : "font-semibold text-foreground"}`}>
            {notification.title}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {notification.message}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground/60">
            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
          </p>
        </div>
        {/* Actions — appear on hover only, keeps the resting list calm */}
        <div
          className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {!notification.is_read && (
            <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer text-muted-foreground" onClick={onMarkRead} title="Mark as read">
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer text-muted-foreground hover:text-destructive" onClick={onDelete} title="Dismiss">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ icon: Icon, text }: { icon: React.ElementType; text: string }) => (
  <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
    <Icon className="mb-3 h-8 w-8 text-muted-foreground/25" strokeWidth={1.5} />
    <p className="text-sm text-muted-foreground/70">{text}</p>
  </div>
);

export const NotificationBell = ({
  trigger,
}: {
  trigger?: (unreadCount: number) => React.ReactNode;
} = {}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications();

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.is_read) {
      markAsRead.mutate(notification.id);
    }
    if (notification.link) {
      router.push(notification.link);
      setOpen(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ? (
          trigger(unreadCount)
        ) : (
          <Button variant="ghost" size="icon-lg" className="relative cursor-pointer rounded-full">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <Badge
                className="absolute -top-1 -right-1 h-5 min-w-5 px-1 flex items-center justify-center text-xs"
                variant="destructive"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className="p-0 gap-0">
        {/* Header — calm: title + unread count + a "mark all read" button */}
        <SheetHeader className="h-16 flex-row items-center justify-between space-y-0 border-b px-5">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-base font-semibold">Notifications</SheetTitle>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => markAllAsRead.mutate()}
                  className="h-8 w-8 cursor-pointer text-muted-foreground hover:text-primary"
                  aria-label="Mark all as read"
                >
                  <CheckCheck className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mark all as read</TooltipContent>
            </Tooltip>
          )}
        </SheetHeader>

        {/* Content — single calm list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-20 text-center text-sm text-muted-foreground/70">Loading…</div>
          ) : notifications.length === 0 ? (
            <EmptyState icon={Bell} text="You're all caught up" />
          ) : (
            <div className="divide-y divide-border/40">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={() => markAsRead.mutate(notification.id)}
                  onDelete={() => deleteNotification.mutate(notification.id)}
                  onClick={() => handleNotificationClick(notification)}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
