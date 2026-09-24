"use client";

import { type ReactNode } from "react";
import { format } from "date-fns";
import { CalendarIcon, Layers, User, Zap } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Calendar } from "@/components/ui/calendar";
import { FilterChip, FilterSection, FilterShell } from "@/components/shared/filter-primitives";
import { formatActionName, type AuditLogsFilters } from "@/hooks/use-audit-logs";
import { parseLocalDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

/**
 * The BACK face of the Audit Logs overview (v2 chrome only).
 *
 * It replaces the five controls that sat in a row under the page title — All
 * Entities, All Actions, All Users, From date, To date — and writes the SAME
 * `AuditLogsFilters` object those controls wrote, with the same values
 * (`undefined` for "no filter", `yyyy-MM-dd` for the two dates). So the query
 * `useAuditLogs` builds is unchanged; this file only draws controls. Every
 * other tenant keeps the inline bar exactly as it was.
 *
 * Unlike the rentals/customers/vehicles panels, ALL of these filters are query
 * clauses: each one changes what the server returns, which is why none of them
 * is applied client-side and why the search box in the top bar (which sifts the
 * loaded rows) is a different thing and not counted below.
 */

/** Exactly the entity types the v1 dropdown offered, in its order. */
const ENTITY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "customer", label: "Customer" },
  { value: "rental", label: "Rental" },
  { value: "vehicle", label: "Vehicle" },
  { value: "payment", label: "Payment" },
  { value: "fine", label: "Fine" },
  { value: "invoice", label: "Invoice" },
  { value: "document", label: "Document" },
  { value: "plate", label: "Plate" },
  { value: "identity", label: "Identity" },
  { value: "user", label: "User" },
  { value: "settings", label: "Settings" },
];

/**
 * How many filters are narrowing the list — the badge on the top bar's filter
 * button, and the only thing on screen saying the list is filtered once the
 * panel is shut.
 *
 * The two dates count SEPARATELY, as they do on rentals
 * (`countActiveRentalFilters`): each is its own clause (`gte`, `lte`), each can
 * be set without the other, and a badge of 1 over a half-open range would leave
 * the operator hunting for the other bound. So "since Sep 1" is 1 and
 * "Sep 1 – Sep 15" is 2.
 *
 * The search term is excluded, again as on every other panel: it stays visible
 * in the search field itself.
 */
export function countActiveAuditLogFilters(filters: AuditLogsFilters): number {
  return [
    filters.entityType && filters.entityType !== "all",
    filters.action && filters.action !== "all",
    filters.actorId && filters.actorId !== "all",
    filters.dateFrom,
    filters.dateTo,
  ].filter(Boolean).length;
}

interface Props {
  filters: AuditLogsFilters;
  /** Every distinct action on this tenant's log (`useAuditLogActions`). */
  actions: readonly string[];
  /** The tenant's active staff (`useAdminUsers`). */
  users: readonly { id: string; name: string | null; email: string }[];
  /** Replaces the whole filters object, the way the page's own setter does. */
  onChange: (next: AuditLogsFilters) => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * Action and Performed-by lists grow with the tenant — a busy log has well over
 * a hundred distinct actions — so they scroll inside the card rather than
 * making the card as tall as the list. The same cap the vehicles panel puts on
 * Make and Year.
 */
function ChipList({ children }: { children: ReactNode }) {
  return <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">{children}</div>;
}

export function AuditLogsFilterPanel({
  filters,
  actions,
  users,
  onChange,
  onClear,
  onClose,
}: Props) {
  /** "all" writes `undefined`, which is what the v1 dropdowns wrote. */
  const set = (key: keyof AuditLogsFilters, value: string | undefined) =>
    onChange({ ...filters, [key]: value });

  const entityValue = filters.entityType || "all";
  const actionValue = filters.action || "all";
  const actorValue = filters.actorId || "all";
  const hasDates = !!(filters.dateFrom || filters.dateTo);

  /**
   * The two dates are held as plain `yyyy-MM-dd` strings, so they are read back
   * with `parseLocalDate`, never `new Date(...)`: a bare date string is parsed
   * as UTC midnight, which prints as the day BEFORE anywhere west of Greenwich.
   * The value written back is the same `yyyy-MM-dd` the query expects.
   */
  const dateBtn = (
    value: string | undefined,
    placeholder: string,
    onSelect: (next: string | undefined) => void
  ) => {
    const selected = value ? parseLocalDate(value) : undefined;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("h-8 w-full justify-start text-xs font-normal", !selected && "text-muted-foreground")}
          >
            <CalendarIcon className="mr-1.5 size-3.5 shrink-0 text-blue-600" />
            {selected ? format(selected, "MMM d, yyyy") : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => onSelect(d ? format(d, "yyyy-MM-dd") : undefined)}
          />
        </PopoverContent>
      </Popover>
    );
  };

  return (
    // The same shell as the rentals, customers and vehicles panels, so all four
    // back faces read as one component.
    <FilterShell onClear={onClear} onClose={onClose} activeCount={countActiveAuditLogFilters(filters)}>
      <FilterSection
        icon={<Layers className="size-3.5 text-primary" />}
        tint="bg-primary/10"
        title="Entity"
        className="lg:col-span-2"
      >
        <ChipList>
          {ENTITY_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              active={entityValue === o.value}
              onClick={() => set("entityType", o.value === "all" ? undefined : o.value)}
            >
              {o.label}
            </FilterChip>
          ))}
        </ChipList>
      </FilterSection>

      <FilterSection
        icon={<Zap className="size-3.5 text-violet-600" />}
        tint="bg-violet-500/10"
        title="Action"
        className="lg:col-span-2"
      >
        <ChipList>
          <FilterChip active={actionValue === "all"} onClick={() => set("action", undefined)}>
            All
          </FilterChip>
          {actions.map((a) => (
            // The label is the table's own (`formatActionName`), so a chip and
            // the rows it selects read the same. Several raw actions share a
            // label ("Settings Edit" is both `update_settings` and
            // `settings_updated`), exactly as they did in the v1 dropdown, so
            // the raw key is on the title for when two chips look alike.
            <FilterChip key={a} active={actionValue === a} onClick={() => set("action", a)}>
              <span title={a}>{formatActionName(a)}</span>
            </FilterChip>
          ))}
        </ChipList>
      </FilterSection>

      <FilterSection
        icon={<User className="size-3.5 text-blue-600" />}
        tint="bg-blue-500/10"
        title="Performed by"
        className="lg:col-span-2"
      >
        <ChipList>
          <FilterChip active={actorValue === "all"} onClick={() => set("actorId", undefined)}>
            All
          </FilterChip>
          {users.map((u) => (
            <FilterChip key={u.id} active={actorValue === u.id} onClick={() => set("actorId", u.id)}>
              {u.name || u.email}
            </FilterChip>
          ))}
        </ChipList>
      </FilterSection>

      <FilterSection
        icon={<CalendarIcon className="size-3.5 text-blue-600" />}
        tint="bg-blue-500/10"
        title="Date range"
        className="lg:col-span-2"
      >
        <div className="grid grid-cols-2 gap-3">
          {dateBtn(filters.dateFrom, "From", (d) => set("dateFrom", d))}
          {dateBtn(filters.dateTo, "To", (d) => set("dateTo", d))}
        </div>
        {/* Dates are the one filter with no "All" chip to click back to, so
            they need their own way out that is not a full Reset. */}
        {hasDates && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, dateFrom: undefined, dateTo: undefined })}
            className="mt-1.5 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear dates
          </button>
        )}
      </FilterSection>
    </FilterShell>
  );
}
