'use client';

/**
 * The Bookings filters: the operator's v2 filter panel (STATUS, PAYMENT and a
 * date range, as on its Rentals and Customers pages), built from the shared
 * parts in shared/portal-v2/filter-panel.tsx. The search field's filter button
 * opens it; it sits above the table, and its ✕ (or the button again) closes it.
 *
 * Chip colours are the operator Rentals panel's for the same meaning (green
 * live, amber waiting, slate finished, red cancelled). Upcoming has no colour
 * of its own there in purple, so it takes the plain chosen chip, which is the
 * portal purple. The date range is the Rentals panel's: an outline button per
 * end opening a calendar, and "Clear dates" since dates have no "All" chip,
 * in the portal purple rather than the Rentals panel's blue.
 *
 * Filtering is in memory over the one fetch the page already holds
 * (`applyBookingFilters`), so the data and its query are unchanged.
 */

import { format } from 'date-fns';
import { Activity, CalendarIcon, CreditCard } from 'lucide-react-nw';

import { Calendar } from '@nw/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@nw/components/ui/popover';
import type { CustomerRental, RentalLifecycle, RentalPaymentState } from '@nw/hooks/use-customer-rentals';
import { parseDateOnly } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';
import { V2_BUTTON_OUTLINE } from '@portal-v2-shared/button-styles';
import { FilterChip, FilterSection, FilterShell } from '@portal-v2-shared/filter-panel';

export interface BookingFilters {
  status: 'all' | RentalLifecycle;
  payment: 'all' | Exclude<RentalPaymentState, 'unknown'>;
  /** Pickup on or after, 'YYYY-MM-DD'. */
  pickupFrom?: string;
  /** Pickup on or before, 'YYYY-MM-DD'. */
  pickupTo?: string;
}

export const NO_BOOKING_FILTERS: BookingFilters = { status: 'all', payment: 'all' };

const STATUS_OPTIONS: ReadonlyArray<{ value: BookingFilters['status']; label: string; color: string | null }> = [
  { value: 'all', label: 'All', color: null },
  { value: 'on_rent', label: 'On rent', color: '#16a34a' },
  { value: 'upcoming', label: 'Upcoming', color: null },
  { value: 'pending', label: 'Awaiting confirmation', color: '#d97706' },
  { value: 'completed', label: 'Completed', color: '#64748b' },
  { value: 'cancelled', label: 'Cancelled', color: '#dc2626' },
];

const PAYMENT_OPTIONS: ReadonlyArray<{ value: BookingFilters['payment']; label: string; color: string | null }> = [
  { value: 'all', label: 'All', color: null },
  { value: 'paid', label: 'Paid', color: '#16a34a' },
  { value: 'unpaid', label: 'Payment due', color: '#d97706' },
  { value: 'refunded', label: 'Refunded', color: null },
];

/** How many filters are in force: the badge on the search field's filter button. */
export function countActiveBookingFilters(filters: BookingFilters): number {
  return [
    filters.status !== 'all',
    filters.payment !== 'all',
    !!(filters.pickupFrom || filters.pickupTo),
  ].filter(Boolean).length;
}

/** The rows a search term and the filters leave. The term matches the reference or the car. */
export function applyBookingFilters(
  rentals: readonly CustomerRental[],
  filters: BookingFilters,
  term: string,
): CustomerRental[] {
  const q = term.trim().toLowerCase();
  return rentals.filter((rental) => {
    if (filters.status !== 'all' && rental.lifecycle !== filters.status) return false;
    if (filters.payment !== 'all' && rental.paymentState !== filters.payment) return false;
    if (filters.pickupFrom && rental.startDate < filters.pickupFrom) return false;
    if (filters.pickupTo && rental.startDate > filters.pickupTo) return false;
    if (q) {
      const haystack = [rental.reference, rental.vehicle?.displayName, rental.vehicle?.registration]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function BookingsFilterPanel({
  filters,
  onChange,
  onClose,
}: {
  filters: BookingFilters;
  onChange: (next: BookingFilters) => void;
  onClose: () => void;
}) {
  const hasDates = !!(filters.pickupFrom || filters.pickupTo);

  const dateBtn = (value: string | undefined, placeholder: string, onSelect: (day: string | undefined) => void) => (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(V2_BUTTON_OUTLINE, 'h-8 w-full justify-start text-xs font-normal', !value && 'text-v2-muted-fg')}
        >
          <CalendarIcon className="mr-1.5 size-3.5 shrink-0 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />
          {value ? format(parseDateOnly(value), 'MMM d, yyyy') : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? parseDateOnly(value) : undefined}
          onSelect={(day: Date | undefined) => onSelect(day ? format(day, 'yyyy-MM-dd') : undefined)}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <FilterShell
      onClear={() => onChange(NO_BOOKING_FILTERS)}
      onClose={onClose}
      activeCount={countActiveBookingFilters(filters)}
    >
      <FilterSection
        icon={<Activity className="size-3.5 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />}
        tint="bg-v2-primary/10"
        title="Status"
        className="lg:col-span-2"
      >
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={filters.status === o.value}
              color={o.color}
              onClick={() => onChange({ ...filters, status: o.value })}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection icon={<CreditCard className="size-3.5 text-[#635bff]" />} tint="bg-[#635bff]/10" title="Payment">
        <div className="flex flex-wrap gap-2">
          {PAYMENT_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={filters.payment === o.value}
              color={o.color}
              onClick={() => onChange({ ...filters, payment: o.value })}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<CalendarIcon className="size-3.5 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />}
        tint="bg-v2-primary/10"
        title="Pickup date range"
      >
        <div className="grid grid-cols-2 gap-3">
          {dateBtn(filters.pickupFrom, 'From', (day) => onChange({ ...filters, pickupFrom: day }))}
          {dateBtn(filters.pickupTo, 'To', (day) => onChange({ ...filters, pickupTo: day }))}
        </div>
        {hasDates && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, pickupFrom: undefined, pickupTo: undefined })}
            className="mt-1.5 cursor-pointer text-[11px] text-v2-muted-fg underline-offset-2 hover:text-v2-fg hover:underline"
          >
            Clear dates
          </button>
        )}
      </FilterSection>
    </FilterShell>
  );
}
