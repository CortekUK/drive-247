'use client';

/**
 * One notification row.
 *
 * Colour is carried ONLY while a notification is unread. Once read, every row
 * collapses to the same quiet stone bubble, so the page visibly calms down as
 * the customer works through it and the remaining colour always means "this one
 * still wants you". A permanently colour-coded list makes a fully-read inbox
 * look exactly as urgent as an untouched one.
 */

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertCircle,
  ArrowRight,
  Car,
  CheckCircle2,
  CreditCard,
  FileSignature,
  Info,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatTimestamp } from '@/components/portal/format';
import type {
  CustomerNotification,
  NotificationKind,
} from '@/hooks/use-customer-notifications';
import { cn } from '@/lib/utils';

/**
 * Icon and tint per kind. Tones come from the status tokens in globals.css —
 * the same family `status-chip.tsx` uses, and the only palette outside the
 * brand set that is safe on these cream cards.
 */
const KIND_STYLE: Record<
  NotificationKind,
  { icon: LucideIcon; unread: string; label: string }
> = {
  booking: { icon: Car, unread: 'bg-info-light text-info', label: 'Booking' },
  agreement: {
    icon: FileSignature,
    unread: 'bg-info-light text-info',
    label: 'Agreement',
  },
  payment: {
    icon: CreditCard,
    unread: 'bg-warning-light text-warning',
    label: 'Payment',
  },
  verification: {
    icon: ShieldCheck,
    unread: 'bg-warning-light text-warning',
    label: 'Verification',
  },
  welcome: { icon: Sparkles, unread: 'bg-success-light text-success', label: 'Welcome' },
  alert: { icon: AlertCircle, unread: 'bg-danger-light text-danger', label: 'Alert' },
  success: {
    icon: CheckCircle2,
    unread: 'bg-success-light text-success',
    label: 'Update',
  },
  info: { icon: Info, unread: 'bg-info-light text-info', label: 'Notice' },
};

/** "3 hours ago", or null when the row has no usable timestamp. */
function relativeLabel(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

export function NotificationItem({
  notification,
  isBusy,
  onMarkRead,
  onDismiss,
}: {
  notification: CustomerNotification;
  /** A write against THIS row is in flight. */
  isBusy: boolean;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const style = KIND_STYLE[notification.kind];
  const Icon = style.icon;
  const unread = !notification.isRead;

  const relative = relativeLabel(notification.createdAt);
  const absolute = formatTimestamp(notification.createdAt);

  return (
    <article
      className={cn(
        'flex gap-3 px-4 py-4 transition-colors sm:gap-4 sm:px-5',
        unread && 'bg-brand-stone/45',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          unread ? style.unread : 'bg-brand-stone text-brand-text-subtle',
        )}
      >
        <Icon strokeWidth={1.75} className="size-5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3
              className={cn(
                'min-w-0 text-sm',
                unread ? 'font-medium text-brand-text' : 'text-brand-text-soft',
              )}
            >
              {notification.title}
            </h3>
            {unread ? (
              <span className="inline-flex items-center rounded-full bg-brand-forest px-2 py-0.5 text-[11px] font-medium leading-none text-white">
                New
              </span>
            ) : null}
          </div>

          {/*
            Remove rides with the title rather than in the action row below.
            Once a notification is read it has no other control, and a lone X
            sitting in an otherwise empty bar under the text reads as a broken
            layout. The negative margins pull the 44px hit area back over the
            padding so the target stays tappable without inflating the row.
          */}
          <Button
            type="button"
            variant="brand-ghost"
            size="icon"
            className="-mt-2.5 -mr-2 size-11 shrink-0 text-brand-text-subtle hover:text-danger"
            disabled={isBusy}
            onClick={() => onDismiss(notification.id)}
          >
            <X aria-hidden className="size-4" />
            <span className="sr-only">Remove “{notification.title}”</span>
          </Button>
        </div>

        <p className="text-sm leading-relaxed text-brand-text-soft">
          {notification.message}
        </p>

        <p className="text-xs text-brand-text-subtle">
          <span className="sr-only">{style.label} · </span>
          {relative ?? 'Date unknown'}
          {relative && absolute ? <span aria-hidden> · {absolute}</span> : null}
        </p>

        {/*
          Actions sit under the copy rather than beside it. At 360px there is no
          room for a title and two controls on one line, and floating them right
          forces the message to wrap into a two-word column.
        */}
        {notification.href || unread ? (
          <div className="mt-1 -ml-3 flex flex-wrap items-center gap-1">
            {notification.href ? (
              <Button
                asChild
                variant="brand-ghost"
                className="h-11 px-3 text-sm has-[>svg]:px-3"
              >
                <Link href={notification.href}>
                  Open
                  <ArrowRight aria-hidden className="size-4" />
                </Link>
              </Button>
            ) : null}

            {unread ? (
              <Button
                type="button"
                variant="brand-ghost"
                className="h-11 px-3 text-sm"
                disabled={isBusy}
                onClick={() => onMarkRead(notification.id)}
              >
                Mark as read
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** Sized like a real row, so the list does not jump when the data lands. */
export function NotificationItemSkeleton() {
  return (
    <div className="flex gap-3 px-4 py-4 sm:gap-4 sm:px-5">
      <span className="size-10 shrink-0 animate-pulse rounded-full bg-brand-stone" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <span className="h-3.5 w-40 max-w-full animate-pulse rounded-full bg-brand-stone" />
        <span className="h-3 w-full animate-pulse rounded-full bg-brand-stone" />
        <span className="h-3 w-28 animate-pulse rounded-full bg-brand-stone" />
      </div>
    </div>
  );
}
