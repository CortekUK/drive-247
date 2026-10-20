'use client';

/**
 * The Agreements filters, built like the Bookings ones from the shared v2
 * filter panel (shared/portal-v2/filter-panel.tsx): STATUS and TYPE pill
 * groups, Reset and a close button. The top bar's filter button opens it above
 * the table. Chip colours follow the operator Rentals palette for the same
 * meaning (amber waiting on you, green done, slate inactive, red stopped).
 *
 * Filtering is in memory over the agreements the page already loaded.
 */

import { FileText, PenLine } from 'lucide-react-nw';

import type { AgreementKind, AgreementState, CustomerAgreement } from '@nw/hooks/use-customer-agreements';
import { FilterChip, FilterSection, FilterShell } from '@portal-v2-shared/filter-panel';

import { agreementTitle } from './agreement-dialog';
import { STATE_CHIP } from './agreement-state';

export interface AgreementFilters {
  state: 'all' | AgreementState;
  kind: 'all' | AgreementKind;
}

export const NO_AGREEMENT_FILTERS: AgreementFilters = { state: 'all', kind: 'all' };

const STATE_COLOR: Record<AgreementState, string> = {
  awaiting_signature: '#d97706',
  opened: '#d97706',
  signed: '#16a34a',
  preparing: '#64748b',
  cancelled: '#64748b',
  declined: '#dc2626',
  expired: '#dc2626',
};

// The order a customer cares about: what needs them first.
const STATE_ORDER: AgreementState[] = [
  'awaiting_signature',
  'opened',
  'signed',
  'preparing',
  'declined',
  'expired',
  'cancelled',
];

const KIND_OPTIONS: ReadonlyArray<{ value: AgreementFilters['kind']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'original', label: 'Rental agreement' },
  { value: 'extension', label: 'Extension agreement' },
];

export function countActiveAgreementFilters(filters: AgreementFilters): number {
  return [filters.state !== 'all', filters.kind !== 'all'].filter(Boolean).length;
}

/** The rows a search term and the filters leave. The term matches the reference, the car or the title. */
export function applyAgreementFilters(
  agreements: readonly CustomerAgreement[],
  filters: AgreementFilters,
  term: string,
): CustomerAgreement[] {
  const q = term.trim().toLowerCase();
  return agreements.filter((agreement) => {
    if (filters.state !== 'all' && agreement.state !== filters.state) return false;
    if (filters.kind !== 'all' && agreement.kind !== filters.kind) return false;
    if (q) {
      const haystack = [agreement.rentalReference, agreement.vehicleLabel, agreementTitle(agreement)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function AgreementsFilterPanel({
  filters,
  onChange,
  onClose,
}: {
  filters: AgreementFilters;
  onChange: (next: AgreementFilters) => void;
  onClose: () => void;
}) {
  return (
    <FilterShell
      onClear={() => onChange(NO_AGREEMENT_FILTERS)}
      onClose={onClose}
      activeCount={countActiveAgreementFilters(filters)}
    >
      <FilterSection
        icon={<PenLine className="size-3.5 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />}
        tint="bg-v2-primary/10"
        title="Status"
        className="lg:col-span-3"
      >
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filters.state === 'all'} onClick={() => onChange({ ...filters, state: 'all' })}>
            All
          </FilterChip>
          {STATE_ORDER.map((state) => (
            <FilterChip
              key={state}
              active={filters.state === state}
              color={STATE_COLOR[state]}
              onClick={() => onChange({ ...filters, state })}
            >
              {STATE_CHIP[state].label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<FileText className="size-3.5 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />}
        tint="bg-v2-primary/10"
        title="Type"
      >
        <div className="flex flex-wrap gap-2">
          {KIND_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={filters.kind === o.value}
              onClick={() => onChange({ ...filters, kind: o.value })}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>
    </FilterShell>
  );
}
