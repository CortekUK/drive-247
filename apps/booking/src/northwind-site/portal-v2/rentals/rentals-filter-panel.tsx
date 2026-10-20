'use client';

/**
 * The Rentals filters: the operator Rentals panel (STATUS, PAYMENT and the
 * start date range), built from the shared parts in
 * shared/portal-v2/filter-panel.tsx. As on the operator page it is the BACK of
 * the overview card: the search field's filter button turns the card over, and
 * its ✕ (or Escape) turns it back.
 *
 * Status chips are the operator's words and colours, the same words the table
 * prints (`customerRentalStatus`), so a chip selects exactly the rows that read
 * that way. Payment is what happened to the customer's money (the operator's
 * Payment section is its billing mode, which means nothing to a customer).
 * The date range is the operator's: an outline button per end opening a
 * calendar, and "Clear dates" since dates have no "All" chip, in the portal
 * purple.
 *
 * Filtering is in memory over the one fetch the page already holds
 * (`applyRentalFilters`), so the data and its query are unchanged.
 */

import { format } from 'date-fns';
import { Activity, CalendarIcon, CreditCard } from 'lucide-react-nw';

import { Calendar } from '@nw/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@nw/components/ui/popover';
import type { CustomerRental, RentalPaymentState } from '@nw/hooks/use-customer-rentals';
import { parseDateOnly } from '@nw/lib/domain';
import { cn } from '@nw/lib/utils';
import { V2_BUTTON_OUTLINE } from '@portal-v2-shared/button-styles';
import { FilterChip, FilterSection, FilterShell } from '@portal-v2-shared/filter-panel';

import { customerRentalStatus } from './rentals-table';

export interface RentalFilters {
  /** One of the operator's status words, or 'all'. */
  status: 'all' | 'Active' | 'Upcoming' | 'Pending' | 'Completed' | 'Cancelled';
  payment: 'all' | Exclude<RentalPaymentState, 'unknown'>;
  /** Starts on or after, 'YYYY-MM-DD'. */
  pickupFrom?: string;
  /** Starts on or before, 'YYYY-MM-DD'. */
  pickupTo?: string;
}

export const NO_RENTAL_FILTERS: RentalFilters = { status: 'all', payment: 'all' };

/** The operator Rentals panel's chips, word for word and colour for colour. */
const STATUS_OPTIONS: ReadonlyArray<{ value: RentalFilters['status']; label: string; color: string | null }> = [
  { value: 'all', label: 'All', color: null },
  { value: 'Active', label: 'Active', color: '#16a34a' },
  { value: 'Upcoming', label: 'Upcoming', color: '#2563eb' },
  { value: 'Pending', label: 'Pending', color: '#d97706' },
  { value: 'Completed', label: 'Completed', color: '#64748b' },
  { value: 'Cancelled', label: 'Cancelled', color: '#dc2626' },
];

const PAYMENT_OPTIONS: ReadonlyArray<{ value: RentalFilters['payment']; label: string; color: string | null }> = [
  { value: 'all', label: 'All', color: null },
  { value: 'paid', label: 'Paid', color: '#16a34a' },
  { value: 'unpaid', label: 'Payment due', color: '#d97706' },
  { value: 'refunded', label: 'Refunded', color: null },
];

/** How many filters are in force: the badge on the search field's filter button. */
export function countActiveRentalFilters(filters: RentalFilters): number {
  return [
    filters.status !== 'all',
    filters.payment !== 'all',
    !!(filters.pickupFrom || filters.pickupTo),
  ].filter(Boolean).length;
}

/** The rows a search term and the filters leave. The term matches the reference or the car. */
export function applyRentalFilters(
  rentals: readonly CustomerRental[],
  filters: RentalFilters,
  term: string,
): CustomerRental[] {
  const q = term.trim().toLowerCase();
  return rentals.filter((rental) => {
    if (filters.status !== 'all') {
      const status = customerRentalStatus(rental);
      // Rejected has no chip of its own (the operator panel has none either):
      // a rejected rental never ran, so it sits with the cancelled ones.
      if ((status === 'Rejected' ? 'Cancelled' : status) !== filters.status) return false;
    }
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

export function RentalsFilterPanel({
  filters,
  onChange,
  onClose,
}: {
  filters: RentalFilters;
  onChange: (next: RentalFilters) => void;
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
      onClear={() => onChange(NO_RENTAL_FILTERS)}
      onClose={onClose}
      activeCount={countActiveRentalFilters(filters)}
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
        title="Start date range"
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
