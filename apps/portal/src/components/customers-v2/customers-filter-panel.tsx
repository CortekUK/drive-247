"use client";

import { Activity, UserCheck } from "lucide-react";
import { FilterChip, FilterSection, FilterShell } from "@/components/shared/filter-primitives";

/**
 * The back face of the Customers overview card (v2 chrome only).
 *
 * It replaces the Status and User Type dropdowns that sat under the stat cards,
 * and it writes to the SAME page state those dropdowns wrote (`statusFilter`,
 * `userTypeFilter`). The page still serialises that state to `?status=` and
 * `?userType=` and still does all the filtering. This file only draws controls.
 *
 * The option values are the exact strings the old dropdowns used, and they are
 * compared against `customers.status` and the derived `user_type` as they are.
 * Change a value here and the filter quietly matches nothing.
 */

interface Props {
  status: string;
  userType: string;
  onStatusChange: (next: string) => void;
  onUserTypeChange: (next: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/** Same design-system colours the rest of v2 uses for these states. */
const STATUS_OPTIONS = [
  { value: "all", label: "All", color: null },
  { value: "Active", label: "Active", color: "#16a34a" },
  { value: "Inactive", label: "Inactive", color: "#64748b" },
  { value: "Rejected", label: "Rejected", color: "#dc2626" },
];

const USER_TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Authenticated", label: "Authenticated" },
  { value: "Guest", label: "Guest" },
];

/**
 * How many filters are narrowing the list. The top bar puts this number on its
 * Filters button, because once the panel is closed nothing else on screen says
 * the list is filtered.
 *
 * Search is left out on purpose: the term is already visible in the search box.
 */
export function countActiveCustomerFilters({
  status,
  userType,
}: {
  status: string;
  userType: string;
}): number {
  return [status && status !== "all", userType && userType !== "all"].filter(Boolean).length;
}

export function CustomersFilterPanel({
  status,
  userType,
  onStatusChange,
  onUserTypeChange,
  onClear,
  onClose,
}: Props) {
  const statusValue = status || "all";
  const userTypeValue = userType || "all";

  return (
    <FilterShell
      onClear={onClear}
      onClose={onClose}
      activeCount={countActiveCustomerFilters({ status, userType })}
    >
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
              active={statusValue === o.value}
              color={o.color}
              onClick={() => onStatusChange(o.value)}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<UserCheck className="size-3.5 text-blue-600" />}
        tint="bg-blue-500/10"
        title="User type"
        className="lg:col-span-2"
      >
        <div className="flex flex-wrap gap-2">
          {USER_TYPE_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={userTypeValue === o.value}
              onClick={() => onUserTypeChange(o.value)}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>
    </FilterShell>
  );
}
