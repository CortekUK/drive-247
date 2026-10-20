"use client";

/**
 * The v2 list table: the rentals list's table, as parts every v2 list uses.
 *
 * The rentals list (`rentals-v2/rentals-list-v2.tsx`) is the reference. Its
 * table is a card whose body scrolls inside itself with the scrollbar hidden,
 * under a sticky, blurred header of small uppercase column names. Headings and
 * cells read left, and only money reads right. The row's identifier is weighted
 * and everything else is plain text; status is coloured TEXT, never a pill; the
 * whole row opens the record; and there is no pager. Rows arrive 25 at a time
 * as the operator scrolls, with one quiet line under the card saying how much
 * of the set is on screen. The order is the page's own (newest added first):
 * columns do not sort.
 *
 * Every v2 list builds its table from these parts so the lists cannot drift
 * apart. The class strings are exported, and `list-table-v2.test.tsx` checks the
 * rentals list still uses the same ones, so a change on either side fails.
 *
 * v2 only. A shared v1 page mounts these inside its `useV2("chrome")` branch;
 * every other tenant keeps the page's own table and pager.
 */

import { Button } from "@/components/ui-v2/button";
// The kit itself lives in shared/portal-v2/list-table.tsx (the customer portal
// draws it too). Re-exported here so every list keeps its import.
export {
  LIST_FILL_MIN_HEIGHT,
  LIST_ROWS_PER_FILL,
  LIST_SETTINGS_SURFACE,
  ListBody,
  ListCell,
  ListHead,
  ListMetaChip,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  useViewportFillCap,
  type ListSurface,
  type ProgressiveRows,
} from "../../../../../shared/portal-v2/list-table";
import type { ProgressiveRows } from "../../../../../shared/portal-v2/list-table";

/** The rentals list's class strings, one place. */
export const LIST_CLASSES = {
  scrollRoot:
    "p-0 overflow-x-auto max-h-[520px] overflow-y-auto no-scrollbar-from-md relative [&>[data-slot=table-container]]:overflow-visible",
  /**
   * Added to the scroll root of a list that fills the window (`fillViewport`).
   * Reaching the end of the rows does not hand the wheel on to the page, which
   * would otherwise shove the header and overview off screen mid-flick. From
   * `md` only, like the fill: on a phone the page has to keep scrolling past a
   * 520px box.
   */
  fillViewport: "md:overscroll-contain",
  header: "sticky top-0 z-10 bg-card/95 backdrop-blur-sm",
  headerRow: "border-b hover:bg-transparent",
  // Team lead, Sep 23 2026: headings and cells read LEFT, reversing the Sep 17
  // "centre everything" review — a centred heading over a left-ish column left
  // a band of dead space down the left of every list.
  //
  // `text-left` stays LAST, where `text-center` stood: the lockstep test strips
  // the width out of the rentals heading (`h-10 w-[20%] `) and matches the rest
  // verbatim. Position inside this string is the only thing it fixes — a call
  // site's own alignment arrives later in `cn(LIST_CLASSES.head, className)`, so
  // `text-right` (money, and the trailing actions column) still wins through
  // tailwind-merge. Stated rather than left to inherit, so the exported string
  // says what the column does and a diff against it is readable.
  head: "h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left",
  cell: "py-3 text-left",
  identifier: "font-semibold tabular-nums tracking-tight text-foreground",
  text: "font-medium text-foreground",
  metaChip:
    "rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
  footer: "flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted-foreground",
  showMore: "h-7 px-2 text-xs font-normal text-muted-foreground hover:text-foreground",
} as const;

/**
 * Status is coloured text, and hue is the only thing that changes. The rentals
 * list's mapping: Active is success, Upcoming info, Pending warning, Cancelled
 * and Rejected danger, Completed muted (the most common value and the least
 * actionable, so it recedes).
 */
export type ListTone = "success" | "info" | "warning" | "danger" | "muted";

export const LIST_TONES: Record<ListTone, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  info: "text-blue-600 dark:text-blue-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-red-500 dark:text-red-400",
  muted: "text-muted-foreground",
};

/**
 * A row's trailing icon button, such as a "⋯" menu trigger. The negative
 * vertical margin stops a 32px button from making its row taller than a plain
 * row. Without it a table with buttons on only some rows (Fines: Open fines
 * only) changes height as you scroll, and a table with a button on every row
 * sits taller than the rentals rows it is meant to match.
 */
export const LIST_ROW_ACTION = "-my-1.5 h-8 w-8 text-muted-foreground hover:text-foreground";

/**
 * No pager: how much of the set is on screen, and "Show more" as the way to
 * row 26 when the observer never fires (no IntersectionObserver, or a keyboard
 * user who never scrolls the inner box).
 */
export function ListFooter({
  rows,
  one,
  many,
  serverTotal,
  hideWhenAllShown = false,
}: {
  rows: Pick<ProgressiveRows<unknown>, "visible" | "total" | "hasMore" | "showMore">;
  one: string;
  many: string;
  /**
   * The size of the whole set on the server, for a page that loads its rows up
   * to a cap (PostgREST returns at most 1,000 per request). Without it a capped
   * list would finish with "All 1000 payments shown" over a set of 1,450.
   */
  serverTotal?: number;
  /**
   * Settings tables: render nothing once every row is on screen. "All 3
   * holidays shown" under three visible rows says nothing the table does not.
   * While rows are still to come, or a fetch cap left some on the server, the
   * line shows as usual.
   */
  hideWhenAllShown?: boolean;
}) {
  const total = serverTotal !== undefined && serverTotal > rows.total ? serverTotal : rows.total;
  if (hideWhenAllShown && !rows.hasMore && total <= rows.total) return null;
  return (
    <div className={LIST_CLASSES.footer}>
      <span>
        {rows.hasMore
          ? `Showing ${rows.visible.length} of ${total} ${many}`
          : total > rows.total
          ? `Showing the first ${rows.total} of ${total} ${many}. Search or filter to narrow them down.`
          : `All ${rows.total} ${rows.total === 1 ? one : many} shown`}
      </span>
      {rows.hasMore && (
        <Button variant="ghost" size="sm" onClick={rows.showMore} className={LIST_CLASSES.showMore}>
          Show more
        </Button>
      )}
    </div>
  );
}
