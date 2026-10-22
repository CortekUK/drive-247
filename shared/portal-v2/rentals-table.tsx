"use client";

/**
 * The Rentals table, shared by both portals: the operator's Rentals tab
 * (apps/portal/src/components/rentals-v2/rentals-list-v2.tsx) and the
 * customer portal's Rentals page. Lifted out of the operator list, where it was
 * drawn inline, so the two are one component rather than a copy and a
 * look-alike.
 *
 * Five columns, all reading left: Rental # (the row's identifier, weighted) ·
 * the party (Customer on the operator side, Vehicle on the customer's) ·
 * Pickup · Return · Status. Status is coloured TEXT, never a pill (the list
 * kit's tones). Headings are plain text in the kit's micro-type: v2 lists
 * cannot be re-ordered (team lead, Sep 2026), so a heading has no sort control,
 * no hover tint and no pointer.
 *
 * The whole row opens the rental. Hovering it (or focusing it from the
 * keyboard) tints it and shows an open chevron at its end; nothing is drawn
 * there at rest. The row is focusable and opens on Enter, so the table works
 * without a mouse.
 *
 * Paging is the page's: it hands in the rows on screen, whether more are
 * coming, and the scroll root and sentinel its infinite scroll observes.
 */

import type { CSSProperties, KeyboardEvent, ReactNode, Ref, RefObject } from "react";
import { Card, CardContent } from "./card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { cn } from "./cn";
import { V2_LIST_CLASSES, V2_LIST_TONES, type V2ListTone } from "./list-styles";
import { parseLocalDate } from "./timeline/dates";
import { ROW_OPEN_CELL, RowOpenIndicator } from "./row-open";

/**
 * `30 Sep`, or `30 Sep 2027` when the year is not the current one.
 *
 * Slash-form dates (`9/30/2026`) are ambiguous to half the world and hard to
 * scan in a dense column; the year is dropped when it is this year because it
 * is nearly always redundant. Rendered in `tabular-nums` so the days line up.
 *
 * `parseLocalDate`, never `new Date(value)`: these are date-only strings, and
 * `new Date("2026-09-30")` is UTC midnight, the 29th west of Greenwich.
 */
const RENTAL_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const RENTAL_DATE_WITH_YEAR = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
export function formatRentalDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = parseLocalDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.getFullYear() === new Date().getFullYear() ? RENTAL_DATE.format(d) : RENTAL_DATE_WITH_YEAR.format(d);
}

/**
 * Each status word's colour. Completed is muted rather than coloured: it is the
 * most common value and the least actionable, so it recedes.
 */
export const RENTAL_STATUS_TONE: Record<string, V2ListTone> = {
  Active: "success",
  Upcoming: "info",
  Pending: "warning",
  Completed: "muted",
  Cancelled: "danger",
  Rejected: "danger",
};

/** Column widths, in order. `table-fixed`, so no column takes every spare pixel. */
const WIDTHS = ["w-[20%]", "w-[28%]", "w-[16%]", "w-[16%]", "w-[20%]"] as const;

export interface RentalsTableRow {
  id: string;
  /** `rental_number`, as the operator reads it out on the phone. */
  reference: string;
  /** The second column's value: the customer's full name, or the vehicle. */
  party: string;
  /** DATE-only "YYYY-MM-DD". */
  start: string | null;
  end: string | null;
  /** No return date because the rental runs until it is stopped (pay as you go). */
  ongoing?: boolean;
  /** The operator's status word (getRentalStatus): Active, Upcoming, Pending … */
  status: string;
  /** A line under the reference (the operator's cancellation and insurance flags). */
  note?: ReactNode;
  /** The row's tint and rail when it carries a flag. */
  tint?: string;
  /** Quiet chips after the status (the operator's PAYG, Auto-extend). */
  meta?: readonly string[];
  /** Inert attributes on the row (tour anchors). */
  attrs?: Record<`data-${string}`, string>;
}

export interface RentalsTableProps {
  rows: readonly RentalsTableRow[];
  /** The second column's heading: "Customer" (operator) or "Vehicle" (customer). */
  partyLabel: string;
  onOpen: (id: string) => void;
  /** The scroll box the page's infinite scroll observes. */
  scrollRootRef?: RefObject<HTMLDivElement>;
  /** The node after the last row; mounted only while more rows are coming. */
  sentinelRef?: Ref<HTMLDivElement>;
  hasMore?: boolean;
  /** The measured window fill (`useViewportFillCap`), replacing 520px from md up. */
  maxHeight?: number;
}

export function RentalsTable({ rows, partyLabel, onOpen, scrollRootRef, sentinelRef, hasMore = false, maxHeight }: RentalsTableProps) {
  return (
    <RentalsTableFrame scrollRootRef={scrollRootRef} maxHeight={maxHeight} partyLabel={partyLabel} footer={
      // The sentinel, inside the scroll container after the last row. The bars
      // read as "more coming" on a slow frame; `aria-hidden` because the count
      // line under the card says the same thing in words.
      hasMore && (
        <div ref={sentinelRef} aria-hidden="true" className="space-y-3 px-4 py-4">
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center gap-4">
              <div className="h-3 w-20 animate-pulse rounded-full bg-v2-muted" />
              <div className="h-3 w-28 animate-pulse rounded-full bg-v2-muted" />
              <div className="h-3 w-16 animate-pulse rounded-full bg-v2-muted" />
              <div className="h-3 w-24 animate-pulse rounded-full bg-v2-muted" />
            </div>
          ))}
        </div>
      )
    }>
      {rows.map((row) => (
        <RentalRow key={row.id} row={row} onOpen={onOpen} />
      ))}
    </RentalsTableFrame>
  );
}

/** The table while rentals load: the same card, headings and row height, with bars for the cells. */
export function RentalsTableSkeleton({ partyLabel, rows = 4 }: { partyLabel: string; rows?: number }) {
  return (
    <div aria-hidden>
      <RentalsTableFrame partyLabel={partyLabel}>
        {Array.from({ length: rows }, (_, index) => (
          <TableRow key={index} className="hover:bg-transparent">
            {[16, 28, 14, 14, 18].map((width, cell) => (
              <TableCell key={cell} className={V2_LIST_CLASSES.cell}>
                <span className="inline-block h-3 animate-pulse rounded-full bg-v2-muted" style={{ width: `${width * 4}px`, maxWidth: "100%" }} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </RentalsTableFrame>
    </div>
  );
}

function RentalsTableFrame({
  partyLabel,
  scrollRootRef,
  maxHeight,
  footer,
  children,
}: {
  partyLabel: string;
  scrollRootRef?: RefObject<HTMLDivElement>;
  maxHeight?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const headings = ["Rental #", partyLabel, "Pickup", "Return", "Status"];
  const style: CSSProperties | undefined = maxHeight !== undefined ? { maxHeight } : undefined;
  return (
    <Card>
      {/* The scroll root. Its classes switch off the Table's own overflow-x-auto
          wrapper: as a scroll container of its own it was what the sticky
          header pinned to, and it never scrolls vertically, so the header
          scrolled away with the rows. */}
      <CardContent ref={scrollRootRef} className={cn(V2_LIST_CLASSES.scrollRoot, V2_LIST_CLASSES.fillViewport)} style={style}>
        <Table className="min-w-[720px] table-fixed">
          {/* Sticky while the body scrolls inside the card, nearly opaque with a
              blur behind it, so rows passing underneath stay hidden. */}
          <TableHeader className={V2_LIST_CLASSES.header}>
            <TableRow className={V2_LIST_CLASSES.headerRow}>
              {headings.map((heading, index) => (
                <TableHead key={index} className={cn(V2_LIST_CLASSES.head, WIDTHS[index])}>
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
        {footer}
      </CardContent>
    </Card>
  );
}

function RentalRow({ row, onOpen }: { row: RentalsTableRow; onOpen: (id: string) => void }) {
  const open = () => {
    // Letting go of a drag-select inside the row fires a click on the row: that
    // is someone copying a reference, not asking to open the rental.
    if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
    onOpen(row.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(row.id);
    }
  };

  return (
    <TableRow
      {...row.attrs}
      tabIndex={0}
      className={cn(
        "group/row cursor-pointer outline-none focus-visible:bg-[hsl(var(--v2-row-hover,var(--muted)_/_0.5))]",
        row.tint,
      )}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      {/* Rental # — the row's identifier, and weighted as one. */}
      <TableCell className={V2_LIST_CLASSES.cell}>
        <div className="flex flex-col items-start gap-0.5">
          <span className={V2_LIST_CLASSES.identifier}>{row.reference}</span>
          {row.note}
        </div>
      </TableCell>

      <TableCell className={V2_LIST_CLASSES.cell}>
        <span className={cn("block truncate", V2_LIST_CLASSES.text)}>{row.party}</span>
      </TableCell>

      {/* `tabular-nums` lines the two date columns up down the page. */}
      <TableCell className={cn(V2_LIST_CLASSES.cell, "tabular-nums")}>
        <span className={V2_LIST_CLASSES.text}>{formatRentalDate(row.start)}</span>
      </TableCell>
      <TableCell className={cn(V2_LIST_CLASSES.cell, "tabular-nums")}>
        {row.end ? (
          <span className={V2_LIST_CLASSES.text}>{formatRentalDate(row.end)}</span>
        ) : row.ongoing ? (
          <span className="text-sm font-medium text-v2-primary dark:text-v2-link">Ongoing</span>
        ) : (
          <span className="text-v2-muted-fg">—</span>
        )}
      </TableCell>

      {/* Status — one treatment for every value, hue the only thing that
          changes. The open indicator (row-open.tsx) sits at the row's end, in
          room the cell keeps for it, while the row is hovered or focused. */}
      <TableCell className={cn(V2_LIST_CLASSES.cell, ROW_OPEN_CELL)}>
        <div className="flex flex-wrap items-center justify-start gap-1.5">
          <span className={cn("text-sm font-medium", V2_LIST_TONES[RENTAL_STATUS_TONE[row.status] ?? "muted"])}>{row.status}</span>
          {row.meta?.map((chip) => (
            <span key={chip} className={V2_LIST_CLASSES.metaChip}>
              {chip}
            </span>
          ))}
        </div>
        <RowOpenIndicator />
      </TableCell>
    </TableRow>
  );
}
