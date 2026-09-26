"use client";

/**
 * Small parts every Finances view shares: the phone rows, the row menu's
 * trigger, and the line under a table that adds its rows up in words.
 */

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { LIST_ROW_ACTION } from "@/components/shared/list-table-v2";
import { cn } from "@/lib/utils";
import { formatMoney, plural } from "@/lib/payment-plans-ui/format";

/**
 * Below `sm` a table is a stack of rows carrying their key facts (design §2:
 * "rows collapse to their key facts"). The table itself is hidden there rather
 * than scrolled sideways, so the page never scrolls horizontally.
 */
export function MobileRows<T>({
  rows,
  keyOf,
  onOpen,
  label,
  children,
}: {
  rows: T[];
  keyOf: (row: T) => string;
  onOpen: (row: T) => void;
  /** Accessible name for a row's button. */
  label: (row: T) => string;
  children: (row: T) => ReactNode;
}) {
  return (
    <ul
      data-finance-mobile-rows=""
      className="divide-y divide-foreground/5 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/5 sm:hidden dark:ring-foreground/10"
    >
      {rows.map((row) => (
        <li key={keyOf(row)}>
          <button
            type="button"
            aria-label={label(row)}
            onClick={() => onOpen(row)}
            className="flex w-full min-w-0 items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--v2-hover,var(--muted))_/_0.6)]"
          >
            {children(row)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The two-line fact block a phone row shows on each side. */
export function MobileFact({ primary, secondary, align = "left" }: { primary: ReactNode; secondary?: ReactNode; align?: "left" | "right" }) {
  return (
    <span className={cn("block min-w-0", align === "right" && "shrink-0 text-right")}>
      <span className="block truncate text-sm font-medium text-foreground">{primary}</span>
      {secondary ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span> : null}
    </span>
  );
}

/**
 * "⋯" for a row's menu. Forwards its ref and props: it sits under a Radix
 * `DropdownMenuTrigger asChild`, which anchors the menu on this element.
 */
export const RowMenuTrigger = forwardRef<HTMLButtonElement, { label: string } & Omit<ComponentPropsWithoutRef<"button">, "children">>(
  function RowMenuTrigger({ label, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className={cn(LIST_ROW_ACTION, "ml-auto flex", className)}
        {...props}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    );
  },
);

/**
 * The rows on screen, added up again: "Outstanding on these bills (12):
 * $4,210.00". With a card filtering, this IS the card's number rebuilt from
 * the rows it was summed from.
 */
export function SumLine({
  label,
  cents,
  count,
  noun,
  currency,
}: {
  label: string;
  cents: number;
  count: number;
  noun: string;
  currency: string;
}) {
  return (
    <p data-finance-sum="" className="px-1 text-sm text-muted-foreground">
      {label} ({plural(count, noun)}):{" "}
      <span className="font-semibold tabular-nums text-foreground" data-finance-sum-value="">
        {formatMoney(cents, currency)}
      </span>
    </p>
  );
}
