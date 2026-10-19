'use client';

/**
 * The bookings filter — the operator ui-v2 TabsList pill (a muted track, the
 * active option lifted onto the card colour), drawn as a group of toggle
 * buttons rather than Radix tabs: there is one list and three predicates, not
 * three panels, so modelling it as tabpanels would put three copies of the same
 * subtree in the accessibility tree. One size up from the operator's (h-10, not
 * h-9) because a customer taps it on a phone.
 */

import { cn } from '@nw/lib/utils';

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  counts,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Omitted while loading, so a tab never states a count it does not have. */
  counts?: Record<T, number>;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-10 w-full items-center gap-1 rounded-full bg-pv-muted p-1 sm:w-fit"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-full flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-medium sm:flex-none',
              'transition-colors duration-200 ease-in hover:ease-out motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-ring/50',
              active ? 'bg-pv-card text-pv-fg' : 'text-pv-fg/60 hover:text-pv-fg',
            )}
          >
            {option.label}
            {counts ? (
              <span className={cn('tabular-nums', active ? 'text-pv-muted-fg' : 'text-pv-fg/40')}>
                {counts[option.value]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
