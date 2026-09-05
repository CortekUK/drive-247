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
import { Bell, BellOff, CheckCheck, Trash2 } from 'lucide-react';

import {
  EmptyState,
  LoadError,
  PageHeader,
  Panel,
} from '@/components/portal/primitives';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  NOTIFICATIONS_PAGE_SIZE,
  useCustomerNotifications,
} from '@/hooks/use-customer-notifications';
import { cn } from '@/lib/utils';

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

export default function PortalNotificationsPage() {
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

  const description =
    unreadCount > 0
      ? `${unreadCount} unread ${unreadCount === 1 ? 'notification' : 'notifications'}.`
      : 'Updates about your bookings, payments and documents.';

  const busy = isMarkingAll || isClearingAll;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description={description}
        action={
          !isLoading && !isError && notifications.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {unreadCount > 0 ? (
                <Button
                  type="button"
                  variant="brand-outline"
                  className="h-11"
                  disabled={busy}
                  onClick={() => markAllAsRead()}
                >
                  <CheckCheck aria-hidden className="size-4" />
                  {isMarkingAll ? 'Marking…' : 'Mark all as read'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="brand-ghost"
                className="h-11"
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 aria-hidden className="size-4" />
                Clear all
              </Button>
            </div>
          ) : undefined
        }
      />

      {/*
        A write that fails must say so. Every mutation here is optimistic, so
        the row has already snapped back to its old state by the time this
        renders — without a message the customer sees their click undo itself.
      */}
      {mutationError ? (
        <div
          role="alert"
          className="rounded-[14px] border border-danger-subtle bg-danger-light px-4 py-3 text-sm text-danger"
        >
          {mutationError.message}
        </div>
      ) : null}

      {!isLoading && !isError && notifications.length > 0 ? (
        <div
          role="group"
          aria-label="Filter notifications"
          className="flex w-full gap-1 rounded-full border border-brand-border-soft bg-brand-card p-1"
        >
          {FILTERS.map((option) => {
            const active = option.value === filter;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.value)}
                className={cn(
                  'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25',
                  active
                    ? 'bg-brand-forest font-medium text-white'
                    : 'text-brand-text-soft hover:bg-brand-stone hover:text-brand-text',
                )}
              >
                {option.label}
                <span
                  className={cn(
                    'tabular-nums',
                    active ? 'text-white/70' : 'text-brand-text-subtle',
                  )}
                >
                  {counts[option.value]}
                </span>
              </button>
            );
          })}
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
      ) : isLoading ? (
        <Panel aria-hidden>
          <div className="divide-y divide-brand-border-soft">
            {Array.from({ length: 4 }, (_, index) => (
              <NotificationItemSkeleton key={index} />
            ))}
          </div>
        </Panel>
      ) : visible.length === 0 ? (
        <Panel>
          <EmptyState
            icon={filter === 'unread' ? BellOff : Bell}
            title={EMPTY_COPY[filter].title}
            description={EMPTY_COPY[filter].description}
            action={
              filter === 'all' && notifications.length === 0
                ? { href: '/portal/bookings', label: 'See your bookings' }
                : undefined
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-2">
          <Panel className="overflow-hidden">
            <div className="divide-y divide-brand-border-soft">
              {visible.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  isBusy={busy || pendingId === notification.id}
                  onMarkRead={markAsRead}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          </Panel>

          {/*
            Said out loud rather than hidden behind a hard LIMIT. A customer
            hunting for last year's agreement notice needs to know the list
            stops, not silently conclude it was deleted.
          */}
          {hasMore ? (
            <p className="px-1 text-xs text-brand-text-subtle">
              Showing your {NOTIFICATIONS_PAGE_SIZE} most recent notifications. Older
              ones are not shown.
            </p>
          ) : null}
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear all notifications?</DialogTitle>
            <DialogDescription className="text-brand-text-soft">
              This permanently deletes all {notifications.length} of your notifications
              and cannot be undone. Your bookings, documents and payments are not
              affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="brand-outline" className="h-11">
                Keep them
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              className="h-11 rounded-full"
              disabled={isClearingAll}
              onClick={() => {
                clearAll();
                setConfirmClear(false);
              }}
            >
              {isClearingAll ? 'Clearing…' : 'Clear all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
