'use client';

import { Check } from 'lucide-react';
import { useId, useState } from 'react';

import { cn } from '@/lib/utils';

import type { Facet } from './fleet-filters';

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
 * One filter dimension: a list of options, each with the number of vehicles it
 * would leave visible.
 *
 * The rows are `role="checkbox"` buttons rather than the shadcn `Checkbox`
 * primitive. Two reasons: the primitive paints its checked state with the
 * indigo `--main-primary` token, which appears nowhere on this site; and a
 * Radix checkbox renders a `<button>`, which a wrapping `<label>` cannot
 * forward clicks to — so the count and the label text would be dead zones.
 */
export function FacetGroup({
  title,
  facets,
  selected,
  onToggle,
  description,
}: FacetGroupProps) {
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);

  if (facets.length === 0) return null;

  const collapsible = facets.length > COLLAPSE_AFTER;
  const visible = collapsible && !expanded ? facets.slice(0, COLLAPSE_AFTER) : facets;

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3
        id={headingId}
        className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-text-subtle"
      >
        {title}
      </h3>
      {description && <p className="text-xs text-brand-text-subtle">{description}</p>}

      <div role="group" aria-labelledby={headingId} className="-mx-1.5">
        {visible.map((facet) => {
          const checked = selected.includes(facet.value);
          // A zero-count option is a dead end — unless it is the one currently
          // ticked, which must stay clickable so it can be un-ticked.
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
                // 44px rows on touch, tightened to the original rhythm from
                // `sm` up where the pointer is precise.
                'flex min-h-11 w-full items-center gap-2.5 rounded-md px-1.5 py-2.5 text-left text-sm transition-colors sm:min-h-0 sm:py-1.5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30',
                disabled
                  ? 'cursor-not-allowed opacity-40'
                  : 'hover:bg-brand-stone/60',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                  checked
                    ? 'border-brand-forest bg-brand-forest text-white'
                    : 'border-brand-border bg-brand-card',
                )}
              >
                {checked && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-brand-text">{facet.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-brand-text-subtle">
                {facet.count}
              </span>
            </button>
          );
        })}
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex min-h-11 items-center rounded-md px-1.5 text-xs font-medium text-brand-text underline underline-offset-4 transition-colors hover:text-brand-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30 sm:min-h-0"
        >
          {expanded ? 'Show fewer' : `Show all ${facets.length}`}
        </button>
      )}
    </section>
  );
}
