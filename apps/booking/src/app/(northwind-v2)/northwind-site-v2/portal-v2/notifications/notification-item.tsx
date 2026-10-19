'use client';

/**
 * One notification row — the operator portal v2's row
 * (`notifications-v2/notification-sheet-v2`, `Row`) at the customer's size.
 *
 * The same rules carry over: unread is a faint primary wash plus a dot and a
 * heavier title; a read row fades its title back; an alert keeps a red left
 * edge whether read or not, so it stays findable without the list turning into
 * a wall of red; the kind is a small tinted pill beside the time. One step
 * roomier than the operator's — 14px titles, the whole message rather than two
 * clamped lines — because a customer reads these, they do not triage them.
 *
 * The whole row opens the notification's page when it has one (a stretched
 * link under the title), and the row's own controls sit above that link.
 */

import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCheck, X } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { formatTimestamp } from '@nw/components/portal/format';
import type {
  CustomerNotification,
  NotificationKind,
} from '@nw/hooks/use-customer-notifications';
import { cn } from '@nw/lib/utils';

import { PV_ICON_BUTTON } from '../settings/_components/pv-kit';

/**
 * Pill per kind, in the operator's category tones: rentals blue, payments
 * green, people violet, everything else the quiet grey. Alerts carry the
 * critical red instead.
 */
const KIND_STYLE: Record<NotificationKind, { label: string; tone: string }> = {
  booking: { label: 'Booking', tone: 'bg-blue-500/10 text-blue-700' },
  agreement: { label: 'Agreement', tone: 'bg-blue-500/10 text-blue-700' },
  payment: { label: 'Payment', tone: 'bg-emerald-500/10 text-emerald-700' },
  verification: { label: 'Verification', tone: 'bg-violet-500/10 text-violet-700' },
  welcome: { label: 'Welcome', tone: 'bg-pv-muted text-pv-muted-fg' },
  alert: { label: 'Needs attention', tone: 'bg-pv-danger-light text-pv-danger' },
  success: { label: 'Update', tone: 'bg-pv-muted text-pv-muted-fg' },
  info: { label: 'Notice', tone: 'bg-pv-muted text-pv-muted-fg' },
};

/** "3 hours ago", or null when the row has no usable timestamp. */
function relativeLabel(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Icon actions: always visible on a touch screen (there is no hover to reveal
 * them), and from md up shown on hover or keyboard focus, as the operator's
 * mark-read control is. Opacity only, 200ms — §12's hover rule.
 */
const ROW_ACTION = cn(
  PV_ICON_BUTTON,
  'relative z-10 transition-[opacity,color,background-color] md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100',
);

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
  const unread = !notification.isRead;
  const critical = notification.kind === 'alert';

  const relative = relativeLabel(notification.createdAt);
  const absolute = formatTimestamp(notification.createdAt);
  const href = notification.href ?? null;

  return (
    <article
      className={cn(
        'group relative flex items-start gap-3 px-5 py-4 sm:px-6',
        'transition-colors duration-200 ease-out motion-reduce:transition-none',
        critical ? 'bg-pv-danger/[0.03]' : unread ? 'bg-pv-primary/[0.03]' : undefined,
        href ? 'hover:bg-pv-row-hover' : undefined,
      )}
    >
      {/* Severity is a left edge, not a filled card. */}
      {critical ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-pv-danger" />
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2.5">
          <h3
            className={cn(
              'min-w-0 text-[14px] leading-snug',
              unread || critical ? 'font-semibold text-pv-fg' : 'font-medium text-pv-fg/80',
            )}
          >
            {href ? (
              <Link
                href={href}
                className="rounded-sm after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-inset focus-visible:after:ring-pv-primary/25"
              >
                {notification.title}
              </Link>
            ) : (
              notification.title
            )}
          </h3>
          {unread ? (
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-pv-primary">
              <span className="sr-only">Unread</span>
            </span>
          ) : null}
        </div>

        {notification.message ? (
          <p className="mt-1 text-[13px] leading-relaxed text-pv-muted-fg">
            {notification.message}
          </p>
        ) : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium',
              style.tone,
            )}
          >
            {critical ? <AlertTriangle aria-hidden className="size-3" /> : null}
            {style.label}
          </span>
          {/* No date rather than a wrong one. */}
          {relative ? (
            <span className="text-[12px] text-pv-muted-fg/80" title={absolute ?? undefined}>
              {relative}
            </span>
          ) : null}
        </div>
      </div>

      {/* One action that applies, plus remove. A read notification has
          nothing to mark. */}
      <div className="-my-1 -mr-2 flex shrink-0 items-center">
        {unread ? (
          <Button
            type="button"
            variant="ghost"
            title="Mark as read"
            className={ROW_ACTION}
            disabled={isBusy}
            onClick={() => onMarkRead(notification.id)}
          >
            <CheckCheck aria-hidden className="size-4" />
            <span className="sr-only">Mark “{notification.title}” as read</span>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          title="Remove"
          className={cn(ROW_ACTION, 'hover:text-pv-danger')}
          disabled={isBusy}
          onClick={() => onDismiss(notification.id)}
        >
          <X aria-hidden className="size-4" />
          <span className="sr-only">Remove “{notification.title}”</span>
        </Button>
      </div>
    </article>
  );
}

/** Sized like a real row, so the list does not jump when the data lands. */
export function NotificationItemSkeleton() {
  return (
    <div className="space-y-2.5 px-5 py-4 sm:px-6">
      <span className="block h-3.5 w-2/5 animate-pulse rounded-full bg-pv-muted motion-reduce:animate-none" />
      <span className="block h-3 w-4/5 animate-pulse rounded-full bg-pv-muted/70 motion-reduce:animate-none" />
      <span className="block h-5 w-28 animate-pulse rounded-full bg-pv-muted/70 motion-reduce:animate-none" />
    </div>
  );
}
