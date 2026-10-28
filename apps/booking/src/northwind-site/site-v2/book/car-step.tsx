"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown, Fuel, Gauge, Search, SlidersHorizontal, X } from "lucide-react-nw";

import { formatMileage } from "@nw/components/fleet/format";
import type { FleetVehicle } from "@nw/components/fleet/fleet-vehicle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nw/components/ui/select";
import { Skeleton } from "@nw/components/ui/skeleton";
import { useTenantBranding } from "@nw/hooks/use-tenant-branding";
import { cn } from "@nw/lib/utils";
import { ActiveFilterChips } from "@nw/site-v2/fleet/active-filter-chips";
import { PriceRangeField } from "@nw/site-v2/fleet/price-range-field";
import { CarFloor, IllustratedCar } from "@nw/site-v2/illustrations/home-scenes";

import { CAR_SORTS, type BookingFlow, type CarSort, type PricedCar } from "./use-booking-flow";

/**
 * Step 2: the car. Only cars free for the whole trip are offered, each with
 * its price for the trip (not just a day rate), so choosing is comparing
 * totals. Search, sort, the category chips and the inline filter tray (over
 * the fleet page's facet logic) narrow the list; cars booked on
 * these dates are listed under it, greyed, so nothing silently disappears.
 * Choosing a car fills the overview; the footer carries on to checkout.
 */

const PILL =
  "h-11 rounded-full border border-pv-border bg-pv-card text-base text-pv-fg outline-none sm:h-10 sm:text-sm " +
  "transition-colors duration-200 ease-out hover:border-pv-fg/20 focus-visible:border-pv-primary focus-visible:ring-3 focus-visible:ring-pv-primary/15 motion-reduce:transition-none";

export function CarStep({ flow }: { flow: BookingFlow }) {
  const [filtersOpen, setFiltersOpen] = useState(false);

  if (flow.carsLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-[300px] w-full rounded-2xl bg-pv-muted" />
        ))}
      </div>
    );
  }
  if (flow.carsError) {
    return <Notice title="We couldn't load the cars" body="Please try again in a moment." />;
  }
  if (flow.cars.length === 0) {
    return (
      <Notice title="Nothing is free on those dates" body="Try moving your trip by a day or two." action={{ label: "Change dates", onClick: () => flow.goTo("trip") }} />
    );
  }

  return (
    <div className="space-y-4">
      {/* Search, filters, sort. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative min-w-0 md:flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-pv-muted-fg" />
          <input
            type="search"
            value={flow.filters.search}
            onChange={(event) => flow.setFilters({ ...flow.filters, search: event.target.value })}
            placeholder="Search brand, model or colour…"
            aria-label="Search the cars"
            className={cn(PILL, "w-full pl-10 pr-11 placeholder:text-pv-muted-fg/80 [&::-webkit-search-cancel-button]:hidden")}
          />
          {flow.filters.search !== "" ? (
            <button
              type="button"
              onClick={() => flow.setFilters({ ...flow.filters, search: "" })}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-pv-muted-fg hover:bg-pv-muted hover:text-pv-fg"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="car-filters"
            className={cn(
              PILL,
              "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 px-4 text-sm font-medium",
              filtersOpen && "border-pv-fg bg-pv-fg text-pv-card hover:border-pv-fg",
            )}
          >
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters
            {flow.activeFilterCount > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-pv-primary px-1.5 text-xs font-semibold tabular-nums text-pv-primary-fg">
                {flow.activeFilterCount}
              </span>
            ) : null}
            <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", filtersOpen && "rotate-180")} />
          </button>
          <Select value={flow.sort} onValueChange={(value) => flow.setSort(value as CarSort)}>
            <SelectTrigger
              aria-label="Sort cars"
              className={cn(
                PILL,
                "min-w-0 flex-1 cursor-pointer gap-1 px-4 text-sm shadow-none data-[size=default]:h-11 sm:data-[size=default]:h-10 md:w-[168px] md:flex-none",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-pv-border bg-pv-card p-0 text-pv-fg shadow-lg">
              {CAR_SORTS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="cursor-pointer rounded-lg py-2 text-[13px] focus:bg-pv-hover focus:text-pv-fg">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* The rest of the filters open here, in the page, above the cars they narrow. */}
      <FilterTray flow={flow} open={filtersOpen} onClose={() => setFiltersOpen(false)} />

      {/* The categories, one tap each. */}
      {flow.facets.categories.length > 1 ? (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <CategoryChip active={flow.filters.categories.length === 0} onClick={() => flow.setFilters({ ...flow.filters, categories: [] })}>
            All <span className="tabular-nums opacity-60">{flow.cars.length}</span>
          </CategoryChip>
          {flow.facets.categories.map((facet) => {
            const active = flow.filters.categories.includes(facet.value);
            return (
              <CategoryChip
                key={facet.value}
                active={active}
                disabled={facet.count === 0 && !active}
                onClick={() =>
                  flow.setFilters({
                    ...flow.filters,
                    categories: active ? flow.filters.categories.filter((c) => c !== facet.value) : [...flow.filters.categories, facet.value],
                  })
                }
              >
                {facet.label} <span className="tabular-nums opacity-60">{facet.count}</span>
              </CategoryChip>
            );
          })}
        </div>
      ) : null}

      <ActiveFilterChips chips={flow.chips} onRemove={flow.removeChip} onClear={flow.clearFilters} />

      <p aria-live="polite" className="px-1 text-[13px] text-pv-muted-fg">
        <span className="font-semibold text-pv-fg">
          {flow.results.length} of {flow.cars.length}
        </span>{" "}
        {flow.cars.length === 1 ? "car is" : "cars are"} free for your {flow.days}-day trip
      </p>

      {flow.results.length === 0 ? (
        <Notice title="No car matches those filters" body="Take one off to see more." action={{ label: "Clear filters", onClick: flow.clearFilters }} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {flow.results.map((car, i) => (
            <li key={car.vehicle.id} className="qb-rise-in" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
              <CarOption flow={flow} car={car} selected={flow.chosen?.vehicle.id === car.vehicle.id} />
            </li>
          ))}
        </ul>
      )}

      <BookedCars cars={flow.bookedCars} onChangeDates={() => flow.goTo("trip")} />
    </div>
  );
}

const toggle = (values: string[], value: string) => (values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

/**
 * The filters, inline: a tray that unfolds under the search bar — fuel,
 * mileage, make and the daily rate side by side, each a row of chips you tap
 * on and off. The list under it updates as you go; there is nothing to apply.
 * (Category stays in its own chip row, always in view.)
 */
function FilterTray({ flow, open, onClose }: { flow: BookingFlow; open: boolean; onClose: () => void }) {
  const { facets, filters, setFilters } = flow;
  const showPrice = !!facets.priceBounds && facets.priceBounds.min < facets.priceBounds.max;

  return (
    <div
      id="car-filters"
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
      )}
      // A folded tray is out of the tab order. (`inert` is not in React 18's types.)
      {...(open ? {} : ({ inert: true } as Record<string, boolean>))}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="rounded-[24px] border border-pv-border bg-pv-card p-4 sm:p-5">
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {facets.fuels.length > 0 ? (
              <TrayGroup title="Fuel">
                {facets.fuels.map((facet) => (
                  <TrayChip
                    key={facet.value}
                    active={filters.fuels.includes(facet.value)}
                    count={facet.count}
                    onClick={() => setFilters({ ...filters, fuels: toggle(filters.fuels, facet.value) })}
                  >
                    {facet.label}
                  </TrayChip>
                ))}
              </TrayGroup>
            ) : null}

            {/* Only filters that would leave something: no dead options. */}
            {facets.unlimitedCount > 0 || filters.unlimitedOnly ? (
              <TrayGroup title="Mileage">
                <TrayChip active={filters.unlimitedOnly} count={facets.unlimitedCount} onClick={() => setFilters({ ...filters, unlimitedOnly: !filters.unlimitedOnly })}>
                  Unlimited available
                </TrayChip>
              </TrayGroup>
            ) : null}

            {facets.makes.length > 1 ? (
              <TrayGroup title="Make">
                {facets.makes.map((facet) => (
                  <TrayChip
                    key={facet.value}
                    active={filters.makes.includes(facet.value)}
                    count={facet.count}
                    onClick={() => setFilters({ ...filters, makes: toggle(filters.makes, facet.value) })}
                  >
                    {facet.label}
                  </TrayChip>
                ))}
              </TrayGroup>
            ) : null}

            {showPrice && facets.priceBounds ? (
              <TrayGroup title="Daily rate">
                <div className="w-full">
                  <PriceRangeField
                    bounds={facets.priceBounds}
                    min={filters.minPrice}
                    max={filters.maxPrice}
                    currencyCode={flow.currencyCode}
                    onChange={(next) => setFilters({ ...filters, minPrice: next.min, maxPrice: next.max })}
                  />
                </div>
              </TrayGroup>
            ) : null}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-pv-border pt-4">
            <button
              type="button"
              onClick={flow.clearFilters}
              disabled={flow.activeFilterCount === 0}
              className="h-9 cursor-pointer rounded-full px-3 text-[13px] font-semibold text-pv-fg hover:bg-pv-muted disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Clear filters
            </button>
            <button type="button" onClick={onClose} className="h-9 cursor-pointer rounded-full bg-pv-muted px-4 text-[13px] font-semibold text-pv-fg hover:bg-pv-tint">
              Hide filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrayGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-[13px] font-semibold text-pv-fg">{title}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function TrayChip({ active, count, onClick, children }: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={count === 0 && !active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        active ? "border-pv-primary bg-pv-tint text-pv-primary" : "border-pv-border bg-pv-card text-pv-fg hover:border-pv-fg/25",
      )}
    >
      {active ? <Check aria-hidden className="size-3.5" strokeWidth={2.5} /> : null}
      {children}
      <span className="tabular-nums opacity-60">{count}</span>
    </button>
  );
}

function CategoryChip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-pv-fg text-pv-card" : "bg-pv-muted text-pv-fg hover:bg-pv-tint",
      )}
    >
      {children}
    </button>
  );
}

/** One car: photo (or the drawn car), what it is, what it costs for this trip, and a tick when chosen. */
function CarOption({ flow, car, selected }: { flow: BookingFlow; car: PricedCar; selected: boolean }) {
  const { formatCurrency } = useTenantBranding();
  const { fleet: v, quote } = car;
  const artId = `nwbf${v.id.replace(/[^a-zA-Z0-9]/g, "")}`;
  const meta = [v.categoryLabel, v.year, v.colour].filter((part) => part != null && part !== "").join(" · ");
  const perDay = quote.rentalDays > 0 ? quote.vehicleTotal / quote.rentalDays : null;
  const mileage = v.mileageIsUnlimited ? "Unlimited mileage" : v.dailyMileage != null ? `${formatMileage(v.dailyMileage, flow.distanceUnit)} a day included` : null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => flow.chooseCar(selected ? null : v.id)}
      className={cn(
        "group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-2xl border-2 bg-pv-card text-left transition-colors duration-200 outline-none focus-visible:ring-4 focus-visible:ring-pv-primary/20 motion-reduce:transition-none",
        selected ? "border-pv-primary" : "border-pv-border hover:border-pv-primary/40",
      )}
    >
      <span className="relative block aspect-[16/10] overflow-hidden bg-pv-tint/60">
        {v.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
          <img
            src={v.photoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.05] motion-reduce:transition-none"
          />
        ) : (
          <>
            <CarFloor className="absolute inset-x-0 bottom-0 h-[50%] w-full text-[#d6d4e6] dark:text-[#3f3f46]" />
            <span className="absolute inset-0 flex items-end justify-center pb-[13%]">
              <IllustratedCar id={artId} className="w-[78%]" />
            </span>
          </>
        )}
        <span
          aria-hidden
          className={cn(
            "absolute right-3 top-3 grid size-8 place-items-center rounded-full transition-all duration-200",
            selected ? "qb-pop-text bg-pv-primary text-pv-primary-fg" : "bg-pv-card/90 text-transparent ring-1 ring-pv-border",
          )}
        >
          <Check className="size-4" strokeWidth={3} />
        </span>
      </span>

      <span className="flex flex-1 flex-col p-4 sm:p-5">
        <span className="block truncate text-[17px] font-bold tracking-[-0.02em] text-pv-fg">{v.name}</span>
        {meta !== "" ? <span className="mt-0.5 block truncate text-[13px] text-pv-muted-fg">{meta}</span> : null}

        <span className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-pv-muted-fg">
          {v.fuelType ? (
            <span className="inline-flex items-center gap-1.5">
              <Fuel aria-hidden className="size-3.5" />
              {v.fuelType.charAt(0).toUpperCase() + v.fuelType.slice(1)}
            </span>
          ) : null}
          {mileage ? (
            <span className="inline-flex items-center gap-1.5">
              <Gauge aria-hidden className="size-3.5" />
              {mileage}
            </span>
          ) : null}
        </span>

        <span className="mt-auto flex items-end justify-between gap-3 pt-4">
          <span className="leading-none">
            <span className="block text-[22px] font-extrabold tabular-nums tracking-[-0.02em] text-pv-fg">{formatCurrency(quote.grandTotal)}</span>
            <span className="mt-1 block text-[12px] text-pv-muted-fg">
              total for {quote.rentalDays} {quote.rentalDays === 1 ? "day" : "days"}
              {perDay !== null ? ` · ${formatCurrency(perDay)}/day` : ""}
            </span>
          </span>
          <span
            className={cn(
              "inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold transition-colors duration-200",
              selected ? "bg-pv-primary text-pv-primary-fg" : "bg-pv-muted text-pv-fg group-hover:bg-pv-tint",
            )}
          >
            {selected ? "Selected" : "Select"}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Cars booked on these dates: listed, greyed, so the customer knows they exist. */
function BookedCars({ cars, onChangeDates }: { cars: FleetVehicle[]; onChangeDates: () => void }) {
  const [open, setOpen] = useState(false);
  if (cars.length === 0) return null;
  return (
    <div className="rounded-2xl border border-dashed border-pv-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left sm:px-5"
      >
        <CalendarDays aria-hidden className="size-4 shrink-0 text-pv-muted-fg" />
        <span className="min-w-0 flex-1 text-[13px] text-pv-muted-fg">
          <span className="font-semibold text-pv-fg">
            {cars.length} {cars.length === 1 ? "car is" : "cars are"} booked
          </span>{" "}
          on your dates
        </span>
        <ChevronDown aria-hidden className={cn("size-4 text-pv-muted-fg transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="qb-rise-in space-y-3 border-t border-dashed border-pv-border px-4 pb-4 pt-3 sm:px-5">
          <ul className="grid gap-2 sm:grid-cols-2">
            {cars.map((v) => (
              <li key={v.id} className="flex items-center gap-3 rounded-xl bg-pv-muted/60 p-2 opacity-70">
                <span className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-pv-card">
                  {v.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- operator-supplied hosts
                    <img src={v.photoUrl} alt="" loading="lazy" className="size-full object-cover grayscale" />
                  ) : (
                    <IllustratedCar id={`nwbk${v.id.replace(/[^a-zA-Z0-9]/g, "")}`} className="w-[86%]" />
                  )}
                </span>
                <span className="min-w-0 truncate text-[13px] font-medium text-pv-fg">{v.name}</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onChangeDates} className="cursor-pointer text-[13px] font-semibold text-pv-link hover:underline">
            Try other dates
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Notice({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="rounded-2xl border border-pv-border bg-pv-card px-6 py-10 text-center">
      <p className="text-[16px] font-semibold text-pv-fg">{title}</p>
      <p className="mt-1.5 text-[14px] text-pv-muted-fg">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 h-10 cursor-pointer rounded-full bg-pv-muted px-5 text-[13px] font-semibold text-pv-fg hover:bg-pv-tint"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
