'use client';

/**
 * Finances' filter panel — the back face of the hero row, turned over by the
 * top bar's filter button (shared overview-flip), as on Rentals. It replaces
 * the Invoices / Payments toggle (owner, Oct 22 2026): which list, and which
 * statuses within it. Built from the shared filter kit, as Agreements'.
 */

import type { InvoiceState, PaymentState } from '@nw/hooks/use-customer-payments';
import { FilterChip, FilterSection, FilterShell } from '@portal-v2-shared/filter-panel';

export type FinanceList = 'invoices' | 'payments';

export interface FinanceFilters {
  list: FinanceList;
  invoiceState: 'all' | InvoiceState;
  paymentState: 'all' | PaymentState;
}

export const NO_FINANCE_FILTERS: FinanceFilters = { list: 'invoices', invoiceState: 'all', paymentState: 'all' };

const INVOICE_OPTIONS: { value: FinanceFilters['invoiceState']; label: string; color: string | null }[] = [
  { value: 'all', label: 'All', color: null },
  { value: 'due', label: 'Due', color: '#d97706' },
  { value: 'overdue', label: 'Overdue', color: '#dc2626' },
  { value: 'part_paid', label: 'Part paid', color: '#2563eb' },
  { value: 'paid', label: 'Paid', color: '#16a34a' },
  { value: 'cancelled', label: 'Cancelled', color: null },
];

const PAYMENT_OPTIONS: { value: FinanceFilters['paymentState']; label: string; color: string | null }[] = [
  { value: 'all', label: 'All', color: null },
  { value: 'received', label: 'Received', color: '#16a34a' },
  { value: 'pending', label: 'Processing', color: '#d97706' },
  { value: 'hold', label: 'Card hold', color: '#2563eb' },
  { value: 'refunded', label: 'Refunded', color: null },
  { value: 'reversed', label: 'Cancelled', color: null },
];

/** Payments counts as a filter, as does a status: both narrow what is shown. */
export function countActiveFinanceFilters(filters: FinanceFilters): number {
  const status = filters.list === 'invoices' ? filters.invoiceState : filters.paymentState;
  return [filters.list !== 'invoices', status !== 'all'].filter(Boolean).length;
}

export function FinanceFilterPanel({
  filters,
  counts,
  onChange,
  onClose,
}: {
  filters: FinanceFilters;
  counts: { invoices: number; payments: number };
  onChange: (next: FinanceFilters) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof FinanceFilters>(key: K, value: FinanceFilters[K]) => onChange({ ...filters, [key]: value });
  const options = filters.list === 'invoices' ? INVOICE_OPTIONS : PAYMENT_OPTIONS;
  const current = filters.list === 'invoices' ? filters.invoiceState : filters.paymentState;

  return (
    <FilterShell onClear={() => onChange(NO_FINANCE_FILTERS)} onClose={onClose} activeCount={countActiveFinanceFilters(filters)}>
      <FilterSection icon={null} tint="hidden" title="Show">
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filters.list === 'invoices'} onClick={() => set('list', 'invoices')}>
            Invoices · {counts.invoices}
          </FilterChip>
          <FilterChip active={filters.list === 'payments'} onClick={() => set('list', 'payments')}>
            Payments · {counts.payments}
          </FilterChip>
        </div>
      </FilterSection>

      <FilterSection icon={null} tint="hidden" title="Status">
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <FilterChip
              key={o.value}
              active={current === o.value}
              color={o.color}
              onClick={() =>
                filters.list === 'invoices'
                  ? set('invoiceState', o.value as FinanceFilters['invoiceState'])
                  : set('paymentState', o.value as FinanceFilters['paymentState'])
              }
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>
    </FilterShell>
  );
}
