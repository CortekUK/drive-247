'use client';

/**
 * Write a message, optionally with a booking pinned to it.
 *
 * The attachment is the reason this is not a bare textarea. "My car won't start"
 * is unanswerable without knowing which car; v1 solved that with a booking
 * picker and the operator's inbox already renders what it writes, so the
 * customer side has to keep writing it.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Car, Loader2, Paperclip, Search, Send, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { formatDateRange } from '@/components/portal/format';
import { RentalStatusChip } from '@/components/portal/status-chip';
import { useCustomerRentals, type CustomerRental } from '@/hooks/use-customer-rentals';
import type { MessageBookingReference } from '@/hooks/use-customer-messages';
import { cn } from '@/lib/utils';

/* ───────────────────────────── booking picker ──────────────────────────── */

/**
 * A loaded rental, flattened to the metadata shape both apps agree on.
 *
 * `registration` is already redaction-aware — `useCustomerRentals` withholds it
 * for a tenant with `hide_vehicle_registration` by never selecting the column —
 * so writing it into the message cannot leak a plate the site hides. Empty
 * string, not null, because the shape v1 writes has `reg: string`.
 */
function toBookingReference(rental: CustomerRental): MessageBookingReference {
  return {
    id: rental.id,
    rentalNumber: rental.reference,
    status: rental.statusRaw ?? 'Unknown',
    startDate: rental.startDate,
    endDate: rental.endDate ?? rental.startDate,
    vehicle: {
      make: rental.vehicle?.displayName ?? null,
      model: null,
      reg: rental.vehicle?.registration ?? '',
    },
  };
}

function BookingPicker({
  onSelect,
  disabled,
}: {
  onSelect: (booking: MessageBookingReference) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { rentals, isLoading } = useCustomerRentals('all');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query === '') return rentals;

    return rentals.filter((rental) => {
      const haystack = [
        rental.vehicle?.displayName,
        // Only where the tenant permits it; `registration` is null otherwise,
        // so a hidden plate is not quietly searchable.
        rental.vehicle?.registration,
        rental.reference,
        rental.statusRaw,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [rentals, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="brand-ghost"
          size="icon"
          disabled={disabled}
          className="size-11 shrink-0"
          aria-label="Attach a booking"
        >
          <Paperclip className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] border-brand-border-soft bg-brand-card p-0"
      >
        <div className="border-b border-brand-border-soft p-3">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-text-subtle"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your bookings"
              aria-label="Search your bookings"
              className="h-11 pl-9"
            />
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto p-1.5">
          {isLoading ? (
            <p className="px-2.5 py-6 text-center text-sm text-brand-text-subtle">
              Loading your bookings…
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-sm text-brand-text-subtle">
              {rentals.length === 0
                ? 'You have no bookings to attach yet.'
                : 'No booking matches that search.'}
            </p>
          ) : (
            filtered.map((rental) => (
              <button
                key={rental.id}
                type="button"
                onClick={() => {
                  onSelect(toBookingReference(rental));
                  setSearch('');
                  setOpen(false);
                }}
                className="flex min-h-11 w-full flex-col gap-1 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/25"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-brand-text">
                    {rental.vehicle?.displayName ?? 'Vehicle'}
                  </span>
                  <RentalStatusChip lifecycle={rental.lifecycle} />
                </span>
                <span className="truncate text-xs text-brand-text-subtle">
                  {formatDateRange(rental.startDate, rental.endDate)} · {rental.reference}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ──────────────────────────────── composer ─────────────────────────────── */

export function MessageComposer({
  onSend,
  isSending,
  sendError,
  disabled = false,
}: {
  onSend: (content: string, booking: MessageBookingReference | null) => Promise<void>;
  isSending: boolean;
  sendError: Error | null;
  /** The thread has not loaded yet, or failed to. */
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [booking, setBooking] = useState<MessageBookingReference | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const busy = isSending || disabled;
  const canSend = (draft.trim() !== '' || booking !== null) && !busy;

  const submit = useCallback(async () => {
    if (!canSend) return;

    const content = draft;
    const attachment = booking;

    // Cleared BEFORE the await, and restored on failure. Clearing after would
    // let a fast typist lose the next sentence they started while the insert
    // was in flight.
    setDraft('');
    setBooking(null);

    try {
      await onSend(content, attachment);
    } catch {
      // The error itself is surfaced by the mutation, through `sendError`.
      // What is restored here is the customer's typing — losing that is the
      // part they cannot recover.
      setDraft(content);
      setBooking(attachment);
    } finally {
      textareaRef.current?.focus();
    }
  }, [canSend, draft, booking, onSend]);

  return (
    <div className="border-t border-brand-border-soft">
      {sendError ? (
        <p
          role="alert"
          className="border-b border-brand-border-soft bg-danger-light px-4 py-2 text-xs text-danger sm:px-5"
        >
          {sendError.message}
        </p>
      ) : null}

      {booking ? (
        <div className="px-4 pt-3 sm:px-5">
          <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-brand-stone py-1 pl-3 pr-1 text-xs text-brand-text">
            <Car aria-hidden className="size-3.5 shrink-0 text-brand-text-subtle" />
            <span className="truncate font-medium">
              {booking.vehicle.make ?? 'Booking'}
            </span>
            {booking.rentalNumber ? (
              <span className="truncate text-brand-text-subtle">
                {booking.rentalNumber}
              </span>
            ) : null}
            <Button
              type="button"
              variant="brand-ghost"
              size="icon-xs"
              onClick={() => setBooking(null)}
              className="size-6 shrink-0 rounded-full"
              aria-label="Remove the attached booking"
            >
              <X className="size-3" aria-hidden />
            </Button>
          </span>
        </div>
      ) : null}

      <div className="flex items-end gap-2 p-3 sm:p-4">
        <BookingPicker onSelect={setBooking} disabled={busy} />

        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line — the convention every
            // chat the customer already uses follows.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={1}
          placeholder="Type a message…"
          aria-label="Your message"
          disabled={busy}
          className={cn(
            'max-h-32 min-h-11 flex-1 resize-none rounded-[14px] border-brand-border bg-brand-card',
            'text-sm text-brand-text placeholder:text-brand-placeholder',
            'focus-visible:border-brand-forest focus-visible:ring-brand-forest/25',
          )}
        />

        <Button
          type="button"
          variant="brand"
          size="icon"
          onClick={() => void submit()}
          disabled={!canSend}
          className="size-11 shrink-0"
          aria-label="Send message"
        >
          {isSending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}
