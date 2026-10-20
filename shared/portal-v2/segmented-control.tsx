"use client";

/**
 * The v2 segmented control: the operator sidebar's Portal / Website switch
 * (apps/portal/src/components/shared/layout/app-sidebar-v2.tsx) for any number
 * of options, on the ui-v2 TabsList's muted track. A white pill with a faint
 * purple ring slides under the chosen option; the chosen label turns purple;
 * each label carries a small round badge beside it (there a shortcut, here a
 * count), purple on the chosen option and a faint grey on the rest.
 *
 * A group of toggle buttons, not tabs: it picks a predicate over ONE list
 * rather than switching panels, so tabpanels would put copies of the same
 * subtree in the accessibility tree.
 */

import { cn } from "./cn";

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  counts,
  label,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Omitted while loading, so an option never states a count it does not have. */
  counts?: Partial<Record<T, number>>;
  /** The group's accessible name. */
  label: string;
  className?: string;
}) {
  const n = Math.max(1, options.length);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("relative grid rounded-full bg-v2-muted p-1", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {/* The sliding pill: one column wide, moved by whole columns. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-v2-card shadow-sm ring-1 ring-v2-primary/20 transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 8px) / ${n})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((option) => {
        const active = option.value === value;
        const count = counts?.[option.value];
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative z-10 flex h-8 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium",
              "transition-colors duration-200 motion-reduce:transition-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-ring/50",
              active ? "text-v2-link" : "text-v2-muted-fg hover:text-v2-fg",
            )}
          >
            <span>{option.label}</span>
            {count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums transition-colors",
                  active ? "bg-v2-primary/15 text-v2-link" : "bg-v2-fg/10 text-v2-fg/70",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
