'use client';

import { X } from 'lucide-react';

import type { ActiveFilter } from './fleet-filters';

interface ActiveFilterChipsProps {
  chips: ActiveFilter[];
  onRemove: (chip: ActiveFilter) => void;
  onClear: () => void;
}

/**
 * The chips that make the current query legible.
 *
 * Without them a customer who ticked "Electric" three screens ago has no way to
 * tell why the fleet looks small — the rail is off-screen on mobile and
 * scrolled away on desktop. Each chip removes exactly its own condition; the
 * removal logic lives on the chip so this component never has to know which
 * dimension it came from.
 */
export function ActiveFilterChips({ chips, onRemove, onClear }: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    // `min-w-0` on the chips plus `truncate` on the label is what keeps a long
    // category name (or a wide price range) from pushing the row past a 360px
    // viewport instead of wrapping inside it.
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-brand-text-subtle">
        Filtered by
      </span>

      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onRemove(chip)}
          aria-label={`Remove filter: ${chip.label}`}
          className="inline-flex min-h-11 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-brand-border bg-brand-card py-1 pl-3 pr-2 text-xs font-medium text-brand-text transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30 sm:min-h-8"
        >
          <span className="min-w-0 truncate">{chip.label}</span>
          <X aria-hidden className="size-3.5 shrink-0 text-brand-text-subtle" />
        </button>
      ))}

      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-11 items-center rounded-full px-2 py-1 text-xs font-medium text-brand-text-soft underline underline-offset-4 transition-colors hover:text-brand-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30 sm:min-h-8"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
