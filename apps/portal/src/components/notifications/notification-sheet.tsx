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
 * ── the counts are the database's answer, not this file's ───────────────────
 *
 * The panel used to load 50 rows and then count and filter them here. Both were
 * wrong and both were visible: "All 50" was the LIMIT (the tenant had 65), and
 * "Rentals 17" was 17 of 32. A pill counted a page, not a table.
 *
 * Filtering and counting now both happen in the query — see
 * `notification-filters.ts` — so the number on a pill is a promise about the
 * rows underneath it, the list pages properly, and nothing is unreachable.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle, Bell, CheckCheck, ChevronDown, Inbox, Loader2, RefreshCw, ShieldCheck, X,
} from "lucide-react";
import {
  Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui-v2/sheet";
import { Button } from "@/components/ui-v2/button";
import {
  useNotifications, useNotificationCounts,
  type Notification, type NotificationRow,
} from "@/hooks/use-notifications";
/* Already solved once, for the Messages workspace, and for the same reason the
   module documents: the codebase's .no-scrollbar class is scoped to .v2-theme,
   which is only on <body> for tenants gated into the v2 theme, and this panel
   ships to all of them. */
import { NO_SCROLLBAR } from "@/components/messages-v2/no-scrollbar";
import {
  NOTIFICATION_FILTERS, type NotificationFilter,
} from "@/components/notifications/notification-filters";
import {
  BUCKET_LABEL, CATEGORY_LABEL, CATEGORY_TONE, SEVERITY_LABEL, SEVERITY_TONE,
  categoryOf, dayBucket, parseDate, severityOf,
} from "@/components/notifications/taxonomy";

/**
 * The five categories, plus one pill that cuts ACROSS them.
 *
 * "critical" is NOT a sixth category. A notification has exactly one category
 * and, separately, a severity — so a failed deposit hold is a Payment and it is
 * Critical, and it shows under both pills. Modelling severity as a category
 * would have forced a choice between them, and the row would then go missing
 * from whichever one the operator happened to look in.
 */
type Filter = NotificationFilter;

/** The sentence an empty list should say, which depends on why it is empty. */
const EMPTY_COPY: Record<Filter, string> = {
  all: "Nothing here yet. Payments, bookings and alerts will appear as they happen.",
  payments: "No payment notifications yet.",
  rentals: "No rental notifications yet.",
  customers: "No customer notifications yet.",
  system: "No system notifications yet.",
  critical:
    "Nothing needs urgent attention. Failed deposit holds, unverified payments, low insurance balance and critical reminders would show here.",
};

/**
 * The sheet shell, and the outer half of the scrollbar fix.
 *
 * `overflow-hidden` is the load-bearing word. The panel is a fixed-height flex
 * column whose only scrolling child is the list; without it, a short viewport
 * let that column overflow its own box and the sheet grew a SECOND bar down the
 * outside — the nested pair in the review screenshot. The shell now cannot
 * scroll at all, so there is exactly one scroll region in the panel, and
 * NO_SCROLLBAR means no bar is painted for it either.
 */
const SHEET_SHELL =
  `flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[420px] ${NO_SCROLLBAR}`;

/**
 * A timestamp that cannot take the panel down with it.
 *
 * `created_at` is nullable and `formatDistanceToNow` THROWS on an Invalid Date,
 * which in a render is not a missing date — it is a blank notification centre.
 */
function relativeTime(iso: string | null | undefined): string | null {
  const d = parseDate(iso);
  if (!d) return null;
  try {
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return null;
  }
}

function Row({
  row, onOpen, onMarkRead,
}: {
  row: NotificationRow;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const n = row.notification;
  const category = categoryOf(n.type);
  const critical = severityOf(n.type) === "critical";
  const unread = !n.is_read;
  const when = relativeTime(n.created_at);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        /* Space as well as Enter: this is a button in everything but tag name,
           and a keyboard user pressing Space on it should not scroll the list
           underneath instead of opening the row. */
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`group relative w-full cursor-pointer px-5 py-3.5 text-left transition-colors hover:bg-accent/50 ${
        critical ? "bg-destructive/[0.03]" : unread ? "bg-primary/[0.03]" : ""
      }`}
    >
      {/* Severity is a left edge, not a filled card. Critical has to be findable
          while scanning without the panel turning into a wall of red. */}
      {critical && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-destructive" />
      )}

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            {/* Weight is the whole of the "stronger typography": a critical row
                keeps full-strength ink after it has been read, where a normal
                read row fades back to 80%. No size change — differing row
                heights would make the list look broken rather than urgent. */}
            <p className={`line-clamp-2 text-[13px] leading-snug ${
              unread || critical ? "font-semibold text-foreground" : "font-medium text-foreground/80"
            }`}>
              {n.title || "Notification"}
            </p>
            {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
          </div>

          {n.message && (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
              {n.message}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium ${CATEGORY_TONE[category]}`}>
              {CATEGORY_LABEL[category]}
            </span>
            {critical && (
              <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10px] font-medium ${SEVERITY_TONE.critical}`}>
                <AlertTriangle className="h-2.5 w-2.5" />
                {SEVERITY_LABEL.critical}
              </span>
            )}
            {/* The same notification, written twice by whatever produced it.
                Collapsed into one row and SAID, so the row count and the pill's
                count can differ without either looking wrong. */}
            {row.duplicates > 1 && (
              <span
                title={`Sent ${row.duplicates} times`}
                className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground"
              >
                ×{row.duplicates}
              </span>
            )}
            {/* No date rather than a wrong one. A nullable column that renders
                as "56 years ago" is worse than one that renders as nothing. */}
            {when && <span className="text-[11px] text-muted-foreground/70">{when}</span>}
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

  /* Counts are always live — the bell outside this panel reads the same query,
     so opening the sheet costs no extra request. The LIST is fetched only while
     the panel is open: there is no reason to page through rows nobody is
     looking at, and the realtime channel keeps the counts current regardless. */
  const { data: counts, error: countsError } = useNotificationCounts();
  const {
    rows, isLoading, error, refetch, markAsRead, markAllAsRead,
    hasNextPage, fetchNextPage, isFetchingNextPage,
  } = useNotifications({ filter, enabled: open });

  const unread = counts?.unread ?? 0;
  const total = counts?.[filter] ?? 0;

  /* Grouping only — no filtering here. The filter is in the query, so what
     arrives is already the right set, which is what lets "Critical 5" and the
     five rows under it be the same answer. */
  const grouped: Record<"today" | "yesterday" | "earlier", NotificationRow[]> = {
    today: [], yesterday: [], earlier: [],
  };
  for (const r of rows) grouped[dayBucket(r.notification.created_at)].push(r);

  function openNotification(n: Notification) {
    if (!n.is_read) markAsRead.mutate(n.id);
    /* Only same-app paths. A `link` is written by triggers and edge functions,
       and handing an arbitrary string to the router is how a notification
       navigates somewhere that does not exist — or off-site. */
    if (n.link && n.link.startsWith("/")) {
      setOpen(false);
      router.push(n.link);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      {/* `showCloseButton={false}`: the primitive's own close button is
          absolutely positioned top-right, which put it ON TOP of "Mark all as
          read" and clipped that to "Mark all as re". It is re-added below as a
          real sibling inside the header row — same action, laid out rather than
          overlapping. */}
      <SheetContent side="right" className={SHEET_SHELL} showCloseButton={false}>
        {/* Fixed header: title, the count, and the one bulk action. `shrink-0`
            so a short viewport takes height from the list, never from the
            controls that filter it. */}
        <SheetHeader className="shrink-0 border-b border-border/60 px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-[15px] font-semibold tracking-tight">
              Notifications
              {unread > 0 && (
                <span className="ml-2 inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                  {unread}
                </span>
              )}
            </SheetTitle>
            <div className="flex shrink-0 items-center gap-0.5">
              {/* Labelled, not a bare icon — the brief asked for exactly that. */}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 whitespace-nowrap rounded-full text-[12px]"
                disabled={unread === 0 || markAllAsRead.isPending}
                onClick={() => markAllAsRead.mutate()}
              >
                {markAllAsRead.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <CheckCheck className="h-3.5 w-3.5" />}
                Mark all as read
              </Button>
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-full" aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </SheetClose>
            </div>
          </div>

          {/* Filters. Five categories plus Critical, every one of them counted
              by the database over the same predicate that fetches the rows. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {NOTIFICATION_FILTERS.map(({ key, label }) => {
              const active = filter === key;
              const count = counts?.[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  aria-pressed={active}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  {label}
                  {/* Shown even at zero, and only once the counts have actually
                      arrived. "Critical 0" is an answer; a bare "Critical" is a
                      question the operator has to open the pill to settle. */}
                  {count !== undefined && (
                    <span className={active ? "text-primary/70" : "text-muted-foreground/60"}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </SheetHeader>

        {(markAllAsRead.isError || markAsRead.isError || countsError) && (
          <p className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-destructive/10 px-5 py-2.5 text-[12px] text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {markAllAsRead.isError
              ? "Could not mark them read. Try again."
              : markAsRead.isError
                ? "Could not mark that one read. Try again."
                : "Counts are out of date — the panel could not reach the server."}
          </p>
        )}

        {/* The ONLY scroll region in the panel.
            - `min-h-0` is load-bearing: a flex child defaults to
              `min-height:auto`, so without it this box grows to fit its content
              instead of scrolling, pushing the column past the sheet — which is
              what produced the second, outer scrollbar.
            - `overscroll-contain` stops a wheel at the end of the list from
              chaining through to the page behind the backdrop.
            - `NO_SCROLLBAR` removes the bar and nothing else. */}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${NO_SCROLLBAR}`}>
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
          ) : rows.length === 0 ? (
            <Empty
              icon={filter === "all" ? Bell : filter === "critical" ? ShieldCheck : Inbox}
              title={
                filter === "all"
                  ? "No notifications"
                  : filter === "critical"
                    ? "Nothing critical"
                    : "Nothing in this category"
              }
              body={EMPTY_COPY[filter]}
            />
          ) : (
            <>
              {(["today", "yesterday", "earlier"] as const).map((bucket) =>
                grouped[bucket].length === 0 ? null : (
                  <div key={bucket}>
                    <p className="sticky top-0 z-10 bg-background/95 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                      {BUCKET_LABEL[bucket]}
                    </p>
                    <div className="divide-y divide-border/40">
                      {grouped[bucket].map((r) => (
                        <Row
                          key={r.notification.id}
                          row={r}
                          onOpen={() => openNotification(r.notification)}
                          onMarkRead={() => markAsRead.mutate(r.notification.id)}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}

              {/* The end of the list says which end it is. Older notifications
                  used to be silently unreachable past row 50; now the panel
                  either offers the next page or states there is none. */}
              <div className="px-5 py-4 text-center">
                {hasNextPage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 rounded-full"
                    disabled={isFetchingNextPage}
                    onClick={() => fetchNextPage()}
                  >
                    {isFetchingNextPage
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <ChevronDown className="h-3.5 w-3.5" />}
                    Load older notifications
                  </Button>
                ) : (
                  <p className="text-[11px] text-muted-foreground/70">
                    {total > 0 ? `That's all ${total}.` : "That's everything."}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
