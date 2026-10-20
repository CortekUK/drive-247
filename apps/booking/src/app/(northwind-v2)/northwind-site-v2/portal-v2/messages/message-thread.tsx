'use client';

/**
 * The conversation itself: date separators, bubbles, booking attachments.
 *
 * Drawn as the operator portal v2's thread (`messages-v2/conversation-view` +
 * `chat/ChatMessageBubble` with its rim stripped, as `timeline-item` does): a
 * quiet day word with no rules, borderless tinted bubbles at 8px radius, the
 * time small and bottom-right, and the other side's avatar beside the LAST
 * bubble of a run. The tint is the operator's in-app one, mirrored: there the
 * operator's own bubbles are the stronger tint, here the customer's are.
 *
 * Two visual sides, one rule — `message.isOwn`. Everything else on screen
 * (alignment, fill, timestamp colour, whether a read receipt is drawn at all)
 * follows from it, so there is exactly one place to change if the sides ever
 * need to swap.
 */

import { Calendar, Car, Check, CheckCheck } from 'lucide-react-nw';

import { Skeleton } from '@nw/components/ui/skeleton';
import { formatBookingDates } from '@nw/portal-v2/rentals/format';
import type {
  CustomerMessage,
  MessageBookingReference,
} from '@nw/hooks/use-customer-messages';
import { cn } from '@nw/lib/utils';

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

/** Where a bubble sits in a run of consecutive messages from one side. */
export interface MessageRunPosition {
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
}

/**
 * Runs are per DAY, as in the operator's thread: a day label always opens a
 * new run, so an avatar never has to stand for messages across a separator.
 */
export function runPosition(
  messages: readonly CustomerMessage[],
  index: number,
): MessageRunPosition {
  const message = messages[index];
  const previous = messages[index - 1];
  const next = messages[index + 1];
  return {
    isFirstInGroup: !previous || previous.isOwn !== message.isOwn,
    isLastInGroup: !next || next.isOwn !== message.isOwn,
  };
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

/**
 * The day between messages — a quiet word, no pill and no rules either side.
 * In the operator's borderless thread the label alone is the divider.
 */
export function DaySeparator({ heading }: { heading: string }) {
  return (
    <div className="my-6 flex justify-center">
      <span className="text-xs font-medium text-pv-muted-fg">{heading}</span>
    </div>
  );
}

/** "NR" for "Northwind Rentals" — the operator's mark when it has no logo. */
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  );
}

/**
 * Initials, not the logo: a tenant logo is a wordmark, and a wordmark squeezed
 * into a 32px circle is unreadable.
 */
export function OperatorAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full bg-pv-tint text-xs font-semibold text-pv-primary',
        className,
      )}
    >
      {initials(name)}
    </span>
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
 *
 * Laid out as the operator's `BookingReferenceCard`: icon tile, vehicle, then a
 * calendar line — on a white plate so it reads as an object inside the tint.
 */
function BookingAttachment({ booking }: { booking: MessageBookingReference }) {
  const vehicleName =
    [booking.vehicle.make, booking.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';

  return (
    <div className="mb-1.5 flex items-start gap-2.5 rounded-lg bg-pv-card/80 p-2.5 ring-1 ring-pv-primary/10">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-pv-tint text-pv-primary"
      >
        <Car strokeWidth={1.75} className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-pv-fg">{vehicleName}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-pv-muted-fg">
          <Calendar aria-hidden className="size-3 shrink-0" />
          {formatBookingDates(booking.startDate, booking.endDate)}
        </p>
        {booking.rentalNumber ? (
          <p className="mt-0.5 text-xs tabular-nums text-pv-muted-fg">{booking.rentalNumber}</p>
        ) : null}
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  senderName,
  isFirstInGroup = true,
  isLastInGroup = true,
}: {
  message: CustomerMessage;
  /** Who the operator is — the avatar's initials and its accessible name. */
  senderName: string;
} & Partial<MessageRunPosition>) {
  const { isOwn, booking } = message;
  const clock = formatClock(message.createdAt);

  // v1 writes the literal 'Shared a booking' as the body of an attachment-only
  // message so the operator's inbox has something to preview. With the card
  // right there, printing it too reads as a stutter.
  const body =
    booking && message.content.trim() === 'Shared a booking' ? '' : message.content;

  return (
    <div
      className={cn(
        'flex w-full min-w-0',
        isOwn ? 'justify-end' : 'justify-start',
        isFirstInGroup ? 'mt-4' : 'mt-2',
      )}
    >
      {/* The operator's avatar holds a fixed 32px lane so every bubble in a run
          starts on the same edge; only the last one actually draws it, as the
          operator's thread does for the customer. */}
      {!isOwn ? (
        <div className="mr-2 flex w-8 shrink-0 items-end">
          {isLastInGroup ? <OperatorAvatar name={senderName} /> : null}
        </div>
      ) : null}

      <div
        className={cn(
          'min-w-0 max-w-[80%] rounded-lg px-4 py-2.5 sm:max-w-[65%]',
          isOwn ? 'mr-1 bg-pv-primary/15 text-pv-fg' : 'bg-pv-primary/5 text-pv-fg',
        )}
      >
        {!isOwn && isFirstInGroup ? (
          <p className="mb-0.5 text-xs font-medium text-pv-muted-fg">
            <span className="sr-only">From </span>
            {senderName}
          </p>
        ) : null}

        {booking ? <BookingAttachment booking={booking} /> : null}

        {body !== '' ? (
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{body}</p>
        ) : null}

        <div className="mt-0.5 flex items-center justify-end gap-1">
          {clock ? (
            <span className="text-[11px] whitespace-nowrap tabular-nums text-pv-muted-fg/80">
              {clock}
            </span>
          ) : null}

          {/* Only on our own messages: a receipt on a message we received would
              be telling the customer they have read their own mail. */}
          {isOwn ? (
            message.isRead ? (
              <>
                <CheckCheck aria-hidden className="size-3.5 text-pv-primary" />
                <span className="sr-only">Read</span>
              </>
            ) : (
              <>
                <Check aria-hidden className="size-3.5 text-pv-muted-fg/80" />
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
 * Sized like a real thread — alternating sides, varying widths, the avatar lane
 * held on the operator's side — so nothing moves when the messages land.
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
    <div className="flex flex-col" aria-hidden>
      <div className="mb-2 flex justify-center">
        <Skeleton className="h-3 w-16 rounded-full bg-pv-muted" />
      </div>
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn('mt-4 flex w-full items-end', row.own ? 'justify-end' : 'justify-start')}
        >
          {!row.own ? <Skeleton className="mr-2 size-8 shrink-0 rounded-full bg-pv-muted" /> : null}
          <Skeleton
            className={cn(
              'h-14 max-w-[65%] rounded-lg',
              row.own ? 'mr-1 bg-pv-primary/10' : 'bg-pv-muted',
              row.width,
            )}
          />
        </div>
      ))}
    </div>
  );
}
