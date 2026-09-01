'use client';

/**
 * The conversation itself: date separators, bubbles, booking attachments.
 *
 * Two visual sides, one rule — `message.isOwn`. Everything else on screen
 * (alignment, fill, timestamp colour, whether a read receipt is drawn at all)
 * follows from it, so there is exactly one place to change if the sides ever
 * need to swap.
 */

import { Car, Check, CheckCheck } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { formatDateRange } from '@/components/portal/format';
import type {
  CustomerMessage,
  MessageBookingReference,
} from '@/hooks/use-customer-messages';
import { cn } from '@/lib/utils';

/* ─────────────────────────────── formatting ────────────────────────────── */

/**
 * `created_at` is a `timestamptz` — a real instant — so `new Date()` is right
 * here. This is NOT the DATE-only trap documented in `components/portal/format`;
 * that one applies to `rentals.start_date` and friends.
 */
function messageDate(value: string): Date | null {
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2:05 PM" in the reader's locale, or null when the row has no timestamp. */
function formatClock(value: string): string | null {
  const date = messageDate(value);
  if (!date) return null;
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today" / "Yesterday" / "31 Aug 2026" for the separator between days. */
function formatDayHeading(date: Date, now: Date = new Date()): string {
  const dayStart = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

  const days = Math.round((dayStart(date) - dayStart(now)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === -1) return 'Yesterday';

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export interface MessageDayGroup {
  /** Stable key: the local calendar day, as an ISO-ish 'YYYY-M-D'. */
  key: string;
  heading: string;
  messages: CustomerMessage[];
}

/**
 * Split a time-ordered thread into calendar days.
 *
 * Grouping on the LOCAL day, not the UTC one: a message sent at 23:40 in London
 * is "yesterday" to a reader in Los Angeles and the separator has to agree with
 * the clock the reader is looking at.
 *
 * Messages with no usable timestamp are kept, in place, under an "Earlier"
 * heading rather than dropped — losing a customer's message because a migrated
 * row has a null `created_at` would be the worse failure.
 */
export function groupMessagesByDay(
  messages: readonly CustomerMessage[],
  now: Date = new Date(),
): MessageDayGroup[] {
  const groups: MessageDayGroup[] = [];

  for (const message of messages) {
    const date = messageDate(message.createdAt);
    const key = date
      ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
      : 'undated';
    const heading = date ? formatDayHeading(date, now) : 'Earlier';

    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.messages.push(message);
    } else {
      groups.push({ key, heading, messages: [message] });
    }
  }

  return groups;
}

/* ──────────────────────────────── pieces ───────────────────────────────── */

export function DaySeparator({ heading }: { heading: string }) {
  return (
    <div className="my-4 flex items-center justify-center">
      <span className="rounded-full bg-brand-stone px-3 py-1 text-xs font-medium text-brand-text-subtle">
        {heading}
      </span>
    </div>
  );
}

/**
 * A booking pinned to a message.
 *
 * Not a link. The attachment is a SNAPSHOT of the booking as it was when it was
 * shared — the dates and status are frozen in the metadata — so sending the
 * reader to today's booking page would quietly contradict the message they are
 * reading. The reference number is what they quote; the bookings list is one tap
 * away in the sidebar.
 */
function BookingAttachment({
  booking,
  isOwn,
}: {
  booking: MessageBookingReference;
  isOwn: boolean;
}) {
  const vehicleName =
    [booking.vehicle.make, booking.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';

  return (
    <div
      className={cn(
        'mt-2 flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5',
        isOwn ? 'border-white/25 bg-white/10' : 'border-brand-border bg-brand-card',
      )}
    >
      <Car
        aria-hidden
        strokeWidth={1.75}
        className={cn('mt-0.5 size-4 shrink-0', isOwn ? 'text-white/70' : 'text-brand-text-subtle')}
      />
      <div className="min-w-0">
        <p className={cn('text-sm font-medium', isOwn ? 'text-white' : 'text-brand-text')}>
          {vehicleName}
        </p>
        <p className={cn('text-xs', isOwn ? 'text-white/70' : 'text-brand-text-subtle')}>
          {formatDateRange(booking.startDate, booking.endDate)}
        </p>
        {booking.rentalNumber ? (
          <p
            className={cn(
              'mt-0.5 text-xs tabular-nums',
              isOwn ? 'text-white/70' : 'text-brand-text-subtle',
            )}
          >
            {booking.rentalNumber}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  senderName,
}: {
  message: CustomerMessage;
  /** Who the operator is, shown above their first bubble of a run. */
  senderName: string;
}) {
  const { isOwn, booking } = message;
  const clock = formatClock(message.createdAt);

  // v1 writes the literal 'Shared a booking' as the body of an attachment-only
  // message so the operator's inbox has something to preview. With the card
  // right there, printing it too reads as a stutter.
  const body =
    booking && message.content.trim() === 'Shared a booking' ? '' : message.content;

  return (
    <div className={cn('flex w-full', isOwn ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[75%]',
          isOwn
            ? 'rounded-br-md bg-brand-forest text-white'
            : 'rounded-bl-md bg-brand-stone text-brand-text',
        )}
      >
        {!isOwn ? (
          <p className="mb-1 text-xs font-medium text-brand-text-soft">{senderName}</p>
        ) : null}

        {body !== '' ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{body}</p>
        ) : null}

        {booking ? <BookingAttachment booking={booking} isOwn={isOwn} /> : null}

        <div
          className={cn(
            'mt-1 flex items-center gap-1',
            isOwn ? 'justify-end' : 'justify-start',
          )}
        >
          {clock ? (
            <span
              className={cn(
                'text-[11px] tabular-nums',
                isOwn ? 'text-white/70' : 'text-brand-text-subtle',
              )}
            >
              {clock}
            </span>
          ) : null}

          {/* Only on our own messages: a receipt on a message we received would
              be telling the customer they have read their own mail. */}
          {isOwn ? (
            message.isRead ? (
              <>
                <CheckCheck aria-hidden className="size-3.5 text-white/70" />
                <span className="sr-only">Read</span>
              </>
            ) : (
              <>
                <Check aria-hidden className="size-3.5 text-white/70" />
                <span className="sr-only">Sent</span>
              </>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────── skeleton ───────────────────────────────── */

/**
 * Sized like a real thread — alternating sides, varying widths — so the panel
 * does not resize under the reader when the messages land.
 */
export function MessageThreadSkeleton() {
  const rows: ReadonlyArray<{ own: boolean; width: string }> = [
    { own: false, width: 'w-56' },
    { own: true, width: 'w-40' },
    { own: false, width: 'w-64' },
    { own: true, width: 'w-32' },
    { own: false, width: 'w-48' },
  ];

  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="my-2 flex justify-center">
        <Skeleton className="h-6 w-20 rounded-full bg-brand-stone" />
      </div>
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn('flex w-full', row.own ? 'justify-end' : 'justify-start')}
        >
          <Skeleton
            className={cn('h-14 max-w-[75%] rounded-2xl bg-brand-stone', row.width)}
          />
        </div>
      ))}
    </div>
  );
}
