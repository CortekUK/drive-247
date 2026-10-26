'use client';

import { PanelLeftClose } from 'lucide-react-nw';

import { formatMoney } from '@nw/components/fleet/format';
import type { FleetFacets, FleetFilters } from '@nw/components/fleet/fleet-filters';

import { FacetGroup } from './facet-group';
import { PriceRangeField } from './price-range-field';

interface FleetFilterPanelProps {
  facets: FleetFacets;
  filters: FleetFilters;
  onChange: (next: FleetFilters) => void;
  onClear: () => void;
  activeCount: number;
  currencyCode: string | null;
  /** Present only in the desktop rail, where the panel folds away. */
  onCollapse?: () => void;
  /** The phone dialog carries its own title, so it hides this one. */
  hideHeading?: boolean;
}

const toggleValue = (values: string[], value: string): string[] =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

/**
 * v2 of `components/fleet/fleet-filter-panel.tsx`. Every option is derived
 * from the vehicles that came back (`buildFleetFacets`); nothing is hardcoded.
 */
export function FleetFilterPanel({
  facets,
  filters,
  onChange,
  onClear,
  activeCount,
  currencyCode,
  onCollapse,
  hideHeading = false,
}: FleetFilterPanelProps) {
  const section = 'border-t border-pv-border pt-4';

  return (
    <div className="space-y-4">
      {hideHeading ? null : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-semibold text-pv-fg">Filters</p>
          <div className="flex items-center gap-1">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex h-8 items-center rounded-full px-2 text-xs font-medium text-pv-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30"
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
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-pv-muted-fg transition-colors duration-200 ease-out hover:bg-pv-muted hover:text-pv-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none"
              >
                <PanelLeftClose aria-hidden className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className={hideHeading ? undefined : section}>
        <FacetGroup
          title="Category"
          facets={facets.categories}
          selected={filters.categories}
          onToggle={(value) => onChange({ ...filters, categories: toggleValue(filters.categories, value) })}
        />
      </div>

      {facets.priceBounds && facets.priceBounds.min < facets.priceBounds.max && (
        <section className={section}>
          <h3 className="mb-2 text-xs font-semibold text-pv-fg">Daily rate</h3>
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
          facets={[{ value: 'unlimited', label: 'Unlimited mileage available', count: facets.unlimitedCount }]}
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
        <p className={`${section} text-xs leading-relaxed text-pv-muted-fg`}>
          Our rates run from {formatMoney(facets.priceBounds.min, currencyCode)} to{' '}
          {formatMoney(facets.priceBounds.max, currencyCode)} per day.
        </p>
      )}
    </div>
  );
}
