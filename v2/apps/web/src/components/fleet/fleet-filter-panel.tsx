'use client';

import { PanelLeftClose } from 'lucide-react';

import { FacetGroup } from './facet-group';
import { formatMoney } from './format';
import { PriceRangeField } from './price-range-field';
import type { FleetFacets, FleetFilters } from './fleet-filters';

interface FleetFilterPanelProps {
  facets: FleetFacets;
  filters: FleetFilters;
  onChange: (next: FleetFilters) => void;
  onClear: () => void;
  activeCount: number;
  currencyCode: string | null;
  /**
   * Present only in the desktop rail, where the panel can be folded away to
   * give the grid its width back. Absent inside the mobile sheet, which is
   * dismissed by its own close button instead.
   */
  onCollapse?: () => void;
}

const toggleValue = (values: string[], value: string): string[] =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

/**
 * The filter rail. Every option in it is derived from the vehicles that came
 * back — the category list, the fuel list, the makes, and both ends of the
 * price track. Nothing is hardcoded, which is the whole point: v1's fleet
 * filter shipped six invented category names and a fixed 0–1000 price slider,
 * and neither survived contact with real rows.
 */
export function FleetFilterPanel({
  facets,
  filters,
  onChange,
  onClear,
  activeCount,
  currencyCode,
  onCollapse,
}: FleetFilterPanelProps) {
  const section = 'border-t border-brand-border-soft pt-5';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-brand-text">Filters</h2>
        <div className="flex items-center gap-1">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex min-h-11 items-center rounded-full px-2 py-1 text-xs font-medium text-brand-text-soft underline underline-offset-4 transition-colors hover:text-brand-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30 sm:min-h-0"
            >
              Clear all
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Hide filters"
              title="Hide filters"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-brand-text-subtle transition-colors hover:bg-brand-stone hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30"
            >
              <PanelLeftClose aria-hidden className="size-4" />
            </button>
          )}
        </div>
      </div>

      <FacetGroup
        title="Category"
        facets={facets.categories}
        selected={filters.categories}
        onToggle={(value) =>
          onChange({ ...filters, categories: toggleValue(filters.categories, value) })
        }
      />

      {facets.priceBounds && facets.priceBounds.min < facets.priceBounds.max && (
        <section className={section}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-brand-text-subtle">
            Daily rate
          </h3>
          <PriceRangeField
            bounds={facets.priceBounds}
            min={filters.minPrice}
            max={filters.maxPrice}
            currencyCode={currencyCode}
            onChange={(next) => onChange({ ...filters, minPrice: next.min, maxPrice: next.max })}
          />
        </section>
      )}

      {facets.fuels.length > 0 && (
        <div className={section}>
          <FacetGroup
            title="Fuel"
            facets={facets.fuels}
            selected={filters.fuels}
            onToggle={(value) => onChange({ ...filters, fuels: toggleValue(filters.fuels, value) })}
          />
        </div>
      )}

      <div className={section}>
        <FacetGroup
          title="Mileage"
          facets={[
            {
              value: 'unlimited',
              label: 'Unlimited mileage available',
              count: facets.unlimitedCount,
            },
          ]}
          selected={filters.unlimitedOnly ? ['unlimited'] : []}
          onToggle={() => onChange({ ...filters, unlimitedOnly: !filters.unlimitedOnly })}
          description="Cars where the unlimited-mileage upgrade can be added at checkout."
        />
      </div>

      {facets.makes.length > 1 && (
        <div className={section}>
          <FacetGroup
            title="Make"
            facets={facets.makes}
            selected={filters.makes}
            onToggle={(value) => onChange({ ...filters, makes: toggleValue(filters.makes, value) })}
          />
        </div>
      )}

      {facets.priceBounds && (
        <p className={`${section} text-xs text-brand-text-subtle`}>
          Fleet rates run from {formatMoney(facets.priceBounds.min, currencyCode)} to{' '}
          {formatMoney(facets.priceBounds.max, currencyCode)} per day.
        </p>
      )}
    </div>
  );
}
