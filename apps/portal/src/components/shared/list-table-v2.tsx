"use client";

/**
 * The v2 list table: the rentals list's table, as parts every v2 list uses.
 *
 * The rentals list (`rentals-v2/rentals-list-v2.tsx`) is the reference. Its
 * table is a card whose body scrolls inside itself with the scrollbar hidden,
 * under a sticky, blurred header of small uppercase column names. The row's
 * identifier is weighted and everything else is plain text; status is coloured
 * TEXT, never a pill; the whole row opens the record; and there is no pager.
 * Rows arrive 25 at a time as the operator scrolls, with one quiet line under
 * the card saying how much of the set is on screen.
 *
 * Every v2 list builds its table from these parts so the lists cannot drift
 * apart. The class strings are exported, and `list-table-v2.test.tsx` checks the
 * rentals list still uses the same ones, so a change on either side fails.
 *
 * v2 only. A shared v1 page mounts these inside its `useV2("chrome")` branch;
 * every other tenant keeps the page's own table and pager.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui-v2/card";
import { Button } from "@/components/ui-v2/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui-v2/table";
import { cn } from "@/lib/utils";

/** Rows on first paint, and rows each fill adds. The rentals list's figure. */
export const LIST_ROWS_PER_FILL = 25;

/** The rentals list's class strings, one place. */
export const LIST_CLASSES = {
  scrollRoot:
    "p-0 overflow-x-auto max-h-[520px] overflow-y-auto no-scrollbar relative [&>[data-slot=table-container]]:overflow-visible",
  header: "sticky top-0 z-10 bg-card/95 backdrop-blur-sm",
  headerRow: "border-b hover:bg-transparent",
  head: "h-10 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
  cell: "py-3",
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

export interface ProgressiveRows<T> {
  /** The rows to render: the first `LIST_ROWS_PER_FILL × fills` of the set. */
  visible: T[];
  total: number;
  hasMore: boolean;
  showMore: () => void;
  scrollRootRef: RefObject<HTMLDivElement>;
  /** A callback ref, so the observer starts whenever the sentinel mounts. */
  sentinelRef: (node: HTMLDivElement | null) => void;
}

/**
 * Infinite scroll over rows the page already holds in memory: growing the list
 * is a bigger slice, with no new query.
 *
 * `resetKey` must change whenever the result set does (search, filters, sort,
 * tenant) and ONLY then. It is compared as a string rather than keyed off the
 * rows array because that array is a new object on every background refetch,
 * and resetting on it would snap an operator at row 300 back to row 25.
 *
 * The reset happens during render, not in an effect, so a narrowed set never
 * paints once with the old grown count (which would leave the sentinel inside
 * its margin and fire a fill against rows about to be discarded).
 */
export function useProgressiveRows<T>(rows: readonly T[], resetKey: string): ProgressiveRows<T> {
  const [visibleCount, setVisibleCount] = useState(LIST_ROWS_PER_FILL);
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setVisibleCount(LIST_ROWS_PER_FILL);
  }

  const hasMore = visibleCount < rows.length;
  const showMore = useCallback(() => setVisibleCount((count) => count + LIST_ROWS_PER_FILL), []);

  // The body scrolls INSIDE the card, so the observer roots on that container:
  // with the viewport as root the sentinel is clipped by the card long before
  // it reaches the viewport. `rootMargin` buys ~300px of lead inside the box.
  const scrollRootRef = useRef<HTMLDivElement>(null);

  // The sentinel is held in STATE through a callback ref, not in a ref object.
  // A page calls this hook above its `if (isLoading) return`, so rows can arrive
  // while the skeleton is still up: `hasMore` turns true with no sentinel in the
  // DOM, the effect bails, and when the table then mounts nothing it depends on
  // has changed, so it never ran again and the list sat at 25 rows. Vehicles hit
  // it whenever its list query landed before its P&L query. With the node in
  // state, the table mounting is itself the change that starts the observer.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore();
      },
      { root: scrollRootRef.current, rootMargin: "300px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-armed on every fill: if the sentinel is still inside the margin after
    // a fill, the next one follows at once. That is what keeps a fast flick
    // from outrunning the list and fills a tall viewport on first paint.
  }, [sentinel, hasMore, visibleCount, showMore]);

  // A new result set starts at its first row. Without this the box kept its
  // scroll offset: 75 rows deep, a new search dropped back to 25 rows and the
  // browser clamped the offset to the bottom of those, so the top matches of
  // the new search opened scrolled out of sight. Skipped on first mount.
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (scrollRootRef.current) scrollRootRef.current.scrollTop = 0;
  }, [lastResetKey]);

  return {
    visible: rows.slice(0, visibleCount),
    total: rows.length,
    hasMore,
    showMore,
    scrollRootRef,
    sentinelRef: setSentinel,
  };
}

type RowsShell = Pick<ProgressiveRows<unknown>, "scrollRootRef" | "sentinelRef" | "hasMore">;

/**
 * The card, its scrolling body (the observer's root), the table and the "more
 * coming" bars.
 *
 * ui-v2's `Table` wraps the `<table>` in its own `overflow-x-auto` div. An
 * overflow box is a scroll container, so the sticky header pinned to THAT div,
 * which never scrolls vertically, and scrolled away with the rows. It also put
 * a native horizontal scrollbar under the rows whenever the table was wider
 * than the card. The scroll root's classes turn that wrapper's overflow off, so
 * the card body alone scrolls both ways, with its scrollbar hidden.
 */
export function ListTable({
  rows,
  minWidth = "min-w-[720px]",
  children,
}: {
  rows: RowsShell;
  /** Below this the table scrolls sideways instead of crushing its columns. */
  minWidth?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent ref={rows.scrollRootRef} className={LIST_CLASSES.scrollRoot}>
        {/* `table-fixed`: columns keep their declared widths instead of auto
            layout handing every spare pixel to the one unsized column. */}
        <Table className={cn(minWidth, "table-fixed")}>{children}</Table>

        {/* The sentinel, inside the scroll container after the last row. The
            bars read as "more coming" on a slow frame; `aria-hidden` because
            the footer line says the same thing in words. */}
        {rows.hasMore && (
          <div ref={rows.sentinelRef} aria-hidden="true" className="space-y-3 px-4 py-4">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-4">
                <div className="h-3 w-20 animate-pulse rounded-full bg-muted" />
                <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
                <div className="h-3 w-16 animate-pulse rounded-full bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Sticky while the body scrolls: nearly opaque, blurred behind. */
export function ListTableHeader({ children }: { children: ReactNode }) {
  return (
    <TableHeader className={LIST_CLASSES.header}>
      <TableRow className={LIST_CLASSES.headerRow}>{children}</TableRow>
    </TableHeader>
  );
}

export type ListSortDirection = "asc" | "desc" | null;

/**
 * A column name. Pass `className` for its width (`w-[20%]`) and alignment.
 * Pass `sort` to make it a sort control: the arrow shows the active direction,
 * and an inactive sortable column shows a faint up/down mark.
 */
export function ListHead({
  className,
  children,
  sort,
  ...props
}: Omit<ComponentProps<"th">, "children"> & {
  children?: ReactNode;
  sort?: { direction: ListSortDirection; onSort: () => void };
}) {
  if (!sort) {
    return (
      <TableHead className={cn(LIST_CLASSES.head, className)} {...props}>
        {children}
      </TableHead>
    );
  }
  const Icon = sort.direction === "asc" ? ArrowUp : sort.direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      className={cn(LIST_CLASSES.head, className)}
      aria-sort={sort.direction === "asc" ? "ascending" : sort.direction === "desc" ? "descending" : "none"}
      {...props}
    >
      <button
        type="button"
        onClick={sort.onSort}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-wider hover:text-foreground"
      >
        {children}
        <Icon className={cn("size-3", sort.direction ? "text-foreground" : "opacity-50")} />
      </button>
    </TableHead>
  );
}

export const ListBody = TableBody;

/** A body row. `onOpen` makes the whole row open the record. */
export function ListRow({
  className,
  onOpen,
  ...props
}: ComponentProps<"tr"> & { onOpen?: () => void }) {
  const handleClick = onOpen
    ? () => {
        // Letting go of a drag-select inside the row fires a click on the row.
        // That is someone copying an email or a registration, not asking to
        // open the record.
        if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
        onOpen();
      }
    : undefined;
  return <TableRow className={cn(onOpen && "cursor-pointer", className)} onClick={handleClick} {...props} />;
}

export function ListCell({ className, ...props }: ComponentProps<"td">) {
  return <TableCell className={cn(LIST_CLASSES.cell, className)} {...props} />;
}

export function ListStatusText({ tone, children }: { tone: ListTone; children: ReactNode }) {
  return <span className={cn("text-sm font-medium", LIST_TONES[tone])}>{children}</span>;
}

/** Secondary facts beside a value: one quiet, uncoloured treatment for all of them. */
export function ListMetaChip({ children }: { children: ReactNode }) {
  return <span className={LIST_CLASSES.metaChip}>{children}</span>;
}

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
}) {
  const total = serverTotal !== undefined && serverTotal > rows.total ? serverTotal : rows.total;
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
