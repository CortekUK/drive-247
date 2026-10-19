"use client";

import { ArrowRight, Car } from "lucide-react-nw";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@nw/components/ui/button";
import { Skeleton } from "@nw/components/ui/skeleton";
import { toFleetVehicle } from "@nw/components/fleet/fleet-vehicle";
import { useTenant } from "@nw/contexts/TenantContext";
import { useVehicles } from "@nw/hooks/use-vehicles";
import { DEFAULT_BOOKING_HEADER } from "@nw/lib/cms/defaults";
import { Editable } from "@nw/lib/cms/editable";
import { cn } from "@nw/lib/utils";
import { CARD, ICON_TILE } from "@nw/site-v2/kit";
import { VehicleCard } from "@nw/site-v2/sections/vehicle-card";

/** How many cars the strip previews before sending people to /fleet. */
const PREVIEW_LIMIT = 8;
/** Phones see the first four; the rest are one tap away on /fleet. */
const PHONE_LIMIT = 4;

const ALL_MAKES = "__all__";

type FleetStripProps = {
  allMakesLabel?: string;
  viewAllText?: string;
  emptyText?: string;
  errorText?: string;
};

/**
 * v2 of `components/sections/fleet-strip.tsx` — same props, same CMS marks,
 * same data (`useVehicles()` + `toFleetVehicle`).
 *
 * v1 is a horizontal carousel with its own scroll machinery. v2 is a calm grid
 * (four across on desktop, two on tablets, four stacked on phones), so there is
 * nothing to scroll and nothing to measure. The make pills still filter, built
 * from the makes the tenant actually owns.
 */
export function FleetStrip({ allMakesLabel, viewAllText, emptyText, errorText }: FleetStripProps = {}) {
  const { tenant } = useTenant();
  const { vehicles, isLoading, isError } = useVehicles();
  const [activeMake, setActiveMake] = useState<string>(ALL_MAKES);

  const fleet = useMemo(() => vehicles.map(toFleetVehicle), [vehicles]);

  /** Makes present in the fleet, with a count each. Derived, never hardcoded. */
  const makes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const vehicle of fleet) {
      if (!vehicle.make) continue;
      counts.set(vehicle.make, (counts.get(vehicle.make) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [fleet]);

  const visible = useMemo(() => {
    const filtered = activeMake === ALL_MAKES ? fleet : fleet.filter((vehicle) => vehicle.make === activeMake);
    return filtered.slice(0, PREVIEW_LIMIT);
  }, [fleet, activeMake]);

  const showSkeleton = isLoading && fleet.length === 0;
  const showEmpty = !isLoading && fleet.length === 0;

  const allLabel = allMakesLabel?.trim() ? allMakesLabel.trim() : DEFAULT_BOOKING_HEADER.all_makes_label;
  const viewAll = viewAllText?.trim() ? viewAllText.trim() : DEFAULT_BOOKING_HEADER.view_all_text;
  const empty = emptyText?.trim() ? emptyText.trim() : DEFAULT_BOOKING_HEADER.empty_text;
  const error = errorText?.trim() ? errorText.trim() : DEFAULT_BOOKING_HEADER.error_text;

  return (
    <>
      {makes.length > 1 && (
        <div role="group" aria-label="Filter by make" className="mt-5 flex flex-wrap items-center gap-2">
          <MakePill
            label={allLabel}
            cmsPath="home.booking_header.all_makes_label"
            count={fleet.length}
            active={activeMake === ALL_MAKES}
            onClick={() => setActiveMake(ALL_MAKES)}
          />
          {makes.map((make) => (
            <MakePill
              key={make.name}
              label={make.name}
              count={make.count}
              active={activeMake === make.name}
              onClick={() => setActiveMake(make.name)}
            />
          ))}
        </div>
      )}

      {showEmpty ? (
        <div className={cn(CARD, "mt-5 flex flex-col items-center gap-3 px-6 py-12 text-center")}>
          <span className={cn(ICON_TILE, "size-12 rounded-2xl")}>
            <Car aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <p className="max-w-sm text-[14px] text-pv-muted-fg">
            {isError ? (
              <Editable path="home.booking_header.error_text">{error}</Editable>
            ) : (
              <Editable path="home.booking_header.empty_text">{empty}</Editable>
            )}
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {showSkeleton
            ? Array.from({ length: PHONE_LIMIT }, (_, index) => (
                <div key={index} aria-hidden className={cn(CARD, "p-3")}>
                  <Skeleton className="aspect-[16/10] w-full rounded-xl bg-pv-tint" />
                  <Skeleton className="mt-3 h-4 w-2/3 bg-pv-tint" />
                  <Skeleton className="mt-2 h-3 w-1/2 bg-pv-tint" />
                </div>
              ))
            : visible.map((vehicle, index) => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  currencyCode={tenant?.currency_code ?? null}
                  distanceUnit={tenant?.distance_unit ?? null}
                  className={index >= PHONE_LIMIT ? "max-sm:hidden" : undefined}
                />
              ))}
        </div>
      )}

      <div className="mt-6 flex justify-center">
        <Button asChild variant="brand-outline" className="h-11 px-5">
          <Link href="/fleet">
            <Editable path="home.booking_header.view_all_text">{viewAll}</Editable>
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Button>
      </div>
    </>
  );
}

/** A filter pill: 44px on touch, 36px once there is room. */
function MakePill({
  label,
  cmsPath,
  count,
  active,
  onClick,
}: {
  label: string;
  /** Only the "All" pill is CMS copy — the rest are the makes in the fleet. */
  cmsPath?: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition-colors duration-200 ease-out sm:h-9",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-primary/30 motion-reduce:transition-none",
        active
          ? "border-pv-primary/30 bg-pv-tint text-pv-primary"
          : "border-pv-border bg-pv-card text-pv-muted-fg hover:bg-pv-hover hover:text-pv-fg",
      )}
    >
      {cmsPath ? <Editable path={cmsPath}>{label}</Editable> : label}
      <span className="text-xs tabular-nums opacity-70">{count}</span>
    </button>
  );
}
