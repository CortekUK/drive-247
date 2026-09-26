"use client";

/**
 * The back face of the Finances overview — its filter panel.
 *
 * Built exactly like the Rentals, Customers and Vehicles panels (FilterShell,
 * FilterSection, FilterChip from components/shared/filter-primitives.tsx): the
 * filter button in the top bar's search field turns the overview over, this
 * panel's ✕ (or Escape) turns it back. It only draws controls. The page owns
 * the state, which lives in the URL (`finances-url.ts`), and the model does
 * all the filtering.
 *
 *   Show      the rows behind one figure — Outstanding, Overdue, Collected,
 *             Due next 7 days — or everything (the design's card filters)
 *   Status    the current view's own statuses
 *   Method    how the money moves (Received and Upcoming only)
 *   Period    Today · 7 days · This month · All · Custom (not on Fines, which
 *             keeps every fine on screen)
 */

import { format } from "date-fns";
import { Activity, CalendarIcon, CreditCard, Layers } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui-v2/popover";
import { Calendar } from "@/components/ui/calendar";
import { FilterChip, FilterSection, FilterShell } from "@/components/shared/filter-primitives";
import type { ListTone } from "@/components/shared/list-table-v2";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/date-utils";
import { dateToIso } from "@/lib/payment-plans-ui/format";
import type { FinanceCard } from "@/lib/finances/types";
import { DEFAULT_PERIOD, type FinancesUrlState, type PeriodKey } from "./finances-url";
import { PERIOD_LABEL } from "./finance-words";

export interface PanelOption {
  value: string;
  label: string;
  /** Status chips borrow the hue the list paints that status with. */
  tone?: ListTone;
}

/** The list kit's tones as the hex a chip tints itself with (the design-system status colours). */
const TONE_HEX: Record<ListTone, string | null> = {
  success: "#16a34a",
  info: "#2563eb",
  warning: "#d97706",
  danger: "#dc2626",
  muted: "#64748b",
};

export const SHOW_LABEL: Record<FinanceCard, string> = {
  outstanding: "Outstanding",
  overdue: "Overdue",
  collected: "Collected",
  upcoming: "Due next 7 days",
};

const PERIOD_KEYS: PeriodKey[] = ["today", "7d", "month", "all", "custom"];

/**
 * How many filters narrow the list — the number on the top bar's Filters
 * button, which is all that says the list is filtered once the panel is shut.
 * The search is left out: it is visible in the search box.
 */
export function countActiveFinanceFilters(state: Pick<FinancesUrlState, "status" | "method" | "card" | "period">): number {
  return [!!state.status, !!state.method, !!state.card, state.period !== DEFAULT_PERIOD].filter(Boolean).length;
}

export function FinancesFilterPanel({
  state,
  onPatch,
  onClear,
  onClose,
  cards,
  statusOptions,
  methodOptions,
  showPeriod,
}: {
  state: FinancesUrlState;
  onPatch: (patch: Partial<FinancesUrlState>) => void;
  onClear: () => void;
  onClose: () => void;
  /** The figures this viewer may open the rows of, in order. */
  cards: FinanceCard[];
  statusOptions: PanelOption[];
  /** Empty hides the Method section. */
  methodOptions: PanelOption[];
  showPeriod: boolean;
}) {
  const dateBtn = (value: string | null, placeholder: string, onSelect: (day: string) => void) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-8 w-full justify-start text-xs font-normal", !value && "text-muted-foreground")}>
          <CalendarIcon className="mr-1.5 size-3.5 shrink-0 text-blue-600" />
          {value ? format(parseLocalDate(value), "MMM d, yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value ? parseLocalDate(value) : undefined}
          onSelect={(d) => d && onSelect(dateToIso(d))}
        />
      </PopoverContent>
    </Popover>
  );

  return (
    <FilterShell onClear={onClear} onClose={onClose} activeCount={countActiveFinanceFilters(state)}>
      {cards.length > 0 && (
        <FilterSection icon={<Layers className="size-3.5 text-primary" />} tint="bg-primary/10" title="Show" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2" data-filter-section="show">
            <FilterChip active={!state.card} onClick={() => onPatch({ card: null })}>
              Everything
            </FilterChip>
            {cards.map((card) => (
              <FilterChip key={card} active={state.card === card} onClick={() => onPatch({ card })}>
                {SHOW_LABEL[card]}
              </FilterChip>
            ))}
          </div>
        </FilterSection>
      )}

      {statusOptions.length > 0 && (
        <FilterSection icon={<Activity className="size-3.5 text-emerald-600" />} tint="bg-emerald-500/10" title="Status" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2" data-filter-section="status">
            <FilterChip active={!state.status} onClick={() => onPatch({ status: null })}>
              All
            </FilterChip>
            {statusOptions.map((o) => (
              <FilterChip
                key={o.value}
                active={state.status === o.value}
                color={o.tone ? TONE_HEX[o.tone] : null}
                onClick={() => onPatch({ status: o.value })}
              >
                {o.label}
              </FilterChip>
            ))}
          </div>
        </FilterSection>
      )}

      {methodOptions.length > 0 && (
        <FilterSection icon={<CreditCard className="size-3.5 text-[#635bff]" />} tint="bg-[#635bff]/10" title="Method" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2" data-filter-section="method">
            <FilterChip active={!state.method} onClick={() => onPatch({ method: null })}>
              All
            </FilterChip>
            {methodOptions.map((o) => (
              <FilterChip key={o.value} active={state.method === o.value} onClick={() => onPatch({ method: o.value })}>
                {o.label}
              </FilterChip>
            ))}
          </div>
        </FilterSection>
      )}

      {showPeriod && (
        <FilterSection icon={<CalendarIcon className="size-3.5 text-blue-600" />} tint="bg-blue-500/10" title="Period" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2" data-filter-section="period">
            {PERIOD_KEYS.map((key) => (
              <FilterChip
                key={key}
                active={state.period === key}
                onClick={() => {
                  if (key !== "custom") return onPatch({ period: key });
                  const today = dateToIso(new Date());
                  onPatch({ period: "custom", from: state.from ?? `${today.slice(0, 7)}-01`, to: state.to ?? today });
                }}
              >
                {PERIOD_LABEL[key]}
              </FilterChip>
            ))}
          </div>
          {state.period === "custom" && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {dateBtn(state.from, "From", (day) => onPatch({ period: "custom", from: day, to: state.to && state.to >= day ? state.to : day }))}
              {dateBtn(state.to, "To", (day) => onPatch({ period: "custom", from: state.from && state.from <= day ? state.from : day, to: day }))}
            </div>
          )}
        </FilterSection>
      )}
    </FilterShell>
  );
}
