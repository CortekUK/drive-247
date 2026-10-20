'use client';

/**
 * The Agreements filters: the operator's Agreements panel
 * (apps/portal/src/components/agreements-v2/agreements-filter-panel-v2.tsx),
 * built from the shared parts in shared/portal-v2/filter-panel.tsx, on the
 * BACK of the overview card as there. Sent between, Status and Kind, with the
 * operator's chips and colours. The operator's Customer field is left out: a
 * customer's agreements all come from the one company.
 *
 * Filtering is in memory over the one list the page already holds, with the
 * search matching the reference, the title and the message.
 */

import { format } from 'date-fns';
import { Activity, CalendarIcon, Layers } from 'lucide-react-nw';

import { Calendar } from '@nw/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@nw/components/ui/popover';
import { cn } from '@nw/lib/utils';
import { agreementReference, type AgreementKind, type AgreementListRow, type AgreementStatus } from '@portal-v2-shared/agreements/list';
import { V2_BUTTON_OUTLINE } from '@portal-v2-shared/button-styles';
import { FilterChip, FilterSection, FilterShell } from '@portal-v2-shared/filter-panel';

export interface AgreementFilters {
  status: 'all' | AgreementStatus;
  kind: 'all' | AgreementKind;
  sentFrom?: Date;
  sentTo?: Date;
}

export const NO_AGREEMENT_FILTERS: AgreementFilters = { status: 'all', kind: 'all' };

const STATUS_OPTIONS: { value: AgreementFilters['status']; label: string; color: string | null }[] = [
  { value: 'all', label: 'All', color: null },
  { value: 'signed', label: 'Signed', color: '#16a34a' },
  { value: 'pending', label: 'Pending signature', color: '#d97706' },
  { value: 'failed', label: 'Failed', color: '#dc2626' },
];

const KIND_OPTIONS: { value: AgreementFilters['kind']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'rental', label: 'Rental' },
  { value: 'individual', label: 'Individual' },
];

/** Noon, so a picked day can never drift across midnight on a timezone shift. */
const normalizeDate = (date: Date | undefined) =>
  date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0) : undefined;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function countActiveAgreementFilters(filters: AgreementFilters): number {
  return [filters.status !== 'all', filters.kind !== 'all', !!(filters.sentFrom || filters.sentTo)].filter(Boolean).length;
}

export function applyAgreementFilters<T extends AgreementListRow>(rows: readonly T[], filters: AgreementFilters, term: string): T[] {
  const q = term.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.kind !== 'all' && row.kind !== filters.kind) return false;
    if (filters.sentFrom || filters.sentTo) {
      const at = row.sentAt ? Date.parse(row.sentAt) : NaN;
      if (Number.isNaN(at)) return false;
      if (filters.sentFrom && at < dayStart(filters.sentFrom)) return false;
      if (filters.sentTo && at >= dayStart(filters.sentTo) + 86_400_000) return false;
    }
    if (q) {
      const haystack = [agreementReference(row), row.title, row.message].filter(Boolean).join(' ').toLowerCase();
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
  const set = <K extends keyof AgreementFilters>(key: K, value: AgreementFilters[K]) => onChange({ ...filters, [key]: value });
  const hasDates = !!(filters.sentFrom || filters.sentTo);

  const dateBtn = (value: Date | undefined, placeholder: string, onSelect: (d: Date | undefined) => void) => (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(V2_BUTTON_OUTLINE, 'h-8 w-full justify-start text-xs font-normal', !value && 'text-v2-muted-fg')}>
          <CalendarIcon className="mr-1.5 size-3.5 shrink-0 text-blue-600 dark:text-blue-400" />
          {value ? format(value, 'MMM d, yyyy') : placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={(d: Date | undefined) => onSelect(normalizeDate(d))} />
      </PopoverContent>
    </Popover>
  );

  return (
    <FilterShell onClear={() => onChange(NO_AGREEMENT_FILTERS)} onClose={onClose} activeCount={countActiveAgreementFilters(filters)}>
      <FilterSection icon={<CalendarIcon className="size-3.5 text-blue-600 dark:text-blue-400" />} tint="bg-blue-500/10" title="Sent between">
        <div className="grid grid-cols-2 gap-3">
          {dateBtn(filters.sentFrom, 'From', (d) => set('sentFrom', d))}
          {dateBtn(filters.sentTo, 'To', (d) => set('sentTo', d))}
        </div>
        {hasDates && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, sentFrom: undefined, sentTo: undefined })}
            className="mt-1.5 cursor-pointer text-[11px] text-v2-muted-fg underline-offset-2 hover:text-v2-fg hover:underline"
          >
            Clear dates
          </button>
        )}
      </FilterSection>

      <FilterSection
        icon={<Activity className="size-3.5 text-v2-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />}
        tint="bg-v2-primary/10"
        title="Status"
      >
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((o) => (
            <FilterChip key={o.value} active={filters.status === o.value} color={o.color} onClick={() => set('status', o.value)}>
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection icon={<Layers className="size-3.5 text-emerald-600 dark:text-emerald-400" />} tint="bg-emerald-500/10" title="Kind">
        <div className="flex flex-wrap gap-2">
          {KIND_OPTIONS.map((o) => (
            <FilterChip key={o.value} active={filters.kind === o.value} onClick={() => set('kind', o.value)}>
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>
    </FilterShell>
  );
}
