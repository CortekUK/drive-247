'use client';

/**
 * Write a message, optionally with a booking pinned to it.
 *
 * The attachment is the reason this is not a bare textarea. "My car won't start"
 * is unanswerable without knowing which car; v1 solved that with a booking
 * picker and the operator's inbox already renders what it writes, so the
 * customer side has to keep writing it.
 *
 * The surface is the operator v2 composer (`messages-v2/conversation-view`,
 * `COMPOSER`): ONE raised box — what you write on top, how it is sent along its
 * bottom edge — with an indigo rim that firms up while you type. It is the one
 * deliberately defined object on an otherwise flat screen, there as here.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Car, Loader2, Paperclip, Search, Send, X } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import { Input } from '@nw/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nw/components/ui/popover';
import { Textarea } from '@nw/components/ui/textarea';
import { formatBookingDates } from '@nw/portal-v2/bookings/format';
import { RentalStatusChip } from '@nw/portal-v2/status-chip';
import { useCustomerRentals, type CustomerRental } from '@nw/hooks/use-customer-rentals';
import type { MessageBookingReference } from '@nw/hooks/use-customer-messages';
import { cn } from '@nw/lib/utils';

import {
  PV_BUTTON_SM,
  PV_ICON_BUTTON,
  PV_INPUT,
} from '../settings/_components/pv-kit';

/**
 * The operator's composer surface on the `--pv-*` tokens: the rim a touch
 * heavier along the bottom for thickness, a white inner highlight on the top
 * edge, and layered primary-tinted shadows so it sits ON the page.
 */
const COMPOSER =
  'rounded-3xl border border-pv-primary/30 border-b-pv-primary/45 bg-pv-card ' +
  'focus-within:border-pv-primary/55 ' +
  'shadow-[inset_0_1px_0_hsl(0_0%_100%/0.9),0_1px_2px_hsl(0_0%_4%/0.08),0_4px_8px_-2px_color-mix(in_srgb,var(--pv-primary)_14%,transparent),0_16px_32px_-12px_color-mix(in_srgb,var(--pv-primary)_38%,transparent),0_28px_56px_-28px_color-mix(in_srgb,var(--pv-primary)_30%,transparent)] ' +
  'transition-[box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none';

/** A field that is part of the composer surface, not a box inside it. */
const BARE_FIELD =
  'rounded-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0';

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
          variant="ghost"
          disabled={disabled}
          className={cn(PV_ICON_BUTTON, 'shrink-0')}
          aria-label="Attach a booking"
        >
          <Paperclip className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border-pv-border bg-pv-card p-0 shadow-lg"
      >
        <div className="px-3 pb-2 pt-3">
          <p className="px-1 pb-2 text-[13px] font-semibold text-pv-fg">Attach a booking</p>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-pv-muted-fg"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search your bookings"
              aria-label="Search your bookings"
              className={cn(PV_INPUT, 'pl-10')}
            />
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto p-1.5 pt-0">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-[13px] text-pv-muted-fg">
              Loading your bookings…
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-pv-muted-fg">
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
                className="flex min-h-11 w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 ease-out hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-pv-primary/25 motion-reduce:transition-none"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] font-medium text-pv-fg">
                    {rental.vehicle?.displayName ?? 'Vehicle'}
                  </span>
                  <RentalStatusChip lifecycle={rental.lifecycle} />
                </span>
                <span className="truncate text-xs text-pv-muted-fg">
                  {formatBookingDates(rental.startDate, rental.endDate)} · {rental.reference}
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
    <div className="shrink-0 space-y-3 px-4 pb-4 pt-2 sm:px-6 sm:pb-5">
      <div className={COMPOSER}>
        {/* The pinned booking rides inside the surface, above the words — the
            operator's attachment chips sit in the same place. */}
        {booking ? (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-pv-primary/10 py-1 pl-2.5 pr-1 text-[12px] font-medium text-pv-primary">
              <Car aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">{booking.vehicle.make ?? 'Booking'}</span>
              {booking.rentalNumber ? (
                <span className="truncate font-normal text-pv-primary/70">
                  {booking.rentalNumber}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setBooking(null)}
                className="relative grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-200 ease-out before:absolute before:-inset-3 before:content-[''] hover:bg-pv-primary/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-pv-primary/25 motion-reduce:transition-none"
                aria-label="Remove the attached booking"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          </div>
        ) : null}

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
          placeholder="Write a message…"
          aria-label="Your message"
          disabled={busy}
          className={cn(
            'max-h-40 min-h-[64px] resize-none px-5 pb-1 pt-4 text-[15px] leading-6 text-pv-fg placeholder:text-pv-muted-fg/70 disabled:opacity-100',
            BARE_FIELD,
          )}
        />

        {/* The bottom edge: attach on the left, send on the right. */}
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <BookingPicker onSelect={setBooking} disabled={busy} />

          <Button
            type="button"
            variant="ghost"
            onClick={() => void submit()}
            disabled={!canSend}
            aria-busy={isSending || undefined}
            className={PV_BUTTON_SM}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
            Send
          </Button>
        </div>
      </div>

      {sendError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-2xl bg-pv-danger-light px-4 py-3 text-[13px] text-pv-danger"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1 leading-relaxed">{sendError.message}</p>
        </div>
      ) : null}
    </div>
  );
}
