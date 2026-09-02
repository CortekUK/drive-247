"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InstallmentCalendarItem {
  number: number;
  date: string; // ISO yyyy-mm-dd
  amount: number;
  status: "paid" | "open" | "superseded" | "scheduled" | "overdue" | "due_today";
}

interface Props {
  schedule: InstallmentCalendarItem[];
  rentalStart?: string;
  rentalEnd?: string;
  currencyCode?: string;
  className?: string;
  /** Optional click handler for a tile that has a schedule item attached.
   * The parent (InstallmentSection / CustomerInstallmentsView) uses this to
   * open the same Pay dialog the table's Pay button opens — clicking either
   * surface starts the same flow. Tiles without an item (empty days) and
   * "paid" / "superseded" tiles do nothing (handler is only invoked for
   * actionable rows: open / due_today / overdue). */
  onItemClick?: (item: InstallmentCalendarItem) => void;
}

const DAY_NAMES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const STATUS_TONE: Record<InstallmentCalendarItem["status"], string> = {
  paid:       "bg-emerald-500 text-white",
  open:       "bg-amber-400 text-amber-800 dark:text-amber-200",
  overdue:    "bg-red-500 text-white",
  due_today:  "bg-indigo-500 text-white animate-pulse",
  scheduled:  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30",
  superseded: "bg-muted text-muted-foreground line-through",
};

const STATUS_LABEL: Record<InstallmentCalendarItem["status"], string> = {
  paid: "Paid",
  open: "Open",
  overdue: "Overdue",
  due_today: "Due today",
  scheduled: "Scheduled",
  superseded: "Superseded",
};

function formatCurrency(amount: number, code = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(0)}`;
  }
}

function buildMonthGrid(year: number, month: number) {
  // Returns 6×7 grid of Date objects (Mon..Sun rows)
  const first = new Date(Date.UTC(year, month, 1));
  const startDay = (first.getUTCDay() + 6) % 7; // shift Sun=0 → 6 so week starts Mon=0
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < startDay; i++) {
    const d = new Date(Date.UTC(year, month, 1 - (startDay - i)));
    cells.push({ date: d.toISOString().split("T")[0], inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month, d));
    cells.push({ date: dt.toISOString().split("T")[0], inMonth: true });
  }
  while (cells.length < 42) {
    const last = new Date(cells[cells.length - 1].date);
    last.setUTCDate(last.getUTCDate() + 1);
    cells.push({ date: last.toISOString().split("T")[0], inMonth: false });
  }
  return cells;
}

export function InstallmentCalendar({ schedule, rentalStart, rentalEnd, currencyCode = "USD", className, onItemClick }: Props) {
  const today = new Date().toISOString().split("T")[0];
  const initialDate = useMemo(() => schedule[0] ? new Date(schedule[0].date) : new Date(), [schedule]);
  const [view, setView] = useState({ y: initialDate.getUTCFullYear(), m: initialDate.getUTCMonth() });

  const byDate = useMemo(() => {
    const map = new Map<string, InstallmentCalendarItem>();
    for (const item of schedule) map.set(item.date, item);
    return map;
  }, [schedule]);

  const cells = useMemo(() => buildMonthGrid(view.y, view.m), [view]);
  const rentalStartTs = rentalStart ? new Date(rentalStart).getTime() : null;
  const rentalEndTs = rentalEnd ? new Date(rentalEnd).getTime() : null;
  const monthLabel = new Date(Date.UTC(view.y, view.m, 1)).toLocaleString("en-US", { month: "long", year: "numeric" });

  function goPrev() {
    const m = view.m - 1; setView(m < 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m });
  }
  function goNext() {
    const m = view.m + 1; setView(m > 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m });
  }

  return (
    <div className={cn("bg-card border border-border/60 rounded-lg p-4", className)}>
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={goPrev} className="p-1.5 rounded hover:bg-muted" aria-label="Previous month">
          <ChevronLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <h3 className="text-sm font-medium text-foreground">{monthLabel}</h3>
        <button type="button" onClick={goNext} className="p-1.5 rounded hover:bg-muted" aria-label="Next month">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const item = byDate.get(cell.date);
          const cellTs = new Date(cell.date).getTime();
          const isInRental = rentalStartTs && rentalEndTs && cellTs >= rentalStartTs && cellTs <= rentalEndTs;
          const isToday = cell.date === today;
          const dayNum = parseInt(cell.date.split("-")[2], 10);

          // Tile is clickable when there's a schedule item AND a click
          // handler AND the item is in an actionable state. Paid /
          // superseded tiles stay non-interactive (no ambiguous "click to
          // re-pay" UX). The whole cell becomes a button so the operator
          // gets a clear hover/focus state, not just the inner pill.
          // Only currently-actionable tiles open the Pay dialog. Scheduled
          // (future) tiles are informational — clicking them would either
          // trigger early cumulative settlement or leave the schedule out
          // of order, so we keep them non-interactive (matches the
          // disabled-Pay-button rule on the table).
          const isClickable =
            !!item && !!onItemClick &&
            (item.status === "due_today" || item.status === "overdue" || item.status === "open");
          const cellClasses = cn(
            "relative rounded-md min-h-[48px] p-1 flex flex-col items-center text-xs",
            cell.inMonth ? "" : "opacity-30",
            isInRental ? "bg-muted/40" : "",
            isToday ? "ring-1 ring-indigo-500/40" : "",
            isClickable ? "cursor-pointer hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-colors" : "",
          );
          const inner = (
            <>
              <div className={cn("text-[11px] font-medium", isToday ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground/70")}>{dayNum}</div>
              {item ? (
                <div className={cn(
                  "mt-1 w-full rounded px-1 py-0.5 text-center text-[10px] font-semibold leading-tight",
                  STATUS_TONE[item.status],
                )}>
                  {formatCurrency(item.amount, currencyCode)}
                </div>
              ) : null}
            </>
          );
          return isClickable ? (
            <button
              key={cell.date}
              type="button"
              className={cellClasses}
              onClick={() => onItemClick!(item!)}
              aria-label={`Pay ${formatCurrency(item!.amount, currencyCode)} due ${cell.date}`}
            >
              {inner}
            </button>
          ) : (
            <div key={cell.date} className={cellClasses}>
              {inner}
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-border/60 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {(["paid","due_today","overdue","scheduled","superseded"] as const).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={cn("inline-block w-3 h-3 rounded-sm", STATUS_TONE[s])}></span>
            <span>{STATUS_LABEL[s]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default InstallmentCalendar;
