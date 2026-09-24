"use client";

/**
 * The v2 rentals list.
 *
 * A verbatim copy of `(dashboard)/rentals/page.tsx` as it stands on main, with
 * three additions layered on top and nothing else changed:
 *
 *   1. the overview row above the table — status donut, new-rentals trend,
 *      booked value, and the calendar-view card (`rentals-overview.tsx`)
 *   2. the request chips beneath it (`rentals-request-chips.tsx`)
 *   3. the v2 filter surface, which was previously swapped inline in the page
 *   4. infinite scroll in place of the numbered pager — see `ROWS_PER_FILL` and
 *      the sentinel below. `?page=` is ignored here from now on.
 *
 * Copied rather than shared, per V2_PLAN §3: the v1 page keeps working byte for
 * byte for the tenants still on it, this file is free to move, and retiring the
 * area is deleting a directory and one `if`.
 *
 * The query is untouched. `useEnhancedRentals` is called with exactly the same
 * filters object the v1 page builds — the same rows, in the same order, for the
 * same tenant. Everything added here is presentation above the table, or a
 * count that filters by `tenant_id` itself (§5).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// CardHeader / CardTitle / CardDescription came across with the copy but the
// only Card left on this screen is the table's shell — the four tiles they
// titled are now `rentals-overview.tsx`, which imports its own.
import { Card, CardContent } from "@/components/ui-v2/card";
import { Button } from "@/components/ui-v2/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui-v2/table";
import {
  FileText,
  Plus,
  XCircle,
  ShieldAlert,
  CalendarDays,
  Download,
  List,
} from "lucide-react";
import { parseLocalDate } from "@/lib/date-utils";
import { useEnhancedRentals, RentalFilters, EnhancedRental } from "@/hooks/use-enhanced-rentals";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { countActiveRentalFilters } from "@/components/rentals-v2/rentals-filter-panel";
import { RentalsFilterPanel } from "@/components/rentals-v2/rentals-filter-panel";
import { RentalsOverview } from "@/components/rentals-v2/rentals-overview";
import { RentalsOverviewFlip } from "@/components/rentals-v2/rentals-overview-flip";
import { ConnectedTimeline } from "@/components/timeline-v2/connected-timeline";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalCreationGate } from "@/hooks/use-rental-creation-gate";
import { ConnectStripeRequiredDialog } from "@/components/rentals/connect-stripe-required-dialog";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { RentalsTeachingEmptyState } from "@/components/empty-states/lean-empty-states";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { useIsLean } from "@/lib/lean-context";
import { TabTourButton } from "@/components/onboarding/tab-tour-button";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2, HeaderIconButton } from "@/components/shared/header-icon-button-v2";
import { useViewportFillCap } from "@/components/shared/list-table-v2";
import { csvDate, csvFilename, downloadCsv } from "@/lib/csv-export";

/**
 * `30 Sep`, or `30 Sep 2027` when the year is not the current one.
 *
 * Slash-form dates (`9/30/2026`) are ambiguous to half the world and hard to
 * scan in a dense column; the year is dropped when it is this year because in a
 * rentals list it is nearly always redundant and repeating it four times a row
 * is noise. Rendered in `tabular-nums` at the call site so the days line up
 * down the page.
 *
 * `parseLocalDate`, never `new Date(value)`: these are date-only strings, and
 * `new Date("2026-09-30")` is parsed as UTC midnight, which renders as the 29th
 * for every user west of Greenwich.
 */
const RENTAL_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const RENTAL_DATE_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const formatRentalDate = (value: string | null | undefined): string => {
  if (!value) return "—";
  const d = parseLocalDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.getFullYear() === new Date().getFullYear()
    ? RENTAL_DATE.format(d)
    : RENTAL_DATE_WITH_YEAR.format(d);
};

/**
 * The status column: coloured TEXT, no pill.
 *
 * A pill draws a filled, ringed shape around every row of a 45-row column, so
 * the eye counts shapes before it reads words and the column shouts louder than
 * anything else on the screen. The word in its own colour carries exactly the
 * same meaning at a fraction of the weight — and it is what the portal's design
 * system already specifies for table status columns.
 *
 * Each tone is a text colour plus a dark-mode step, so the word stays legible
 * in both themes without one hardcoded light value. Completed is deliberately
 * muted rather than coloured: it is the most common value and the least
 * actionable, so it should recede.
 */
const STATUS_TONE: Record<string, string> = {
  Active: "text-emerald-600 dark:text-emerald-400",
  Upcoming: "text-blue-600 dark:text-blue-400",
  Pending: "text-amber-600 dark:text-amber-400",
  Completed: "text-muted-foreground",
  Cancelled: "text-red-500 dark:text-red-400",
  Rejected: "text-red-500 dark:text-red-400",
};

function RentalStatusText({ status }: { status: string }) {
  return (
    <span className={`text-sm font-medium ${STATUS_TONE[status] ?? "text-muted-foreground"}`}>
      {status}
    </span>
  );
}

/**
 * Everything in the status column that is NOT the status. One quiet, uncoloured
 * treatment for all of them on purpose: PAYG and auto-extend are facts about
 * how the rental bills, not states competing with it, and giving each its own
 * colour is what turned this column into four badges of equal loudness.
 */
function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

/**
 * Is any FILTER set on the rentals list?
 *
 * `useEnhancedRentals` filters in memory and returns only the filtered rows —
 * there is no unfiltered count to compare against — so "this tenant has no
 * rentals" has to be inferred as "nothing came back AND nothing was asked for".
 *
 * Written as a sweep over the keys rather than a hand-written list of
 * comparisons on purpose. `RentalFilters` has grown twice already (bonzahStatus,
 * depositHold), and a hand-written check silently goes stale when the next one
 * lands: the new filter would exclude every row while this still reported "no
 * filters", and an operator with a full book would be told they have no rentals
 * and shown a beginner's tutorial. Sweeping means an unrecognised key counts as
 * a filter, so the failure direction is a missed teaching moment, never a
 * wrong one.
 *
 * Only these four keys are not filters. Everything else narrows the list.
 */
const NON_FILTER_KEYS = new Set(["sortBy", "sortOrder", "page", "pageSize"]);

function hasAnyRentalFilter(filters: RentalFilters): boolean {
  return Object.entries(filters).some(([key, value]) => {
    if (NON_FILTER_KEYS.has(key)) return false;
    if (value === undefined || value === null) return false;
    // The list's own "everything" sentinels, set on first paint.
    if (value === "" || value === "all") return false;
    if (value === false) return false;
    return true;
  });
}

/**
 * How many rows the list starts with, and how many each fill adds.
 *
 * Matches `ITEMS_PER_PAGE` in `use-enhanced-rentals` (25) on purpose: that is
 * the slice the hook has always handed the v1 page, so the first paint of the
 * v2 list is the same amount of table it has always been — only the way you get
 * to row 26 has changed. The constant is duplicated rather than imported
 * because the hook does not export it, and this file must not be edited into
 * the shared hook (V2_PLAN §3).
 */
const ROWS_PER_FILL = 25;

/**
 * Keys that must NOT reset the fill.
 *
 * `page`/`pageSize` are the only two: everything else in `RentalFilters`
 * changes which rows come back, or the order they come back in, and either one
 * invalidates how far the operator had scrolled.
 */
const RESULT_KEY_IGNORED = new Set(["page", "pageSize"]);

export function RentalsListV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  // The /dev preview switch for the teaching state (lib/dev-overrides.ts).
  // Inert outside development, and — although only northwind reaches this
  // list — kept INSIDE the slug gate like every other consumer.
  const devForceEmpty = useForcedEmptyState("rentals");
  const devForceEmptyRentals = useIsLean() && devForceEmpty;
  // Lean tenants only; a constant false for everyone else.
  const { blocked: rentalCreationBlocked } = useRentalCreationGate();
  const [showConnectStripeDialog, setShowConnectStripeDialog] = useState(false);

  const currentView = searchParams.get("view") || "list";

  /**
   * The filter panel is not a drop-down any more: it is the BACK of the
   * overview card, and the button inside the search field turns the card over.
   * The state therefore lives up here, where both the bar and the slot can see
   * it, rather than inside the bar as it did when the bar owned the panel too.
   *
   * Gated on the view, because the overview — and so the slot the panel lives
   * in — is list-only. Without the guard, `?view=calendar` with filters open
   * would leave a flipped card with nothing to flip.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersFlipped = filtersOpen && currentView !== "calendar";


  // Parse filters from URL
  const filters: RentalFilters = useMemo(
    () => ({
      search: searchParams.get("search") || "",
      status: searchParams.get("status") || "all",
      paymentMode: searchParams.get("paymentMode") || "all",
      duration: searchParams.get("duration") || "all",
      durationMin: searchParams.get("durationMin")
        ? parseInt(searchParams.get("durationMin")!)
        : undefined,
      durationMax: searchParams.get("durationMax")
        ? parseInt(searchParams.get("durationMax")!)
        : undefined,
      initialPayment: searchParams.get("initialPayment") || "all",
      startDateFrom: searchParams.get("startDateFrom")
        ? new Date(searchParams.get("startDateFrom")!)
        : undefined,
      startDateTo: searchParams.get("startDateTo")
        ? new Date(searchParams.get("startDateTo")!)
        : undefined,
      // Newest added first, always. v2 lists cannot be re-ordered (team lead,
      // Sep 2026), so an old `?sortBy=` / `?sortOrder=` link is ignored rather
      // than quietly shuffling the list with no control on screen to undo it.
      sortBy: "created_at",
      sortOrder: "desc",
      // No `page`. The v2 list scrolls, so a `?page=` in the URL means nothing
      // here — and parsing it back would put it in the hook's query key, giving
      // the same rows a second cache entry for no reason. The hook still slices
      // its own `rentals` page internally for v1's benefit; this file reads
      // `allRentals` and ignores it.
      bonzahStatus: searchParams.get("bonzahStatus") || undefined,
      // Set by the app-wide deposit-hold banner CTAs. Without this the banner
      // counts N rentals and then hands the operator an unfiltered list.
      depositHold: searchParams.get("depositHold") || undefined,
      // `useEnhancedRentals` has always read these three and the filter surface
      // has always written them, but nothing parsed them back out of the URL —
      // so a click set the parameter and the very next render dropped it again.
      // They are parsed here rather than in the v1 page because v1's own bar
      // offers the same three controls, and parsing them there would start
      // narrowing the list for tenants whose rows must not move.
      paymentType: (searchParams.get("paymentType") as "payg" | "regular" | null) || undefined,
      extensionRequested: searchParams.get("extensionRequested") === "true" || undefined,
      cancellationRequested:
        searchParams.get("cancellationRequested") === "true" || undefined,
    }),
    [searchParams]
  );

  const { data, isLoading } = useEnhancedRentals(filters);

  // `rentals` (the hook's own page slice) and `totalPages` are deliberately not
  // destructured — this list has no pages, and leaving them named would invite
  // someone to render the slice again.
  const { allRentals, stats, totalCount } = data || {
    allRentals: [],
    stats: null,
    totalCount: 0,
  };

  /**
   * Infinite scroll — with no new query.
   *
   * `useEnhancedRentals` already fetches every rental for the tenant in ONE
   * Supabase call and filters them client-side, so `allRentals` is the entire
   * filtered set, in sort order, sitting in memory. Growing the list is
   * therefore a bigger `.slice()` and nothing else: no `.range()`, no
   * `useInfiniteQuery`, no second round trip. Anything fancier here would be
   * theatre over data the browser already has.
   */
  const [visibleCount, setVisibleCount] = useState(ROWS_PER_FILL);

  /**
   * A fingerprint of everything that decides WHICH rows come back and in what
   * order — the hook's own query key, minus `page`/`pageSize`.
   *
   * Swept over the keys rather than hand-listed, for exactly the reason
   * `hasAnyRentalFilter` above is: `RentalFilters` has grown twice already, and
   * a hand-written list quietly stops resetting when the next filter lands —
   * which is the failure that leaves 200 rows' worth of scroll position sitting
   * over a 12-row result. Sorted, so key order in the object literal cannot
   * matter.
   */
  const resultKey = useMemo(() => {
    const parts = Object.entries(filters)
      .filter(([key]) => !RESULT_KEY_IGNORED.has(key))
      .map(
        ([key, value]) =>
          `${key}=${value instanceof Date ? value.toISOString() : String(value)}`
      )
      .sort();
    return `${tenant?.id ?? ""}|${parts.join("&")}`;
  }, [filters, tenant?.id]);

  // Reset the fill whenever the result set changes: a new search, a status
  // filter, a different sort, a different tenant.
  //
  // Keyed off the filter VALUES, not the identity of `allRentals` — that array
  // is a fresh object on every refetch, so resetting on it would snap an
  // operator who had scrolled to row 300 back to row 25 every time React Query
  // revalidated in the background.
  //
  // Adjusted during render (React's documented "changing state in response to a
  // prop change") rather than in an effect, so the narrowed set never paints
  // once with the old grown count. An effect would leave one frame in which the
  // container is still tall enough to sit the sentinel inside its own
  // `rootMargin`, which fires the observer against rows that are about to be
  // thrown away.
  const [lastResultKey, setLastResultKey] = useState(resultKey);
  if (resultKey !== lastResultKey) {
    setLastResultKey(resultKey);
    setVisibleCount(ROWS_PER_FILL);
  }

  const visibleRentals = allRentals.slice(0, visibleCount);
  const hasMore = visibleCount < allRentals.length;

  const showMore = useCallback(
    () => setVisibleCount((count) => count + ROWS_PER_FILL),
    []
  );

  // The table body scrolls INSIDE the card (`max-h-[520px]`, or the room left
  // in the window from `md` up — see `tableFillCap` below), not with the
  // page, so the sentinel is clipped by that container long before it would
  // ever reach the viewport. The observer therefore has to take the container
  // as its root — with the default (viewport) root it would only fire once the
  // whole card had scrolled past, which is never, because the card never
  // scrolls past. `rootMargin` then buys ~300px of lead inside that box so the
  // next fill lands before the operator hits the true bottom.
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore();
      },
      { root: scrollRootRef.current, rootMargin: "300px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-armed on every fill: the sentinel moves down with the rows that were
    // just added, and if it is STILL inside the margin the next fill follows
    // immediately. That chain is what stops a fast flick from outrunning the
    // list, and it also fills a viewport too tall for 25 rows on first paint.
  }, [hasMore, visibleCount, showMore]);

  /**
   * From `md` up the table's scroll box fills the window under it instead of
   * stopping at 520px, so the list is the screen and the page itself does not
   * scroll (the kit's `useViewportFillCap`, which the other window-filling
   * lists get through `ListTable fillViewport`). Its condition is the table
   * branch's below, word for word: the measurement runs when the box mounts,
   * and a box that mounted without this turning true would never be measured.
   */
  const tableMounted =
    !isLoading && currentView !== "calendar" && allRentals.length > 0 && !devForceEmptyRentals;
  const tableFillCap = useViewportFillCap(scrollRootRef, tableMounted);

  const handleFiltersChange = (newFilters: RentalFilters) => {
    const params = new URLSearchParams();
    Object.entries(newFilters).forEach(([key, value]) => {
      // The filter surfaces (`rentals-filter-bar`, `rentals-filter-panel`,
      // `rentals-request-chips`) still send `page: 1` with every change, since
      // they are written against the paginated v1 contract. Drop it here rather
      // than writing a URL parameter that nothing on this screen reads.
      if (RESULT_KEY_IGNORED.has(key)) return;
      // Fixed above (newest first), so writing them would only advertise a
      // sort the list does not offer.
      if (key === "sortBy" || key === "sortOrder") return;
      if (value && value !== "all" && value !== "" && value !== 1) {
        if (value instanceof Date) {
          params.set(key, value.toISOString().split("T")[0]);
        } else {
          params.set(key, value.toString());
        }
      }
    });
    router.push(`?${params.toString()}`);
  };
  /**
   * Lend the top bar this page's search and filter button.
   *
   * `null` in calendar view, which is what the old inline bar did by not
   * rendering: there is no list to search there, and a field that filters
   * nothing is worse than no field. Handing back null returns the bar to the
   * global ⌘K pill.
   *
   * `tourAnchor` carries `data-tour="rentals-search"` across with it. The
   * rentals tab tour anchors a step to that attribute, and a missing anchor
   * does not fail loudly — it waits out the timeout, skips, and eats the wait
   * budget of every later step on this route.
   */
  usePageSearch(
    currentView === "calendar"
      ? null
      : {
          placeholder: "Search customer, reg, rental #…",
          value: filters.search || "",
          onChange: (next) => handleFiltersChange({ ...filters, search: next, page: 1 }),
          tourAnchor: "rentals-search",
          filters: {
            open: filtersFlipped,
            onOpenChange: setFiltersOpen,
            activeCount: countActiveRentalFilters(filters),
          },
        },
  );

  const handleClearFilters = () => {
    const params = new URLSearchParams();
    if (currentView !== "list") params.set("view", currentView);
    router.push(params.toString() ? `?${params.toString()}` : "?");
  };

  const handleViewChange = (view: string) => {
    // Leaving the list takes the panel's slot with it, so close it on the way
    // out rather than coming back to a card already turned over.
    setFiltersOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    if (view === "list") {
      params.delete("view");
    } else {
      params.set("view", view);
    }
    router.push(`?${params.toString()}`);
  };

  // The rentals the list is showing, filters and search applied: the same set
  // the overview graph and the table read.
  const handleExportCsv = () => {
    const currency = tenant?.currency_code || "USD";
    downloadCsv(
      csvFilename("rentals"),
      ["Rental #", "Customer", "Vehicle", "Pickup", "Return", "Status", "Total", "Currency", "Booked on"],
      allRentals.map((r) => [
        r.rental_number,
        r.customer?.name ?? "",
        r.vehicle ? `${r.vehicle.reg} (${r.vehicle.make} ${r.vehicle.model})` : "",
        csvDate(r.start_date),
        csvDate(r.end_date),
        r.computed_status,
        Number(r.total_amount) || 0,
        currency,
        csvDate(r.created_at),
      ]),
    );
  };


  if (isLoading) {
    // md:pt-6 (switch row alignment): the loaded list pads its top 24px at md,
    // so its title starts at y=74 (centred at 92, on the sidebar switch's row).
    // Without it this skeleton started at y=50, 14px under the 64px top bar.
    return (
      <div className="space-y-6 md:pt-6">
        <div className="h-8 bg-muted animate-pulse rounded"></div>
        <div className="h-96 bg-muted animate-pulse rounded"></div>
      </div>
    );
  }

  return (
    <div className={currentView === "calendar" ? "p-4 md:p-6 space-y-6" : "container mx-auto p-4 md:p-6 space-y-6"}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0 shrink-0 flex items-start justify-between gap-3 sm:block">
          <div className="min-w-0" data-tour="rentals-header">
            <h1 className="text-2xl sm:text-3xl font-bold">Rentals</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Manage rental agreements and contracts
            </p>
          </div>
        </div>
        {/* Search and New Rental are ONE cluster, not two ends of a spread row.
            The two things an operator comes to this page to do — find a rental,
            or start one — sit side by side, and the pair is pushed right as a
            unit so the gap falls between the title and the cluster rather than
            down the middle of it.

            `items-start`, because the filter PANEL expands downward out of the
            search cell: without it New Rental would drift to the vertical
            middle of an open panel.

            Search is hidden in calendar view, where it has nothing to filter —
            New Rental stays. */}
        <div className={`flex w-full min-w-0 items-start gap-2 sm:w-auto sm:flex-1 sm:justify-end ${HEADER_ACTIONS_V2}`}>
          {/* The search field and its filter toggle used to be drawn here, in
              the page header, by `RentalsFilterBar`. They now live in the top
              bar — lent to it by the `usePageSearch` call above — because two
              search boxes on one screen, one global and one for this list with
              nothing on screen saying which is which, is exactly the confusion
              the top bar was introduced to remove.
              The PANEL is untouched: it still flips onto the back of the
              overview card below, driven by the same `filtersOpen` state. */}
          <div className="flex shrink-0 items-center gap-2">
          {/* One labelled button, New Rental; every other control is an icon
              with its name in a tooltip (team lead, Sep 15 2026). The calendar
              icon is the header's own way into the timeline, so reaching it
              never depends on which featured card is showing, and in calendar
              view it turns into the way back to the list. Export writes the
              rentals the list is showing, filters and search applied.
              /rentals/analytics still resolves if navigated to directly. */}
          {/* Every control here is 32px and the cluster sits on the subtitle line
              (HEADER_ACTIONS_V2 / HEADER_PRIMARY_V2, team lead Sep 16 2026). */}
          <TabTourButton tour="rentals" size="h-9" />
          {currentView === "calendar" ? (
            <HeaderIconButton label="List view" onClick={() => handleViewChange("list")}>
              <List className="size-4" />
            </HeaderIconButton>
          ) : (
            <>
              <HeaderIconButton
                label="Calendar view"
                onClick={() => handleViewChange("calendar")}
                data-tour="rentals-calendar"
              >
                <CalendarDays className="size-4" />
              </HeaderIconButton>
              <HeaderIconButton label="Export CSV" onClick={handleExportCsv} disabled={allRentals.length === 0}>
                <Download className="size-4" />
              </HeaderIconButton>
            </>
          )}
          {canEdit('rentals') && (
            <Button
              // Lean tenants without a usable Stripe Connect account get told
              // why instead of a form that cannot take a payment. Non-lean
              // tenants are never blocked, so this navigates as it always did.
              onClick={() =>
                rentalCreationBlocked
                  ? setShowConnectStripeDialog(true)
                  : router.push("/rentals/new")
              }
              data-tour="new-rental"
              className={`bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg flex-1 sm:flex-none ${HEADER_PRIMARY_V2}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Rental
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Overview — list view only, and the filter panel is its other face. */}
      {currentView !== "calendar" && (
        <RentalsOverviewFlip
          flipped={filtersFlipped}
          onFlipBack={() => setFiltersOpen(false)}
          front={
            <RentalsOverview
              stats={stats}
              rentals={allRentals}
              currencyCode={tenant?.currency_code || "USD"}
              filtered={countActiveRentalFilters(filters) > 0 || !!filters.search}
              onOpenCalendar={() => handleViewChange("calendar")}
            />
          }
          back={
            <RentalsFilterPanel
              filters={filters}
              onChange={handleFiltersChange}
              onClear={handleClearFilters}
              onClose={() => setFiltersOpen(false)}
            />
          }
        />
      )}

      {/* Calendar View */}
      {currentView === "calendar" ? (
            <ConnectedTimeline scope={{ kind: "all" }} />
      ) : /* Rentals Table */
      allRentals.length > 0 && !devForceEmptyRentals ? (
        <>
          <Card>
            {/* The scroll root the observer measures against — see the sentinel
                at the foot of this container. */}
            {/* The last class switches off ui-v2 Table's own overflow-x-auto
                wrapper. As a scroll container of its own, it was what the
                sticky header pinned to, and it never scrolls vertically, so the
                header scrolled away with the rows. Kept identical to
                LIST_CLASSES.scrollRoot + LIST_CLASSES.fillViewport in
                components/shared/list-table-v2.tsx; the inline max-height is
                the measured window fill, and replaces the 520px from md up. */}
            <CardContent
              ref={scrollRootRef}
              className="p-0 overflow-x-auto max-h-[520px] overflow-y-auto no-scrollbar-from-md relative [&>[data-slot=table-container]]:overflow-visible md:overscroll-contain"
              style={tableFillCap !== undefined ? { maxHeight: tableFillCap } : undefined}
            >
              {/* `table-fixed` with declared widths, so the five columns keep
                  their proportions instead of handing every spare pixel to
                  Customer — which is what auto layout does when only one column
                  is unsized, and it left a hand's width of nothing between the
                  name and the dates. */}
              <Table className="min-w-[720px] table-fixed">
                {/* Sticky while the body scrolls inside the card. Nearly opaque
                    rather than fully so, with a blur behind it: rows passing
                    underneath stay hidden, but the header does not look like a
                    separate slab sitting on the card. */}
                <TableHeader className="sticky top-0 z-10 bg-card/95 backdrop-blur-sm">
                  <TableRow className="border-b hover:bg-transparent">
                    <TableHead className="h-10 w-[20%] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">
                      Rental #
                    </TableHead>
                    <TableHead className="h-10 w-[28%] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">
                      Customer
                    </TableHead>
                    <TableHead className="h-10 w-[16%] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">
                      Pickup
                    </TableHead>
                    <TableHead className="h-10 w-[16%] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">
                      Return
                    </TableHead>
                    <TableHead className="h-10 w-[20%] text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left">
                      Status
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRentals.map((rental) => {
                    // The row-level flag, resolved ONCE. It decides both the
                    // row's tint and the line under the rental number, and
                    // working it out twice is how those two drift apart.
                    //
                    // `is_extended` is deliberately NOT a flag: extensions are
                    // out of scope for this screen while the rental model is
                    // being settled, and an extension row was the one case that
                    // grew taller than every other row for something nobody has
                    // decided what to do with yet.
                    const flag = rental.cancellation_requested
                      ? "cancelling"
                      : !filters.bonzahStatus && rental.bonzah_status === "insufficient_balance"
                      ? "balance"
                      : !filters.bonzahStatus && rental.bonzah_status === "quoted"
                      ? "quoted"
                      : null;

                    return (
                      <TableRow
                        key={rental.id}
                        data-tour="rental-row"
                        // Inert markers, read by `lib/tab-tours` so the Rentals
                        // tour can walk from this list INTO a rental record.
                        // This row navigates via onClick and emits no href, so
                        // there is otherwise nothing on the page that names a
                        // rental id — and without one the tour's seven record
                        // steps drop silently and it looks merely short.
                        data-record-kind="rentals"
                        data-record-id={rental.id}
                        // The tint is halved and the rail thinned from 4px to
                        // 2px: with three columns gone there is far less on the
                        // row to compete with, so the flag no longer has to
                        // shout to be seen — and a wall of amber rows is what
                        // stops any one of them being noticed.
                        className={`cursor-pointer ${
                          flag === "cancelling"
                            ? "bg-red-500/5 border-l-2 border-l-red-500"
                            : flag === "balance" || flag === "quoted"
                            ? "bg-[#CC004A]/5 border-l-2 border-l-[#CC004A]"
                            : ""
                        }`}
                        onClick={() => router.push(`/rentals/${rental.id}`)}
                      >
                        {/* Rental # — the row's identifier, and weighted as
                            one: this is the string an operator reads out on
                            the phone and searches for, so it carries the row
                            rather than sitting in it. */}
                        <TableCell className="py-3 text-left">
                          <div className="flex flex-col items-start gap-0.5">
                            <span className="font-semibold tabular-nums tracking-tight text-foreground">
                              {rental.rental_number}
                            </span>
                            {flag === "cancelling" && (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                                <XCircle className="size-3" />
                                Cancellation requested
                              </span>
                            )}
                            {flag === "balance" && (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-[#CC004A]">
                                <ShieldAlert className="size-3" />
                                Balance required
                              </span>
                            )}
                            {flag === "quoted" && (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-[#CC004A]">
                                <img src="/bonzah-logo.svg" alt="" className="h-3 w-auto dark:hidden" />
                                <img src="/bonzah-logo-dark.svg" alt="" className="hidden h-3 w-auto dark:block" />
                                Insurance quoted
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Customer — the FULL name, plain. The old cell
                            printed `name.split(' ')[0]`, which turned every
                            Smith and every Haseeb into the same row; the whole
                            name is already on the record, so nothing is fetched
                            to fix this. No initials disc: at the user's request
                            the name carries the cell on its own. */}
                        <TableCell className="py-3 text-left">
                          <span className="block truncate font-medium text-foreground">
                            {rental.customer.name}
                          </span>
                        </TableCell>

                        {/* Pickup / Return — `tabular-nums` is what makes these
                            two columns line up down the page: proportional
                            digits give every row a different width and the
                            column reads as ragged noise. */}
                        <TableCell className="py-3 text-left tabular-nums">
                          <span className="font-medium text-foreground">
                            {formatRentalDate(rental.start_date)}
                          </span>
                        </TableCell>
                        <TableCell className="py-3 text-left tabular-nums">
                          {rental.end_date ? (
                            <span className="font-medium text-foreground">
                              {formatRentalDate(rental.end_date)}
                            </span>
                          ) : rental.is_pay_as_you_go ? (
                            <span className="text-sm font-medium text-primary">Ongoing</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* Status — ONE treatment for every value, hue being
                            the only thing that changes. The old column mixed a
                            solid green fill, an outlined amber pill and a plain
                            grey outline, which made three visual weights out of
                            one fact and left "Rejected" shouting louder than
                            "Active". PAYG and auto-extend are secondary and now
                            look it, so the coloured pill is the only thing in
                            the column asking for the eye. */}
                        <TableCell className="py-3 text-left">
                          <div className="flex flex-wrap items-center justify-start gap-1.5">
                            <RentalStatusText status={rental.computed_status} />
                            {rental.is_pay_as_you_go && <MetaChip>PAYG</MetaChip>}
                            {(rental as any).auto_extend_enabled && <MetaChip>Auto-extend</MetaChip>}
                            {(rental as any).auto_extend_status === "paused" && (
                              <MetaChip>Paused</MetaChip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* The sentinel, inside the scroll container and after the last
                  row — it has to live in here for the observer to be able to
                  root on this container.

                  The bars are the next fill arriving. Those rows are already in
                  memory, so in practice they land within a frame and this is
                  barely seen; it exists so the bottom of a partially-filled
                  list is never a bare cut, and so a slow frame reads as "more
                  coming" rather than "that's all of them". `aria-hidden`: the
                  count line below carries the same fact in words, and offers
                  the button. */}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  aria-hidden="true"
                  className="space-y-3 px-4 py-4"
                >
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

          {/* No pager — just how much of the set is on screen.
              "Show more" is the escape hatch: if the observer never fires (an
              unusual container, a browser without IntersectionObserver, a
              keyboard user who never scrolls the inner box) this is still a way
              to reach row 26, and it is the same one-line call the observer
              makes. */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
            <span>
              {hasMore
                ? `Showing ${visibleRentals.length} of ${totalCount} rentals`
                : `All ${totalCount} ${totalCount === 1 ? "rental" : "rentals"} shown`}
            </span>
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                onClick={showMore}
                className="h-7 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                Show more
              </Button>
            )}
          </div>
        </>
      ) : devForceEmptyRentals || !hasAnyRentalFilter(filters) ? (
        // Nothing came back and nothing was asked for: this tenant has not
        // taken a booking yet. Teach instead of offering a Clear Filters button
        // that would clear nothing. This component is the northwind-only v2
        // list (see V2_AREAS.rentals), so no other tenant reaches this branch.
        <RentalsTeachingEmptyState
          onCreateRental={() =>
            rentalCreationBlocked
              ? setShowConnectStripeDialog(true)
              : router.push("/rentals/new")
          }
        />
      ) : (
        <div className="text-center py-8">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No rentals found</h3>
          <p className="text-muted-foreground mb-4">
            No rentals match your current filters
          </p>
          <Button onClick={handleClearFilters}>Clear Filters</Button>
        </div>
      )}

      {/* Extension Request Dialog */}

      {/* Lean tenants without usable Stripe Connect — dismissible here, because
          there IS a page behind it to return to. */}
      <ConnectStripeRequiredDialog
        open={showConnectStripeDialog}
        onOpenChange={setShowConnectStripeDialog}
      />
    </div>
  );
}
