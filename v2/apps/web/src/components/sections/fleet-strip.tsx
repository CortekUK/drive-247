"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { VehicleCard } from "@/components/cards/vehicle-card";
import { FleetCardSkeleton } from "@/components/fleet/fleet-skeletons";
import { toFleetVehicle } from "@/components/fleet/fleet-vehicle";
import { useTenant } from "@/contexts/TenantContext";
import { useVehicles } from "@/hooks/use-vehicles";
import { cn } from "@/lib/utils";

/** How many cars the home-page strip previews before sending people to /fleet. */
const PREVIEW_LIMIT = 8;

const ALL_MAKES = "__all__";

/**
 * The interactive body of the home-page fleet strip: the make pills, the
 * horizontal card scroller and the link out to /fleet.
 *
 * Split out of `fleet-section.tsx` so the heading above it can be a Server
 * Component and read the operator's copy from the CMS during the render rather
 * than after hydration. Everything below the heading genuinely needs the
 * browser — `activeMake` is local state — so the client boundary starts here
 * and no lower.
 *
 * Two prototype bugs died in this component:
 *
 *  1. the brand pills were decorative — the strip mapped the whole static
 *     `FLEET` fixture regardless of which pill was active, so clicking one
 *     changed the highlight and nothing else. The pills now filter, and they
 *     are built from the makes the tenant actually owns rather than a fixed
 *     list of six luxury marques;
 *  2. `BrandIcon` switched on six hardcoded slugs and returned `null` for
 *     anything else, so every real make — Tesla, Toyota, Ford, Rolls-Royce —
 *     rendered an invisible icon. Unknown makes now get the house mark.
 */
export function FleetStrip() {
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
    const filtered =
      activeMake === ALL_MAKES
        ? fleet
        : fleet.filter((vehicle) => vehicle.make === activeMake);
    return filtered.slice(0, PREVIEW_LIMIT);
  }, [fleet, activeMake]);

  const showSkeleton = isLoading && fleet.length === 0;
  const showEmpty = !isLoading && fleet.length === 0;

  return (
    <>
      {makes.length > 1 && (
        <div
          role="group"
          aria-label="Filter by make"
          className="mt-10 flex flex-wrap items-center justify-center gap-1"
        >
          <MakePill
            label="All"
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

      <div className="-mx-6 mt-10 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-3">
          {showSkeleton
            ? Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="w-[210px] shrink-0">
                  <FleetCardSkeleton />
                </div>
              ))
            : visible.map((vehicle) => (
                <VehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  currencyCode={tenant?.currency_code ?? null}
                  distanceUnit={tenant?.distance_unit ?? null}
                  className="w-[210px] shrink-0"
                />
              ))}
        </div>
      </div>

      {showEmpty && (
        <p className="mt-6 text-center text-sm text-brand-text-soft">
          {isError
            ? "We could not load the fleet just now — please try again shortly."
            : "New vehicles are being added to this fleet."}
        </p>
      )}

      <div className="mt-8 flex justify-center">
        <Link
          href="/fleet"
          className="inline-flex items-center gap-2 rounded-full border border-brand-border bg-white px-5 py-2.5 text-sm font-medium text-brand-text transition-colors hover:bg-brand-stone focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-forest/25"
        >
          View all vehicles
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </>
  );
}

function MakePill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
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
        "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-forest/30",
        active
          ? "border border-brand-border-soft bg-white text-brand-text shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          : "border border-transparent text-brand-text-subtle hover:text-brand-text",
      )}
    >
      <BrandIcon make={label} active={active} />
      {label}
      <span className="text-xs tabular-nums text-brand-text-subtle">{count}</span>
    </button>
  );
}

/** "Aston Martin" -> "aston-martin", so the icon map can key off a real make. */
function makeSlug(make: string): string {
  return make.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function BrandIcon({ make, active }: { make: string; active: boolean }) {
  const color = active ? "#111210" : "#8a8c88";

  switch (makeSlug(make)) {
    case "bentley":
      return (
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
          <path
            d="M1 7 L5 3 L9 5 L13 3 L17 7 L13 11 L9 9 L5 11 L1 7Z"
            stroke={color}
            strokeWidth="0.6"
          />
          <circle cx="9" cy="7" r="1" fill={color} />
        </svg>
      );
    case "aston-martin":
      return (
        <svg width="20" height="10" viewBox="0 0 20 10" fill="none" aria-hidden>
          <path
            d="M10 5 L1 3 L4 5 L1 7 L10 5 L19 3 L16 5 L19 7 L10 5Z"
            stroke={color}
            strokeWidth="0.6"
          />
          <circle cx="10" cy="5" r="0.9" fill={color} />
        </svg>
      );
    case "audi":
      return (
        <svg width="22" height="10" viewBox="0 0 22 10" fill="none" aria-hidden>
          <circle cx="4" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="8.5" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="13" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
          <circle cx="17.5" cy="5" r="3.2" stroke={color} strokeWidth="0.6" />
        </svg>
      );
    case "bmw":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="0.7" />
          <path d="M7 1 V7 L13 7" stroke={color} strokeWidth="0.7" />
          <path d="M7 13 V7 L1 7" stroke={color} strokeWidth="0.7" />
        </svg>
      );
    case "chevrolet":
      return (
        <svg width="18" height="10" viewBox="0 0 18 10" fill="none" aria-hidden>
          <path
            d="M1 4 H7 V1 H11 V4 H17 V6 H11 V9 H7 V6 H1 Z"
            stroke={color}
            strokeWidth="0.6"
            fill="none"
          />
        </svg>
      );
    case "lexus":
      return (
        <svg width="20" height="12" viewBox="0 0 20 12" fill="none" aria-hidden>
          <ellipse cx="10" cy="6" rx="8" ry="5" stroke={color} strokeWidth="0.6" />
          <path d="M11 3 L8 8 H13" stroke={color} strokeWidth="0.6" />
        </svg>
      );
    default:
      // The house mark. Previously `null`, which meant every make outside the
      // six hardcoded slugs rendered nothing at all.
      return (
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden>
          <circle cx="8" cy="6" r="4.6" stroke={color} strokeWidth="0.6" />
          <circle cx="8" cy="6" r="1.1" fill={color} />
        </svg>
      );
  }
}
