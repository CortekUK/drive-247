"use client";

import { type ReactNode } from "react";
import { Activity, CalendarDays, Car, HeartPulse, TrendingUp, Users } from "lucide-react";
import { FilterChip, FilterSection, FilterShell } from "@/components/shared/filter-primitives";

/**
 * The Fleet Management filter panel — the BACK face of the stat-cards row.
 *
 * v2 chrome only. The vehicles page is a shared v1 page, and it mounts this
 * only when `useV2("chrome")` is true; every other tenant keeps the inline
 * search box and dropdowns exactly as they were.
 *
 * No filtering lives here. The panel writes the page's own `filters` state
 * through the page's own `updateFilters`, with the same values the old
 * dropdowns wrote ('all' meaning "no filter"), so the URL it serialises to and
 * the list it produces are unchanged.
 */

/** The slice of the page's `FiltersState` this panel reads and writes. */
export interface VehicleFilterValues {
  search: string;
  status: string;
  make: string;
  year: string;
  performance: "all" | "profitable" | "loss";
  ownership: string; // 'all' | 'own' | 'managed' | <owner_id>
  health: "all" | "needs_attention" | "not_road_legal" | "overdue" | "unknown";
}

/** Same values the v1 Status dropdown offers; colours are the design-system status set. */
const STATUS_OPTIONS = [
  { value: "all", label: "All", color: null },
  { value: "available", label: "Available", color: "#16a34a" },
  { value: "rented", label: "Rented", color: "#2563eb" },
  { value: "paused", label: "Paused", color: "#d97706" },
  { value: "unavailable", label: "Unavailable", color: "#dc2626" },
  { value: "disposed", label: "Disposed", color: "#64748b" },
];

const PERFORMANCE_OPTIONS = [
  { value: "all", label: "All", color: null },
  { value: "profitable", label: "Profitable", color: "#16a34a" },
  { value: "loss", label: "Loss making", color: "#dc2626" },
];

const HEALTH_OPTIONS = [
  { value: "all", label: "All" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "not_road_legal", label: "Not road legal" },
  { value: "overdue", label: "Overdue" },
  { value: "unknown", label: "Unknown" },
];

/**
 * How many panel filters are narrowing the list — the badge on the top bar's
 * filter button. Search is excluded on purpose: the term stays visible in the
 * search field itself.
 *
 * Ownership and Health only count when their section is actually offered, so a
 * stale `?health=` on a tenant without Fleet Health cannot badge a filter the
 * operator has no control to clear. (The list itself still honours the URL, as
 * v1 always has.)
 */
export function countActiveVehicleFilters(
  filters: VehicleFilterValues,
  opts: { showOwnership?: boolean; showHealth?: boolean } = {}
): number {
  return [
    filters.status !== "all",
    filters.make !== "all",
    filters.year !== "all",
    filters.performance !== "all",
    opts.showOwnership && filters.ownership !== "all",
    opts.showHealth && filters.health !== "all",
  ].filter(Boolean).length;
}

interface Props {
  filters: VehicleFilterValues;
  /** The page's `updateFilters` — a partial merge that also writes the URL. */
  onChange: (next: Partial<VehicleFilterValues>) => void;
  onClear: () => void;
  onClose: () => void;
  makes: string[];
  years: number[];
  /** Mirrors the v1 page's `!ownersHidden` gate. */
  showOwnership: boolean;
  owners: { id: string; full_name: string }[];
  /** Mirrors the v1 page's `fleetHealthEnabled` gate. */
  showHealth: boolean;
}

/** Make and Year lists grow with the fleet; cap them so the card stays a card. */
function ChipList({ children }: { children: ReactNode }) {
  return <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">{children}</div>;
}

export function VehiclesFilterPanel({
  filters,
  onChange,
  onClear,
  onClose,
  makes,
  years,
  showOwnership,
  owners,
  showHealth,
}: Props) {
  const activeCount = countActiveVehicleFilters(filters, { showOwnership, showHealth });
  const ownershipOptions = [
    { value: "all", label: "All" },
    { value: "own", label: "Own fleet" },
    { value: "managed", label: "All managed" },
    ...owners.map((o) => ({ value: o.id, label: o.full_name })),
  ];

  return (
    // The same shell as the rentals and customers panels, so the three back
    // faces read as one component.
    <FilterShell onClear={onClear} onClose={onClose} activeCount={activeCount}>
      <FilterSection
        icon={<Activity className="size-3.5 text-primary" />}
        tint="bg-primary/10"
        title="Status"
        className="lg:col-span-2"
      >
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={filters.status === o.value}
              color={o.color}
              onClick={() => onChange({ status: o.value })}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<TrendingUp className="size-3.5 text-emerald-600" />}
        tint="bg-emerald-500/10"
        title="P&L"
        className="lg:col-span-2"
      >
        <div className="flex flex-wrap gap-2">
          {PERFORMANCE_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={filters.performance === o.value}
              color={o.color}
              onClick={() => onChange({ performance: o.value as VehicleFilterValues["performance"] })}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<Car className="size-3.5 text-blue-600" />}
        tint="bg-blue-500/10"
        title="Make"
        className="lg:col-span-2"
      >
        <ChipList>
          <FilterChip active={filters.make === "all"} onClick={() => onChange({ make: "all" })}>
            All
          </FilterChip>
          {makes.map((m) => (
            <FilterChip key={m} active={filters.make === m} onClick={() => onChange({ make: m })}>
              {m}
            </FilterChip>
          ))}
        </ChipList>
      </FilterSection>

      <FilterSection
        icon={<CalendarDays className="size-3.5 text-violet-600" />}
        tint="bg-violet-500/10"
        title="Year"
        className="lg:col-span-2"
      >
        <ChipList>
          <FilterChip active={filters.year === "all"} onClick={() => onChange({ year: "all" })}>
            All
          </FilterChip>
          {years.map((y) => (
            <FilterChip
              key={y}
              active={filters.year === y.toString()}
              onClick={() => onChange({ year: y.toString() })}
            >
              {y}
            </FilterChip>
          ))}
        </ChipList>
      </FilterSection>

      {showOwnership && (
        <FilterSection
          icon={<Users className="size-3.5 text-amber-600" />}
          tint="bg-amber-500/10"
          title="Ownership"
          className="lg:col-span-2"
        >
          <ChipList>
            {ownershipOptions.map((o) => (
              <FilterChip
                key={o.value}
                active={filters.ownership === o.value}
                onClick={() => onChange({ ownership: o.value })}
              >
                {o.label}
              </FilterChip>
            ))}
          </ChipList>
        </FilterSection>
      )}

      {showHealth && (
        <FilterSection
          icon={<HeartPulse className="size-3.5 text-red-600" />}
          tint="bg-red-500/10"
          title="Health"
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap gap-2">
            {HEALTH_OPTIONS.map((o) => (
              <FilterChip
                key={o.value}
                active={filters.health === o.value}
                onClick={() => onChange({ health: o.value as VehicleFilterValues["health"] })}
              >
                {o.label}
              </FilterChip>
            ))}
          </div>
        </FilterSection>
      )}
    </FilterShell>
  );
}
