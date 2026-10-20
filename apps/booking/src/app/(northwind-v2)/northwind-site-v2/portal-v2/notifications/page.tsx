'use client';

/**
 * Everything the operator has told this customer, newest first.
 *
 * Two tabs over ONE fetch (see `useCustomerNotifications`), filtered in memory
 * exactly as the bookings page does: switching is instant and the count on a
 * tab can never disagree with the rows underneath it.
 *
 * Reading is not automatic. v1 marks nothing read either, and the temptation is
 * to mark the whole list read on mount — but a customer who opens this page,
 * sees "Payment failed" and navigates away to fix it would come back to a page
 * that has forgotten it ever said so. Marking read is an action the customer
 * takes.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, BellOff, CheckCheck, Loader2, type LucideIcon } from 'lucide-react-nw';

import { LoadError, PageHeader, Panel } from '@nw/portal-v2/primitives';
import { Button } from '@nw/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nw/components/ui/dialog';
import {
  NOTIFICATIONS_PAGE_SIZE,
  useCustomerNotifications,
  type CustomerNotification,
} from '@nw/hooks/use-customer-notifications';
import { useTenant } from '@nw/contexts/TenantContext';
import { cn } from '@nw/lib/utils';
import { PvDialogContent } from '@nw/portal-v2/dialog';

import {
  PV_BUTTON_DANGER,
  PV_BUTTON_GHOST_SM,
  PV_BUTTON_OUTLINE,
  PV_BUTTON_OUTLINE_SM,
  PV_DIALOG_DESCRIPTION,
  PV_DIALOG_TITLE,
} from '../settings/_components/pv-kit';

import { NotificationItem, NotificationItemSkeleton } from './notification-item';

type NotificationFilter = 'all' | 'unread';

const FILTERS: ReadonlyArray<{ value: NotificationFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
];

const EMPTY_COPY: Record<NotificationFilter, { title: string; description: string }> = {
  all: {
    title: 'Nothing to catch up on',
    description:
      'Updates about your bookings, payments and documents will appear here as they happen.',
  },
  unread: {
    title: "You're all caught up",
    description:
      'Every notification has been read. The ones you have already seen are under All.',
  },
};

/* ──────────────────────────────── buckets ──────────────────────────────── */

type Bucket = 'today' | 'yesterday' | 'earlier';

const BUCKETS: ReadonlyArray<{ key: Bucket; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'earlier', label: 'Earlier' },
];

/**
 * The reader's LOCAL calendar day, not UTC — "today" has to agree with the
 * clock they are looking at. A row with no usable timestamp goes to Earlier
 * rather than vanishing.
 */
function bucketOf(createdAt: string | null, now: Date): Bucket {
  if (!createdAt) return 'earlier';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'earlier';
  const dayStart = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return 'earlier';
}

function groupByBucket(
  rows: readonly CustomerNotification[],
): Record<Bucket, CustomerNotification[]> {
  const now = new Date();
  const grouped: Record<Bucket, CustomerNotification[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const row of rows) grouped[bucketOf(row.createdAt, now)].push(row);
  return grouped;
}

/** The operator panel's empty state, at page size. */
function EmptyRows({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-pv-muted text-pv-muted-fg">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="text-[15px] font-semibold tracking-tight text-pv-fg">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-pv-muted-fg">{body}</p>
      {action ? (
        <Button asChild variant="ghost" className={cn(PV_BUTTON_OUTLINE_SM, 'mt-5')}>
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────── the page ──────────────────────────────── */

export default function PortalNotificationsPage() {
  const { tenant } = useTenant();
  const operatorName = tenant?.company_name ?? tenant?.app_name ?? 'us';

  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const {
    notifications,
    unreadCount,
    hasMore,
    isLoading,
    isError,
    error,
    refetch,
    markAsRead,
    markAllAsRead,
    dismiss,
    clearAll,
    isMarkingAll,
    isClearingAll,
    pendingId,
    mutationError,
  } = useCustomerNotifications();

  const visible = useMemo(
    () => (filter === 'unread' ? notifications.filter((n) => !n.isRead) : notifications),
    [notifications, filter],
  );

  // Counts come from the full set, not the filtered view, so a tab always
  // states how many rows it holds before you press it.
  const counts: Record<NotificationFilter, number> = {
    all: notifications.length,
    unread: unreadCount,
  };

  const grouped = useMemo(() => groupByBucket(visible), [visible]);

  const busy = isMarkingAll || isClearingAll;
  const hasRows = !isLoading && !isError && notifications.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description={`Updates from ${operatorName} about your bookings, payments and documents.`}
      />

      {/*
        A write that fails must say so. Every mutation here is optimistic, so
        the row has already snapped back to its old state by the time this
        renders — without a message the customer sees their click undo itself.
      */}
      {mutationError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl bg-pv-danger-light px-4 py-3 text-[13px] text-pv-danger"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1 leading-relaxed">{mutationError.message}</p>
        </div>
      ) : null}

      {isError ? (
        <LoadError
          title="We could not load your notifications"
          error={error}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* The toolbar: filters on the left, the list's own actions on the
              right — the operator panel's header row. */}
          {hasRows ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div role="group" aria-label="Filter notifications" className="flex gap-1">
                {FILTERS.map((option) => {
                  const active = option.value === filter;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(option.value)}
                      className={cn(
                        'inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium md:h-9 md:px-3.5',
                        'transition-colors duration-200 ease-out motion-reduce:transition-none',
                        'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-pv-primary/25',
                        active
                          ? 'bg-pv-primary/10 text-pv-primary'
                          : 'text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg',
                      )}
                    >
                      {option.label}
                      <span
                        className={cn(
                          'tabular-nums',
                          active ? 'text-pv-primary/70' : 'text-pv-muted-fg/60',
                        )}
                      >
                        {counts[option.value]}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1">
                {unreadCount > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={PV_BUTTON_OUTLINE_SM}
                    disabled={busy}
                    onClick={() => markAllAsRead()}
                  >
                    {isMarkingAll ? (
                      <Loader2 aria-hidden className="size-4 animate-spin" />
                    ) : (
                      <CheckCheck aria-hidden className="size-4" />
                    )}
                    Mark all as read
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className={PV_BUTTON_GHOST_SM}
                  disabled={busy}
                  onClick={() => setConfirmClear(true)}
                >
                  Clear all
                </Button>
              </div>
            </div>
          ) : null}

          <Panel className="overflow-hidden">
            {isLoading ? (
              <div aria-hidden className="divide-y divide-pv-border/60 py-1">
                {Array.from({ length: 4 }, (_, index) => (
                  <NotificationItemSkeleton key={index} />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <EmptyRows
                icon={filter === 'unread' ? BellOff : Bell}
                title={EMPTY_COPY[filter].title}
                body={EMPTY_COPY[filter].description}
                action={
                  filter === 'all' && notifications.length === 0
                    ? { href: '/portal/rentals', label: 'See your rentals' }
                    : undefined
                }
              />
            ) : (
              <>
                {BUCKETS.map(({ key, label }) =>
                  grouped[key].length === 0 ? null : (
                    <section
                      key={key}
                      aria-label={label}
                      className="border-b border-pv-border/60"
                    >
                      <p className="px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-pv-muted-fg sm:px-6">
                        {label}
                      </p>
                      <div className="divide-y divide-pv-border/60">
                        {grouped[key].map((notification) => (
                          <NotificationItem
                            key={notification.id}
                            notification={notification}
                            isBusy={busy || pendingId === notification.id}
                            onMarkRead={markAsRead}
                            onDismiss={dismiss}
                          />
                        ))}
                      </div>
                    </section>
                  ),
                )}

                {/*
                  The end of the list says which end it is. Said out loud rather
                  than hidden behind a hard LIMIT: a customer hunting for last
                  year's agreement notice needs to know the list stops, not
                  silently conclude it was deleted.
                */}
                <p className="px-5 py-4 text-center text-[12px] text-pv-muted-fg/80 sm:px-6">
                  {hasMore
                    ? `Showing your ${NOTIFICATIONS_PAGE_SIZE} most recent notifications. Older ones are not shown.`
                    : "That's everything."}
                </p>
              </>
            )}
          </Panel>
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <PvDialogContent>
          <DialogHeader className="gap-2 pr-8">
            <DialogTitle className={PV_DIALOG_TITLE}>Clear all notifications?</DialogTitle>
            <DialogDescription className={PV_DIALOG_DESCRIPTION}>
              This permanently deletes all {notifications.length} of your notifications
              and cannot be undone. Your bookings, documents and payments are not
              affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" className={PV_BUTTON_OUTLINE}>
                Keep them
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="ghost"
              className={PV_BUTTON_DANGER}
              disabled={isClearingAll}
              onClick={() => {
                clearAll();
                setConfirmClear(false);
              }}
            >
              {isClearingAll ? 'Clearing…' : 'Clear all'}
            </Button>
          </DialogFooter>
        </PvDialogContent>
      </Dialog>
    </div>
  );
}
