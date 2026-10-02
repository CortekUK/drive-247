'use client';

/**
 * Insights — the top bar's search and filters, lent by this page.
 *
 * Like every v2 list, Insights does not draw its own search box or period
 * dropdown: it registers with the top bar (`usePageSearch`). The field finds
 * any entry behind the receipt — a charge, a cost, a car purchase, a refund —
 * and the filter button opens the period panel, built from the same
 * `FilterShell` the rentals, vehicles and customers panels use.
 *
 * Search results are corrected in place with the same `EntryLine` controls as
 * the receipt's dialogs, so finding an entry and fixing it is one screen.
 */

import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { FilterChip, FilterSection, FilterShell } from '@/components/shared/filter-primitives';
import { formatCurrency } from '@/lib/format-utils';
import { toNumber, type Bucket } from './_money-model';
import { PERIOD_OPTIONS, vehicleName, type InsightsData, type PeriodMonths } from './_data';
import { EntryLine } from './_adjustments';

export const DEFAULT_MONTHS: PeriodMonths = 12;

/* ────────────────────────────────────────────────────────────────────────────
 * Filters
 * ──────────────────────────────────────────────────────────────────────────── */

export function InsightsFilterPanel({
  months,
  onMonthsChange,
  onClose,
}: {
  months: PeriodMonths;
  onMonthsChange: (months: PeriodMonths) => void;
  onClose: () => void;
}) {
  return (
    <FilterShell
      onClear={() => onMonthsChange(DEFAULT_MONTHS)}
      onClose={onClose}
      activeCount={months === DEFAULT_MONTHS ? 0 : 1}
    >
      <FilterSection
        icon={<CalendarDays className="size-3.5 text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" />}
        tint="bg-primary/10"
        title="Period"
        className="sm:col-span-2 lg:col-span-4"
      >
        <div className="flex flex-wrap gap-2">
          {PERIOD_OPTIONS.map((option) => (
            <FilterChip key={option.value} active={months === option.value} onClick={() => onMonthsChange(option.value)}>
              {option.label}
            </FilterChip>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Every view follows it. "Still owed" is always as of today.
        </p>
      </FilterSection>
    </FilterShell>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Search
 * ──────────────────────────────────────────────────────────────────────────── */

/** Which receipt line an entry sits on, in the receipt's own words. */
const LINE: Record<Bucket, string> = {
  operating_revenue: 'Money you took in',
  non_revenue: 'Money that was never yours',
  operating_cost: 'Money you spent',
  capital_cost: 'Car purchases',
};

type Hit =
  | { kind: 'entry'; id: string; date: string | null; line: string; label: string; sub: string; row: InsightsData['ledger'][number] }
  | { kind: 'payment'; id: string; date: string | null; line: string; label: string; sub: string; row: InsightsData['refunds'][number] };

/** Every word must appear somewhere in the entry, in any order. */
export function useInsightsSearch(data: InsightsData | undefined, term: string): Hit[] {
  return useMemo(() => {
    const words = term.toLowerCase().split(/\s+/).filter(Boolean);
    if (!data || words.length === 0) return [];
    const labels = data.vehicleLabels;
    const hits: Hit[] = [];

    for (const row of data.ledger) {
      if (!row.bucket) continue;
      const car = row.vehicle_id ? vehicleName(labels, row.vehicle_id) : 'Not tied to a car';
      const line = LINE[row.bucket];
      const text = [row.category, car, row.entry_date, toNumber(row.amount).toFixed(2), line, row.excluded ? 'left out' : '']
        .join(' ')
        .toLowerCase();
      if (words.every((w) => text.includes(w))) {
        hits.push({
          kind: 'entry',
          id: row.id,
          date: row.entry_date,
          line,
          label: row.category ?? 'Uncategorised',
          sub: `${row.entry_date ?? ''} · ${car}`,
          row,
        });
      }
    }

    for (const refund of data.refunds) {
      const car = refund.vehicleId ? vehicleName(labels, refund.vehicleId) : '';
      const text = [refund.customerName, refund.reason, car, refund.date, refund.amount.toFixed(2), 'refund money you gave back']
        .join(' ')
        .toLowerCase();
      if (words.every((w) => text.includes(w))) {
        hits.push({
          kind: 'payment',
          id: refund.id,
          date: refund.date,
          line: 'Money you gave back',
          label: refund.customerName ?? 'Customer no longer on record',
          sub: [refund.date?.slice(0, 10), car, refund.reason?.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' · '),
          row: refund,
        });
      }
    }

    return hits.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [data, term]);
}

const LIST_CAP = 200;

/** Results, grouped by receipt line, each one correctable in place. */
export function SearchResults({ hits, term, currency }: { hits: Hit[]; term: string; currency: string }) {
  const groups = useMemo(() => {
    const byLine = new Map<string, Hit[]>();
    for (const hit of hits.slice(0, LIST_CAP)) {
      const list = byLine.get(hit.line) ?? [];
      list.push(hit);
      byLine.set(hit.line, list);
    }
    return [...byLine.entries()];
  }, [hits]);

  if (hits.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          I couldn't find an entry matching “{term.trim()}” in this period. Try a car, a kind of charge, a customer or an amount.
        </p>
      </div>
    );
  }

  const money = (n: number) => formatCurrency(n, currency);

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-4">
      <p className="text-sm text-muted-foreground">
        {hits.length.toLocaleString()} {hits.length === 1 ? 'entry matches' : 'entries match'} “{term.trim()}”
        {hits.length > LIST_CAP ? ` — showing the newest ${LIST_CAP}` : ''}. Change an amount or switch one off right here.
      </p>
      {groups.map(([line, list]) => {
        const total = list.reduce((s, h) => (h.row.excluded ? s : s + (h.kind === 'entry' ? toNumber(h.row.amount) : h.row.amount)), 0);
        return (
          <section key={line} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 pb-1">
              <h3 className="font-heading text-[13px] font-medium tracking-wide text-muted-foreground uppercase">{line}</h3>
              <span className="text-[13px] tabular-nums text-muted-foreground">{money(total)}</span>
            </div>
            {list.map((hit) => (
              <EntryLine
                key={`${hit.kind}:${hit.id}`}
                target={{ kind: hit.kind, id: hit.id }}
                label={hit.label}
                sub={hit.sub}
                amount={hit.kind === 'entry' ? toNumber(hit.row.amount) : hit.row.amount}
                originalAmount={hit.row.originalAmount}
                excluded={hit.row.excluded}
                adjusted={hit.row.adjusted}
                currency={currency}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}
