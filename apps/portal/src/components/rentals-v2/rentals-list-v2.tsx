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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui-v2/button";
import { RentalsTable, type RentalsTableRow } from "../../../../../shared/portal-v2/rentals-table";
import {
  FileText,
  Plus,
  XCircle,
  ShieldAlert,
  CalendarDays,
  Download,
  List,
} from "lucide-react";
import { useEnhancedRentals, RentalFilters, EnhancedRental } from "@/hooks/use-enhanced-rentals";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { countActiveRentalFilters } from "@/components/rentals-v2/rentals-filter-panel";
import { RentalsFilterPanel } from "@/components/rentals-v2/rentals-filter-panel";
import { RentalsOverview } from "@/components/rentals-v2/rentals-overview";
import { RentalsOverviewFlip } from "@/components/rentals-v2/rentals-overview-flip";
import { ConnectedTimeline } from "@/components/timeline-v2/connected-timeline";
import { useTenant } from "@/contexts/TenantContext";
import { RentalDrafts, useCreateDraftRental } from "./rental-drafts";
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
import { AutoSkeleton } from "@/components/skeleton-v2/auto-skeleton";
import { skeletonRows } from "@/lib/skeleton-data";
import { useSkeletonLoading } from "@/hooks/use-skeleton-loading";

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

/** Placeholder rentals for the skeleton: only their shapes are ever seen. */
const SKELETON_RENTALS: EnhancedRental[] = skeletonRows(8, (f) => ({
  id: f.id,
  rental_number: `R-${f.word(5, 6)}`,
  start_date: f.date(f.int(0, 40)).slice(0, 10),
  end_date: f.date(f.int(-30, 0)).slice(0, 10),
  created_at: f.date(),
  monthly_amount: 0,
  discount_applied: null,
  promo_code: null,
  protection_cost: 0,
  total_amount: f.money(),
  status: "active",
  computed_status: f.pick(["Active", "Upcoming", "Completed", "Pending"]),
  duration_months: 1,
  initial_payment: null,
  customer: { id: f.id, name: f.text(2, 3) },
  vehicle: { id: f.id, reg: f.word(6, 8), make: f.word(4, 8), model: f.word(3, 7) },
}));
const SKELETON_DATA = {
  allRentals: SKELETON_RENTALS,
  stats: { total: 8, active: 3, closed: 3, pending: 2, avgDuration: 7 },
  totalCount: SKELETON_RENTALS.length,
};

export function RentalsListV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const createDraft = useCreateDraftRental();
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

  const { data, isLoading: rentalsLoading } = useEnhancedRentals(filters);
  const isLoading = useSkeletonLoading(rentalsLoading);

  // `rentals` (the hook's own page slice) and `totalPages` are deliberately not
  // destructured — this list has no pages, and leaving them named would invite
  // someone to render the slice again.
  //
  // While loading, the page renders placeholder rentals through its real
  // overview and table, and <AutoSkeleton> turns that into the skeleton.
  const { allRentals, stats, totalCount } = isLoading ? SKELETON_DATA : data || {
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
  // Not gated on loading: the skeleton's table fills the window exactly as the
  // loaded one will, so the list does not jump when the rows land.
  const tableMounted =
    currentView !== "calendar" && allRentals.length > 0 && !devForceEmptyRentals;
  const tableFillCap = useViewportFillCap(scrollRootRef, tableMounted);
  /**
   * No rentals yet (list view, nothing asked for): the page keeps its heading
   * and the teaching empty state below is the only thing on it — no search,
   * filters, overview, calendar or export. The same condition as the branch
   * that renders RentalsTeachingEmptyState.
   */
  const teachEmptyRentals =
    !isLoading &&
    currentView !== "calendar" &&
    (devForceEmptyRentals || (allRentals.length === 0 && !hasAnyRentalFilter(filters)));

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
    currentView === "calendar" || teachEmptyRentals
      ? null
      : {
          placeholder: "Search customer, reg, rental #…",
          value: filters.search || "",
          onChange: (next) => handleFiltersChange({ ...filters, search: next, page: 1 }),
          tourAnchor: "rentals-search",
          scopeLabel: "Rentals",
          resultCount: isLoading ? undefined : totalCount,
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

  /**
   * One rental as a row of the shared table.
   *
   * The row-level flag is resolved ONCE: it decides both the row's tint and
   * the line under the rental number, and working it out twice is how those
   * two drift apart. `is_extended` is deliberately NOT a flag: extensions are
   * out of scope for this screen while the rental model is being settled.
   *
   * The tint is halved and the rail 2px: with so little else on the row the
   * flag does not have to shout, and a wall of amber rows is what stops any
   * one of them being noticed.
   *
   * The data attributes are inert markers read by `lib/tab-tours`, so the
   * Rentals tour can walk from this list INTO a rental record: the row
   * navigates on click and emits no href, so nothing else on the page names a
   * rental id.
   */
  const toTableRow = (rental: EnhancedRental): RentalsTableRow => {
    const flag = rental.cancellation_requested
      ? "cancelling"
      : !filters.bonzahStatus && rental.bonzah_status === "insufficient_balance"
      ? "balance"
      : !filters.bonzahStatus && rental.bonzah_status === "quoted"
      ? "quoted"
      : null;
    return {
      id: rental.id,
      reference: rental.rental_number,
      // The FULL name: the first name alone turned every Smith into one row.
      party: rental.customer.name,
      start: rental.start_date,
      end: rental.end_date,
      ongoing: rental.is_pay_as_you_go,
      status: rental.computed_status,
      tint:
        flag === "cancelling"
          ? "bg-red-500/5 border-l-2 border-l-red-500"
          : flag === "balance" || flag === "quoted"
          ? "bg-[#CC004A]/5 dark:bg-[#CC004A]/15 border-l-2 border-l-[#CC004A]"
          : undefined,
      note:
        flag === "cancelling" ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
            <XCircle className="size-3" />
            Cancellation requested
          </span>
        ) : flag === "balance" ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-[#CC004A] dark:text-[#ff6b9a]">
            <ShieldAlert className="size-3" />
            Balance required
          </span>
        ) : flag === "quoted" ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-[#CC004A] dark:text-[#ff6b9a]">
            <img src="/bonzah-logo.svg" alt="" className="h-3 w-auto dark:hidden" />
            <img src="/bonzah-logo-dark.svg" alt="" className="hidden h-3 w-auto dark:block" />
            Insurance quoted
          </span>
        ) : undefined,
      // PAYG and auto-extend are facts about how the rental bills, not states
      // competing with it: one quiet, uncoloured chip each.
      meta: [
        rental.is_pay_as_you_go && "PAYG",
        (rental as any).auto_extend_enabled && "Auto-extend",
        (rental as any).auto_extend_status === "paused" && "Paused",
      ].filter((chip): chip is string => typeof chip === "string"),
      attrs: { "data-tour": "rental-row", "data-record-kind": "rentals", "data-record-id": rental.id },
    };
  };

  return (
    <div className={currentView === "calendar" ? "p-4 md:p-6 space-y-6" : "container mx-auto p-4 md:p-6 space-y-6"}>
      {/* Header. Not in the full-screen calendar from md up — the board carries
          its own way back to the list (ConnectedTimeline `onExit`). */}
      <div className={`flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3${currentView === "calendar" ? " md:hidden" : ""}`}>
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
          {/* No rentals yet: the empty state carries New rental, so the
              header keeps nothing but the page title. */}
          {!teachEmptyRentals && (
          <>
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
              <HeaderIconButton label="Export CSV" onClick={handleExportCsv} disabled={isLoading || allRentals.length === 0}>
                <Download className="size-4" />
              </HeaderIconButton>
            </>
          )}
          {canEdit('rentals') && (
            <Button
              // Lean tenants without a usable Stripe Connect account get told
              // why instead of a form that cannot take a payment. Non-lean
              // tenants are never blocked, so this navigates as it always did.
              // v2: no create form — the rental is created empty and opened
              // on its Customer stage (rental-drafts.tsx).
              onClick={() =>
                rentalCreationBlocked
                  ? setShowConnectStripeDialog(true)
                  : createDraft.mutate()
              }
              disabled={createDraft.isPending}
              data-tour="new-rental"
              className={`bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg flex-1 sm:flex-none ${HEADER_PRIMARY_V2}`}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Rental
              </Button>
            )}
          </>
          )}
          </div>
        </div>
      </div>

      <AutoSkeleton loading={isLoading} className="space-y-6">
      {/* Overview — list view only, and the filter panel is its other face. */}
      {currentView !== "calendar" && !teachEmptyRentals && (
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

      {/* Rentals started with New Rental and not yet given a customer. */}
      {currentView !== "calendar" && <RentalDrafts />}

      {/* Calendar View */}
      {currentView === "calendar" ? (
            <ConnectedTimeline scope={{ kind: "all" }} fill onExit={() => handleViewChange("list")} />
      ) : /* Rentals Table */
      allRentals.length > 0 && !devForceEmptyRentals ? (
        <>
          {/* The shared Rentals table (shared/portal-v2/rentals-table.tsx),
              the one the customer portal's Rentals page draws too. The scroll
              root and sentinel are this page's infinite scroll; the inline
              max-height is the measured window fill (`tableFillCap`), and
              replaces the 520px from md up. */}
          <RentalsTable
            partyLabel="Customer"
            rows={visibleRentals.map(toTableRow)}
            onOpen={(id) => router.push(`/rentals/${id}`)}
            scrollRootRef={scrollRootRef}
            sentinelRef={sentinelRef}
            hasMore={hasMore}
            maxHeight={tableFillCap}
          />

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
      ) : isLoading ? null : devForceEmptyRentals || !hasAnyRentalFilter(filters) ? (
        // Nothing came back and nothing was asked for: this tenant has not
        // taken a booking yet. Teach instead of offering a Clear Filters button
        // that would clear nothing. This component is the northwind-only v2
        // list (see V2_AREAS.rentals), so no other tenant reaches this branch.
        <RentalsTeachingEmptyState
          onCreateRental={() =>
            rentalCreationBlocked
              ? setShowConnectStripeDialog(true)
              : createDraft.mutate()
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
      </AutoSkeleton>

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
