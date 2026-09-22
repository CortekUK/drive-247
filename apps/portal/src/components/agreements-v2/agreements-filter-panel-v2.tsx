"use client";

/**
 * Agreements v2: the filter panel, on the back of the overview card (D18). The
 * Rentals pattern: the top bar's filter button turns the overview over, and
 * the panel's ✕ (or Escape) turns it back. The page owns the filters; this
 * only draws them and hands every change back.
 *
 * Four sections: the customer, the sent date range, the status and the kind.
 * The top bar's search still does the broad match (customer, email, title).
 */

import { format } from "date-fns";
import { Activity, CalendarIcon, Layers, User } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Input } from "@/components/ui-v2/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Calendar } from "@/components/ui/calendar";
import { FilterChip, FilterSection, FilterShell } from "@/components/shared/filter-primitives";
import {
  countActiveAgreementFilters,
  type AgreementKindFilterV2,
  type AgreementListFiltersV2,
  type AgreementStatusFilterV2,
} from "@/lib/agreements-v2/list-filters";
import { cn } from "@/lib/utils";

/**
 * The status chips carry the colours the Status column prints in, as the
 * Rentals panel's do, so a chip reads as the rows it selects.
 */
const STATUS_OPTIONS: { value: AgreementStatusFilterV2; label: string; color: string | null }[] = [
  { value: "all", label: "All", color: null },
  { value: "signed", label: "Signed", color: "#16a34a" },
  { value: "pending", label: "Pending signature", color: "#d97706" },
  { value: "failed", label: "Failed", color: "#dc2626" },
];

const KIND_OPTIONS: { value: AgreementKindFilterV2; label: string }[] = [
  { value: "all", label: "All" },
  { value: "rental", label: "Rental" },
  { value: "individual", label: "Individual" },
];

/** Noon, so a picked day can never drift across midnight on a timezone shift. */
const normalizeDate = (date: Date | undefined) =>
  date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0) : undefined;

interface Props {
  filters: AgreementListFiltersV2;
  onChange: (next: AgreementListFiltersV2) => void;
  onClear: () => void;
  onClose: () => void;
}

export function AgreementsFilterPanelV2({ filters, onChange, onClear, onClose }: Props) {
  const set = <K extends keyof AgreementListFiltersV2>(key: K, value: AgreementListFiltersV2[K]) =>
    onChange({ ...filters, [key]: value });
  const hasDates = !!(filters.sentFrom || filters.sentTo);

  const dateBtn = (value: Date | undefined, placeholder: string, onSelect: (d: Date | undefined) => void) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-8 w-full justify-start text-xs font-normal", !value && "text-muted-foreground")}
        >
          <CalendarIcon className="mr-1.5 size-3.5 shrink-0 text-blue-600" />
          {value ? format(value, "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value} onSelect={(d) => onSelect(normalizeDate(d))} />
      </PopoverContent>
    </Popover>
  );

  return (
    <FilterShell onClear={onClear} onClose={onClose} activeCount={countActiveAgreementFilters(filters)}>
      <FilterSection icon={<User className="size-3.5 text-primary" />} tint="bg-primary/10" title="Customer">
        <Input
          value={filters.customer}
          onChange={(e) => set("customer", e.target.value)}
          placeholder="Customer name"
          aria-label="Filter by customer name"
          className="h-8 text-xs"
        />
      </FilterSection>

      <FilterSection
        icon={<CalendarIcon className="size-3.5 text-blue-600" />}
        tint="bg-blue-500/10"
        title="Sent between"
      >
        <div className="grid grid-cols-2 gap-3">
          {dateBtn(filters.sentFrom, "From", (d) => set("sentFrom", d))}
          {dateBtn(filters.sentTo, "To", (d) => set("sentTo", d))}
        </div>
        {/* Dates have no "All" chip to click back to, so they get their own
            way out that is not a full Reset. */}
        {hasDates && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, sentFrom: undefined, sentTo: undefined })}
            className="mt-1.5 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear dates
          </button>
        )}
      </FilterSection>

      <FilterSection icon={<Activity className="size-3.5 text-primary" />} tint="bg-primary/10" title="Status">
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={filters.status === o.value}
              color={o.color}
              onClick={() => set("status", o.value)}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection icon={<Layers className="size-3.5 text-emerald-600" />} tint="bg-emerald-500/10" title="Kind">
        <div className="flex flex-wrap gap-2">
          {KIND_OPTIONS.map((o) => (
            <FilterChip key={o.value} active={filters.kind === o.value} onClick={() => set("kind", o.value)}>
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>
    </FilterShell>
  );
}
