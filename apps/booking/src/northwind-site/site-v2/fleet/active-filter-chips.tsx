'use client';

import { X } from 'lucide-react-nw';

import type { ActiveFilter } from '@nw/components/fleet/fleet-filters';

interface ActiveFilterChipsProps {
  chips: ActiveFilter[];
  onRemove: (chip: ActiveFilter) => void;
  onClear: () => void;
}

/**
 * v2 of `components/fleet/active-filter-chips.tsx`: the chips that make the
 * current query legible. Each removes exactly its own condition (the removal
 * lives on the chip, from `fleet-filters.ts`).
 */
export function ActiveFilterChips({ chips, onRemove, onClear }: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-pv-muted-fg">Filtered by</span>

      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onRemove(chip)}
          aria-label={`Remove filter: ${chip.label}`}
          className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-pv-tint py-1 pl-3 pr-2 text-xs font-medium text-pv-primary transition-colors duration-200 ease-out hover:bg-pv-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none sm:min-h-8"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <X aria-hidden className="size-3.5 shrink-0" />
        </button>
      ))}

      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-11 items-center rounded-full px-2 text-xs font-medium text-pv-link transition-colors duration-200 ease-out hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none sm:min-h-8"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
