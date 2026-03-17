"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, Trash2, X, MessageSquare, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
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
      className={`p-3 border-b last:border-b-0 hover:bg-accent/50 transition-colors cursor-pointer ${
        !notification.is_read ? "bg-accent/30" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-sm font-semibold transition-colors ${!notification.is_read ? "text-foreground" : "text-foreground/80"}`}>
              {notification.title}
            </p>
            {!notification.is_read && (
              <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
            )}
          </div>
          <p className="text-xs text-foreground/70 line-clamp-2 mt-0.5">
            {notification.message}
          </p>
          <p className="text-xs text-foreground/50 mt-1">
            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
          </p>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {!notification.is_read && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onMarkRead}
              title="Mark as read"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            title="Delete"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

const EmptyState = ({ icon: Icon, text }: { icon: React.ElementType; text: string }) => (
  <div className="p-8 text-center">
    <Icon className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
    <p className="text-sm text-muted-foreground">{text}</p>
  </div>
);

type TabKey = "general" | "messages";

export const NotificationBell = () => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAll,
  } = useNotifications();

  // Split notifications by type
  const messageNotifications = notifications.filter((n) => n.type === "chat_message");
  const generalNotifications = notifications.filter((n) => n.type !== "chat_message");

  const messageUnread = messageNotifications.filter((n) => !n.is_read).length;
  const generalUnread = generalNotifications.filter((n) => !n.is_read).length;

  const activeNotifications = activeTab === "messages" ? messageNotifications : generalNotifications;

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
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
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold">Notifications</h3>
          <div className="flex items-center gap-1">
            {activeNotifications.filter((n) => !n.is_read).length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => markAllAsRead.mutate()}
                title="Mark all as read"
              >
                <CheckCheck className="h-4 w-4" />
              </Button>
            )}
            {activeNotifications.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => clearAll.mutate()}
                title="Clear all"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === "general"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("general")}
          >
            <BellRing className="h-3.5 w-3.5" />
            General
            {generalUnread > 0 && (
              <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">
                {generalUnread > 99 ? "99+" : generalUnread}
              </Badge>
            )}
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === "messages"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("messages")}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Messages
            {messageUnread > 0 && (
              <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">
                {messageUnread > 99 ? "99+" : messageUnread}
              </Badge>
            )}
          </button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            Loading...
          </div>
        ) : activeNotifications.length === 0 ? (
          <EmptyState
            icon={activeTab === "messages" ? MessageSquare : Bell}
            text={activeTab === "messages" ? "No messages" : "No notifications"}
          />
        ) : (
          <ScrollArea className="h-[360px]">
            {activeNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={() => markAsRead.mutate(notification.id)}
                onDelete={() => deleteNotification.mutate(notification.id)}
                onClick={() => handleNotificationClick(notification)}
              />
            ))}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
};
