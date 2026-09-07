"use client";

/**
 * The notification centre.
 *
 * ── what changed and why ────────────────────────────────────────────────────
 *
 * This was a Popover hanging off the bell with two tabs, General and Messages.
 * Two problems, and only one of them was cosmetic.
 *
 * The cosmetic one: a popover is the wrong container for a scrolling list with
 * filters and a header action. It is anchored, width-constrained by its
 * trigger's corner of the screen, and it fights page content. This is a right
 * side Sheet — the same primitive `dock-sheets.tsx` already uses — so it has a
 * fixed header, its own scroll region, a backdrop, and no way to overlap
 * anything.
 *
 * The real one: MESSAGES WERE NEVER NOTIFICATIONS. They have their own screen,
 * their own realtime channel and their own unread badge in the dock, so a
 * Messages tab here counted the same thing twice and put the answer in two
 * places. `chat_message` is now excluded outright — see `taxonomy.ts`.
 *
 * ── what is reused ──────────────────────────────────────────────────────────
 *
 * All of it. `useNotifications` already did the real work: tenant-scoped query,
 * realtime on INSERT/UPDATE/DELETE, unread count, mark-one, mark-all, delete.
 * Nothing here re-implements any of that; the only addition to the hook was
 * exposing `error`, which it always had and never surfaced.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, Bell, BellOff, CheckCheck, Inbox, Loader2, RefreshCw, X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui-v2/sheet";
import { Button } from "@/components/ui-v2/button";
import { useNotifications, type Notification } from "@/hooks/use-notifications";
import {
  BUCKET_LABEL, CATEGORY_LABEL, CATEGORY_TONE, SEVERITY_LABEL, SEVERITY_TONE,
  categoryOf, dayBucket, isNotificationCentreType, severityOf,
  type NotificationCategory,
} from "@/components/notifications/taxonomy";

type Filter = "all" | NotificationCategory;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "payments", label: "Payments" },
  { key: "rentals", label: "Rentals" },
  { key: "customers", label: "Customers" },
  { key: "system", label: "System" },
];

/** The sentence an empty list should say, which depends on why it is empty. */
const EMPTY_COPY: Record<Filter, string> = {
  all: "Nothing here yet. Payments, bookings and alerts will appear as they happen.",
  payments: "No payment notifications yet.",
  rentals: "No rental notifications yet.",
  customers: "No customer notifications yet.",
  system: "No system notifications yet.",
};

function Row({
  n, onOpen, onMarkRead,
}: {
  n: Notification;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const category = categoryOf(n.type);
  const severity = severityOf(n.type);
  const unread = !n.is_read;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className={`group relative w-full cursor-pointer px-5 py-3.5 text-left transition-colors hover:bg-accent/50 ${
        unread ? "bg-primary/[0.03]" : ""
      }`}
    >
      {/* Severity is a left edge, not a filled card. Critical has to stand out
          without the panel turning into a wall of red. */}
      {severity !== "normal" && (
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-[3px] ${
            severity === "critical" ? "bg-destructive" : "bg-amber-500"
          }`}
        />
      )}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className={`text-[13px] leading-snug ${unread ? "font-semibold text-foreground" : "font-medium text-foreground/80"}`}>
              {n.title}
            </p>
            {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
          </div>

          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {n.message}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium ${CATEGORY_TONE[category]}`}>
              {CATEGORY_LABEL[category]}
            </span>
            {severity !== "normal" && (
              <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-medium ${SEVERITY_TONE[severity]}`}>
                {severity === "critical" && <AlertTriangle className="h-2.5 w-2.5" />}
                {SEVERITY_LABEL[severity]}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground/70">
              {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
            </span>
          </div>
        </div>

        {/* One action per row, and only where it applies. A read notification
            has nothing to mark. */}
        {unread && (
          <Button
            variant="ghost"
            size="icon"
            title="Mark as read"
            aria-label="Mark as read"
            className="h-7 w-7 shrink-0 rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
          >
            <CheckCheck className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, body }: { icon: typeof Bell; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-[13px] font-semibold tracking-tight">{title}</p>
      <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function NotificationSheet({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const router = useRouter();
  const {
    notifications, unreadCount, isLoading, error, refetch, markAsRead, markAllAsRead,
  } = useNotifications();

  /* Messages are excluded before anything else sees the list, so they cannot
     reappear in a count, a filter or the "mark all" set. */
  const centre = useMemo(
    () => notifications.filter((n) => isNotificationCentreType(n.type)),
    [notifications],
  );

  const visible = useMemo(
    () => (filter === "all" ? centre : centre.filter((n) => categoryOf(n.type) === filter)),
    [centre, filter],
  );

  /* The badge and this panel must agree, so the count is taken from the same
     filtered set rather than the hook's raw total — which includes chat. */
  const centreUnread = centre.filter((n) => !n.is_read).length;

  const grouped = useMemo(() => {
    const buckets: Record<"today" | "yesterday" | "earlier", Notification[]> = {
      today: [], yesterday: [], earlier: [],
    };
    for (const n of visible) buckets[dayBucket(n.created_at)].push(n);
    return buckets;
  }, [visible]);

  function openNotification(n: Notification) {
    if (!n.is_read) markAsRead.mutate(n.id);
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[420px]">
        {/* Fixed header: title, the count, and the one bulk action. */}
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="text-[15px] font-semibold tracking-tight">
              Notifications
              {centreUnread > 0 && (
                <span className="ml-2 inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                  {centreUnread}
                </span>
              )}
            </SheetTitle>
            {/* Labelled, not a bare icon — the brief asked for exactly that. */}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 rounded-full text-[12px]"
              disabled={centreUnread === 0 || markAllAsRead.isPending}
              onClick={() => markAllAsRead.mutate()}
            >
              {markAllAsRead.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <CheckCheck className="h-3.5 w-3.5" />}
              Mark all as read
            </Button>
          </div>

          {/* Filters. Five, each backed by real `type` values. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTERS.map(({ key, label }) => {
              const count = key === "all"
                ? centre.length
                : centre.filter((n) => categoryOf(n.type) === key).length;
              const active = filter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className={active ? "text-primary/70" : "text-muted-foreground/60"}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </SheetHeader>

        {markAllAsRead.isError && (
          <p className="flex items-center gap-2 border-b border-border/60 bg-destructive/10 px-5 py-2.5 text-[12px] text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Could not mark them read. Try again.
          </p>
        )}

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded-full bg-muted/70" />
                </div>
              ))}
            </div>
          ) : error ? (
            /* A failed fetch is NOT an empty list, and must never render as
               one — "you have nothing" is the one message that stops somebody
               checking again. */
            <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="text-[13px] font-semibold tracking-tight">
                Notifications could not be loaded
              </p>
              <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
                {(error as Error)?.message || "The request did not come back."}
              </p>
              <Button variant="outline" size="sm" className="mt-5 gap-2 rounded-full" onClick={() => refetch()}>
                <RefreshCw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <Empty
              icon={filter === "all" ? Bell : Inbox}
              title={filter === "all" ? "No notifications" : "Nothing in this category"}
              body={EMPTY_COPY[filter]}
            />
          ) : (
            (["today", "yesterday", "earlier"] as const).map((bucket) =>
              grouped[bucket].length === 0 ? null : (
                <div key={bucket}>
                  <p className="sticky top-0 z-10 bg-background/95 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {BUCKET_LABEL[bucket]}
                  </p>
                  <div className="divide-y divide-border/40">
                    {grouped[bucket].map((n) => (
                      <Row
                        key={n.id}
                        n={n}
                        onOpen={() => openNotification(n)}
                        onMarkRead={() => markAsRead.mutate(n.id)}
                      />
                    ))}
                  </div>
                </div>
              ),
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
