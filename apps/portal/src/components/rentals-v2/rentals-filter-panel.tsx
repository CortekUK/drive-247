"use client";

import { format } from "date-fns";
import { Activity, CalendarIcon, CreditCard, Inbox, ShieldCheck } from "lucide-react";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";
import { Button } from "@/components/ui-v2/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Calendar } from "@/components/ui/calendar";
import { FilterChip, FilterSection, FilterShell } from "@/components/shared/filter-primitives";
import { cn } from "@/lib/utils";

interface Props {
  filters: RentalFilters;
  onChange: (next: RentalFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * Status colours are the design-system set, and deliberately the same values
 * the table's own status badges use — a chip should look like the thing it
 * selects.
 */
const STATUS_OPTIONS = [
  { value: "all", label: "All", color: null },
  { value: "active", label: "Active", color: "#16a34a" },
  { value: "upcoming", label: "Upcoming", color: "#2563eb" },
  { value: "pending", label: "Pending", color: "#d97706" },
  { value: "completed", label: "Completed", color: "#64748b" },
  { value: "cancelled", label: "Cancelled", color: "#dc2626" },
];

const PAYMENT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "regular", label: "Regular" },
  { value: "payg", label: "Pay-as-you-go" },
];

/**
 * These three are every value `bonzah_insurance_policies.status` actually
 * holds. The previous filter bar offered a "Failed" chip, which matched no row
 * in the table and so always came back empty.
 */
const INSURANCE_OPTIONS = [
  { value: "all", label: "Any" },
  { value: "active", label: "Insured" },
  { value: "quoted", label: "Quoted" },
  { value: "insufficient_balance", label: "Insufficient balance" },
];

/** Noon, so a date can never drift across a day boundary on a timezone shift. */
const normalizeDate = (date: Date | undefined) =>
  date ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0) : undefined;

/**
 * How many filters are narrowing the list right now. The bar badges its
 * Filters button with this, because once the panel is closed there is otherwise
 * nothing on screen to say the list is filtered at all.
 *
 * Search is excluded on purpose — the term stays visible in the search box.
 */
export function countActiveRentalFilters(filters: RentalFilters): number {
  return [
    filters.status && filters.status !== "all",
    filters.paymentType,
    filters.bonzahStatus,
    filters.startDateFrom,
    filters.startDateTo,
    filters.extensionRequested,
    filters.cancellationRequested,
  ].filter(Boolean).length;
}

/**
 * Names the provider whose vocabulary a section borrows. Only Insurance earns
 * one: "Insured / Quoted / Insufficient balance" are Bonzah's own policy
 * states, so the badge tells the operator where those words come from.
 */
function BrandBadge({ src, darkSrc, name }: { src: string; darkSrc?: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5">
      <img src={src} alt="" className={cn("h-3 w-auto", darkSrc && "dark:hidden")} />
      {darkSrc && <img src={darkSrc} alt="" className="hidden h-3 w-auto dark:block" />}
      <span className="text-[10px] font-medium text-muted-foreground">{name}</span>
    </span>
  );
}

export function RentalsFilterPanel({ filters, onChange, onClear, onClose }: Props) {
  // Every change resets to page 1 — holding page 7 while narrowing the set to
  // twelve rows lands the user on an empty table.
  const set = (key: keyof RentalFilters, value: any) =>
    onChange({ ...filters, [key]: value, page: 1 });

  const toggle = (key: keyof RentalFilters) =>
    onChange({ ...filters, [key]: filters[key] ? undefined : true, page: 1 });

  const statusValue = filters.status || "all";
  const paymentValue = filters.paymentType || "all";
  const insuranceValue = filters.bonzahStatus || "all";
  const hasDates = !!(filters.startDateFrom || filters.startDateTo);

  const dateBtn = (
    value: Date | undefined,
    placeholder: string,
    onSelect: (d: Date | undefined) => void
  ) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 w-full justify-start text-xs font-normal",
            !value && "text-muted-foreground"
          )}
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
    <FilterShell
      onClear={onClear}
      onClose={onClose}
      activeCount={countActiveRentalFilters(filters)}
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
              onClick={() => set("status", o.value === "all" ? undefined : o.value)}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<CreditCard className="size-3.5 text-[#635bff]" />}
        tint="bg-[#635bff]/10"
        title="Payment"
      >
        <div className="flex flex-wrap gap-2">
          {PAYMENT_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={paymentValue === o.value}
              onClick={() => set("paymentType", o.value === "all" ? undefined : o.value)}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<ShieldCheck className="size-3.5 text-emerald-600" />}
        tint="bg-emerald-500/10"
        title="Insurance"
        badge={<BrandBadge src="/bonzah-logo.svg" darkSrc="/bonzah-logo-dark.svg" name="Bonzah" />}
      >
        <div className="flex flex-wrap gap-2">
          {INSURANCE_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={insuranceValue === o.value}
              onClick={() => set("bonzahStatus", o.value === "all" ? undefined : o.value)}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection
        icon={<CalendarIcon className="size-3.5 text-blue-600" />}
        tint="bg-blue-500/10"
        title="Start date range"
        className="lg:col-span-2"
      >
        <div className="grid grid-cols-2 gap-3">
          {dateBtn(filters.startDateFrom, "From", (d) => set("startDateFrom", d))}
          {dateBtn(filters.startDateTo, "To", (d) => set("startDateTo", d))}
        </div>
        {/* Dates are the one filter with no "All" chip to click back to, so
            they need their own way out that is not a full Reset. */}
        {hasDates && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...filters, startDateFrom: undefined, startDateTo: undefined, page: 1 })
            }
            className="mt-1.5 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear dates
          </button>
        )}
      </FilterSection>

      {/* Amber and red here are the same colours the table paints those rows
          with, so a chip and the rows it selects read as one thing. */}
      <FilterSection
        icon={<Inbox className="size-3.5 text-amber-600" />}
        tint="bg-amber-500/10"
        title="Requests"
        className="lg:col-span-2"
      >
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={!!filters.extensionRequested}
            color="#d97706"
            onClick={() => toggle("extensionRequested")}
          >
            Extension requested
          </FilterChip>
          <FilterChip
            active={!!filters.cancellationRequested}
            color="#dc2626"
            onClick={() => toggle("cancellationRequested")}
          >
            Cancellation requested
          </FilterChip>
        </div>
      </FilterSection>
    </FilterShell>
  );
}
