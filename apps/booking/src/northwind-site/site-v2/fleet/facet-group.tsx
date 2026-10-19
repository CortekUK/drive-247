'use client';

import { Check } from 'lucide-react-nw';
import { useId, useState } from 'react';

import type { Facet } from '@nw/components/fleet/fleet-filters';
import { cn } from '@nw/lib/utils';

/** Longer lists collapse; a fleet with 20 makes must not push price off screen. */
const COLLAPSE_AFTER = 6;

interface FacetGroupProps {
  title: string;
  facets: Facet[];
  selected: string[];
  onToggle: (value: string) => void;
  /** Optional hint under the heading. */
  description?: string;
}

/**
 * v2 of `components/fleet/facet-group.tsx`: one filter dimension, each option
 * with the number of vehicles it would leave visible. Same `role="checkbox"`
 * button rows (the v1 file explains why not a Radix checkbox), same rule that a
 * zero-count option is disabled unless it is the one currently ticked.
 */
export function FacetGroup({ title, facets, selected, onToggle, description }: FacetGroupProps) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);

  if (facets.length === 0) return null;

  const collapsible = facets.length > COLLAPSE_AFTER;
  const visible = collapsible && !expanded ? facets.slice(0, COLLAPSE_AFTER) : facets;

  return (
    <section aria-labelledby={headingId} className="space-y-1.5">
      <h3 id={headingId} className="text-xs font-semibold text-pv-fg">
        {title}
      </h3>
      {description && <p className="text-xs leading-relaxed text-pv-muted-fg">{description}</p>}

      <div role="group" aria-labelledby={headingId} className="-mx-2">
        {visible.map((facet) => {
          const checked = selected.includes(facet.value);
          const disabled = facet.count === 0 && !checked;

          return (
            <button
              key={facet.value}
              type="button"
              role="checkbox"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => onToggle(facet.value)}
              className={cn(
                'flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-[13px] sm:min-h-9 sm:py-1.5',
                'transition-colors duration-200 ease-out motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30',
                disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-pv-row-hover',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors duration-200 ease-out motion-reduce:transition-none',
                  checked ? 'border-pv-primary bg-pv-primary text-pv-primary-fg' : 'border-pv-border bg-pv-card',
                )}
              >
                {checked && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-pv-fg">{facet.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-pv-muted-fg">{facet.count}</span>
            </button>
          );
        })}
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex min-h-11 items-center rounded-md text-xs font-medium text-pv-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 sm:min-h-8"
        >
          {expanded ? 'Show fewer' : `Show all ${facets.length}`}
        </button>
      )}
    </section>
  );
}
