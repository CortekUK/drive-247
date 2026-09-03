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

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// CardHeader / CardTitle / CardDescription came across with the copy but the
// only Card left on this screen is the table's shell — the four tiles they
// titled are now `rentals-overview.tsx`, which imports its own.
import { Card, CardContent } from "@/components/ui-v2/card";
import { Badge } from "@/components/ui-v2/badge";
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
  Download,
  CalendarPlus,
  XCircle,
  List,
  CalendarDays,
  ShieldAlert,
  BarChart3,
  Clock,
} from "lucide-react";

// Format a Postgres TIME value ("HH:MM" or "HH:MM:SS") into 12-hour clock
// notation ("10:30 AM"). Returns null when the value is missing so callers
// can skip rendering the line entirely.
const formatTimeOfDay = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hour24 = Number(match[1]);
  const minutes = match[2];
  if (Number.isNaN(hour24) || hour24 < 0 || hour24 > 23) return null;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${minutes} ${period}`;
};
import Link from "next/link";
import { formatLocalDate } from "@/lib/date-utils";
import { useEnhancedRentals, RentalFilters, EnhancedRental } from "@/hooks/use-enhanced-rentals";
import { RentalsFilterBar } from "@/components/rentals-v2/rentals-filter-bar";
import { RentalsOverview } from "@/components/rentals-v2/rentals-overview";
import { RentalsRequestChips } from "@/components/rentals-v2/rentals-request-chips";
import { ExtensionRequestDialog } from "@/components/rentals/ExtensionRequestDialog";
import { ReviewStatusBadge } from "@/components/reviews/review-status-badge";
import { RentalReviewDialog } from "@/components/reviews/rental-review-dialog";
import { CalendarView } from "@/components/rentals/calendar/calendar-view";
import { formatDuration, formatRentalDuration } from "@/lib/rental-utils";
import { getCurrencySymbol } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useRentalCreationGate } from "@/hooks/use-rental-creation-gate";
import { ConnectStripeRequiredDialog } from "@/components/rentals/connect-stripe-required-dialog";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui-v2/pagination";

export function RentalsListV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [selectedRental, setSelectedRental] = useState<EnhancedRental | null>(null);
  const [reviewRental, setReviewRental] = useState<EnhancedRental | null>(null);
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  // Lean tenants only; a constant false for everyone else.
  const { blocked: rentalCreationBlocked } = useRentalCreationGate();
  const [showConnectStripeDialog, setShowConnectStripeDialog] = useState(false);

  const currentView = searchParams.get("view") || "list";

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
      sortBy: searchParams.get("sortBy") || "created_at",
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
      page: parseInt(searchParams.get("page") || "1"),
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

  const { rentals, allRentals, stats, totalCount, totalPages } = data || {
    rentals: [],
    allRentals: [],
    stats: null,
    totalCount: 0,
    totalPages: 0,
  };

  const handleFiltersChange = (newFilters: RentalFilters) => {
    const params = new URLSearchParams();
    Object.entries(newFilters).forEach(([key, value]) => {
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

  const handleClearFilters = () => {
    const params = new URLSearchParams();
    if (currentView !== "list") params.set("view", currentView);
    router.push(params.toString() ? `?${params.toString()}` : "?");
  };

  const handleViewChange = (view: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "list") {
      params.delete("view");
    } else {
      params.set("view", view);
    }
    router.push(`?${params.toString()}`);
  };

  const handlePageChange = (page: number) => {
    handleFiltersChange({ ...filters, page });
  };

  const handleExportCSV = () => {
    if (!data?.rentals) return;

    const currencyCode = tenant?.currency_code || 'USD';
    const currencySymbol = getCurrencySymbol(currencyCode);

    const csvContent = [
      [
        "Rental #",
        "Customer",
        "Vehicle",
        "Start Date",
        "End Date",
        "Duration",
        "Period Type",
        "Rental Amount",
        "Discount",
        "Protection Cost",
        "Total Amount",
        "Initial Payment",
        "Status",
      ].join(","),
      ...data.rentals.map((rental) =>
        [
          rental.rental_number,
          rental.customer.name,
          `${rental.vehicle.reg} (${rental.vehicle.make} ${rental.vehicle.model})`,
          rental.start_date,
          rental.end_date || "",
          formatRentalDuration(rental.start_date, rental.end_date),
          rental.rental_period_type || "Monthly",
          `${currencySymbol}${(Math.max(0, (Number(rental.monthly_amount) || 0) - (Number((rental as any).discount_applied) || 0))).toFixed(2)}`,
          (Number((rental as any).discount_applied) || 0) > 0
            ? `${currencySymbol}${Number((rental as any).discount_applied).toFixed(2)}`
            : "—",
          rental.protection_cost > 0 ? `${currencySymbol}${rental.protection_cost}` : "—",
          `${currencySymbol}${rental.total_amount}`,
          rental.initial_payment ? `${currencySymbol}${rental.initial_payment}` : "—",
          rental.computed_status,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rentals-export.csv";
    link.click();
    window.URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-muted animate-pulse rounded"></div>
        <div className="h-96 bg-muted animate-pulse rounded"></div>
      </div>
    );
  }

  return (
    <div className={currentView === "calendar" ? "p-4 md:p-6 space-y-6" : "container mx-auto p-4 md:p-6 space-y-6"}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0 flex items-start justify-between gap-3 sm:block">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold">Rentals</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Manage rental agreements and contracts
            </p>
          </div>
          {/* Mobile-only icon cluster next to title */}
          <div className="flex items-center gap-2 shrink-0 sm:hidden">
            <div className="flex rounded-md border overflow-hidden">
              <Button
                variant={currentView === "list" ? "default" : "ghost"}
                size="sm"
                className="rounded-none h-8 px-2.5"
                onClick={() => handleViewChange("list")}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={currentView === "calendar" ? "default" : "ghost"}
                size="sm"
                className="rounded-none h-8 px-2.5 border-l"
                onClick={() => handleViewChange("calendar")}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle — sm+ only (mobile shows it next to title) */}
          <div className="hidden sm:flex rounded-md border overflow-hidden">
            <Button
              variant={currentView === "list" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-8 px-2.5"
              onClick={() => handleViewChange("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={currentView === "calendar" ? "default" : "ghost"}
              size="sm"
              className="rounded-none h-8 px-2.5 border-l"
              onClick={() => handleViewChange("calendar")}
            >
              <CalendarDays className="h-4 w-4" />
            </Button>
          </div>
          <Link href="/rentals/analytics" className="shrink-0">
            <Button variant="outline" size="icon" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
              <BarChart3 className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            variant="outline"
            size="icon"
            onClick={handleExportCSV}
            disabled={!rentals.length}
            className="border-primary/20 hover:border-primary/40 hover:bg-primary/5 shrink-0"
          >
            <Download className="h-4 w-4" />
          </Button>
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
              className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg flex-1 sm:flex-none"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Rental
            </Button>
          )}
        </div>
      </div>

      {/* Overview — list view only */}
      {currentView !== "calendar" && (
        <RentalsOverview
          stats={stats}
          rentals={allRentals}
          currencySymbol={getCurrencySymbol(tenant?.currency_code || "USD")}
          onOpenCalendar={() => handleViewChange("calendar")}
        />
      )}

      {/* Filters — list view only */}
      {currentView !== "calendar" && (
        <div className="space-y-3">
          <RentalsFilterBar
            filters={filters}
            onFiltersChange={handleFiltersChange}
            onClearFilters={handleClearFilters}
          />
          {/* The two requests an operator has to answer, hoisted out of the
              filter panel so they are visible without opening it. Same filter
              keys, so the chip and the panel's Requests section stay in step. */}
          <RentalsRequestChips filters={filters} onFiltersChange={handleFiltersChange} />
        </div>
      )}

      {/* Calendar View */}
      {currentView === "calendar" ? (
        <CalendarView filters={filters} />
      ) : /* Rentals Table */
      rentals.length > 0 ? (
        <>
          <Card>
            <CardContent className="p-0 overflow-x-auto max-h-[520px] overflow-y-auto relative">
              <Table className="min-w-[700px]">
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Rental #</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Pickup</TableHead>
                      <TableHead>Return</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Review</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rentals.map((rental) => (
                      <TableRow
                        key={rental.id}
                        className={`hover:bg-muted/50 cursor-pointer ${rental.is_extended ? 'bg-amber-500/10 border-l-4 border-l-amber-500' : rental.cancellation_requested ? 'bg-red-500/10 border-l-4 border-l-red-500' : (!filters.bonzahStatus && rental.bonzah_status === 'insufficient_balance') ? 'bg-[#CC004A]/5 border-l-4 border-l-[#CC004A]' : (!filters.bonzahStatus && rental.bonzah_status === 'quoted') ? 'bg-[#CC004A]/5 border-l-4 border-l-[#CC004A]' : ''}`}
                        onClick={() => router.push(`/rentals/${rental.id}`)}
                      >
                        <TableCell className="font-medium">
                          {rental.is_extended ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <button
                                className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1 mt-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRental(rental);
                                  setShowExtensionDialog(true);
                                }}
                              >
                                <CalendarPlus className="h-3 w-3" />
                                Extension Requested
                              </button>
                            </div>
                          ) : rental.cancellation_requested ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <span className="text-xs text-red-600 font-medium flex items-center gap-1 mt-0.5">
                                <XCircle className="h-3 w-3" />
                                Cancellation Requested
                              </span>
                            </div>
                          ) : (!filters.bonzahStatus && rental.bonzah_status === 'insufficient_balance') ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <span className="text-xs text-[#CC004A] font-medium flex items-center gap-1 mt-0.5">
                                <ShieldAlert className="h-3 w-3" />
                                Balance Required
                              </span>
                            </div>
                          ) : (!filters.bonzahStatus && rental.bonzah_status === 'quoted') ? (
                            <div className="flex flex-col">
                              <span>{rental.rental_number}</span>
                              <span className="text-xs text-[#CC004A] font-medium flex items-center gap-1 mt-0.5">
                                <img src="/bonzah-logo.svg" alt="" className="h-3 w-auto dark:hidden" />
                                <img src="/bonzah-logo-dark.svg" alt="" className="h-3 w-auto hidden dark:block" />
                                Ins. Quoted
                              </span>
                            </div>
                          ) : (
                            rental.rental_number
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {rental.created_at
                            ? new Date(rental.created_at).toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {rental.customer.name.split(' ')[0]}
                        </TableCell>
                        <TableCell>
                          <div>{formatLocalDate(rental.start_date)}</div>
                          {formatTimeOfDay(rental.pickup_time) && (
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTimeOfDay(rental.pickup_time)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {rental.end_date
                            ? (
                              <>
                                <div>{formatLocalDate(rental.end_date)}</div>
                                {formatTimeOfDay(rental.return_time) && (
                                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {formatTimeOfDay(rental.return_time)}
                                  </div>
                                )}
                              </>
                            )
                            : rental.is_pay_as_you_go
                            ? <span className="text-indigo-500 text-xs font-medium">Ongoing</span>
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {rental.is_pay_as_you_go && !rental.end_date
                            ? <span className="text-xs text-muted-foreground">PAYG</span>
                            : formatRentalDuration(rental.start_date, rental.end_date)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant={
                                rental.computed_status === "Completed"
                                  ? "secondary"
                                  : rental.computed_status === "Cancelled" || rental.computed_status === "Rejected"
                                  ? "destructive"
                                  : "outline"
                              }
                              className={
                                rental.computed_status === "Active"
                                  ? "bg-green-600 text-white"
                                  : rental.computed_status === "Pending"
                                  ? "bg-amber-500/20 text-amber-600 border-amber-500"
                                  : ""
                              }
                            >
                              {rental.computed_status}
                            </Badge>
                            {rental.is_pay_as_you_go && (
                              <Badge variant="outline" className="text-indigo-600 border-indigo-300 bg-indigo-100 dark:text-indigo-400 dark:border-indigo-700 dark:bg-indigo-950/30 text-[10px]">
                                PAYG
                              </Badge>
                            )}
                            {(rental as any).auto_extend_enabled && (
                              <Badge variant="outline" className="text-violet-600 border-violet-300 bg-violet-100 dark:text-violet-400 dark:border-violet-700 dark:bg-violet-950/30 text-[10px]">
                                Auto-Extend
                              </Badge>
                            )}
                            {(rental as any).auto_extend_status === 'paused' && (
                              <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-100 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-950/30 text-[10px]">
                                Paused
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <ReviewStatusBadge
                            reviewStatus={rental.review_status}
                            reviewRating={rental.review_rating}
                            rentalStatus={rental.computed_status}
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewRental(rental);
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Showing {rentals.length} of {totalCount} rentals
            </div>
            <div className="flex items-center">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() =>
                        handlePageChange(Math.max(1, filters.page! - 1))
                      }
                      className={
                        filters.page === 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>

                  {totalPages > 1 ? (
                    Array.from(
                      { length: Math.min(5, totalPages) },
                      (_, i) => {
                        const pageNum =
                          Math.max(
                            1,
                            Math.min(totalPages - 4, filters.page! - 2)
                          ) + i;
                        return (
                          <PaginationItem key={pageNum}>
                            <PaginationLink
                              onClick={() => handlePageChange(pageNum)}
                              isActive={pageNum === filters.page}
                              className="cursor-pointer"
                            >
                              {pageNum}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      }
                    )
                  ) : (
                    <PaginationItem>
                      <PaginationLink isActive className="cursor-default">
                        1
                      </PaginationLink>
                    </PaginationItem>
                  )}

                  <PaginationItem>
                    <PaginationNext
                      onClick={() =>
                        handlePageChange(
                          Math.min(totalPages, filters.page! + 1)
                        )
                      }
                      className={
                        filters.page === totalPages || totalPages <= 1
                          ? "pointer-events-none opacity-50"
                          : "cursor-pointer"
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </div>
        </>
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

      {/* Rental Review Dialog */}
      {reviewRental && (
        <RentalReviewDialog
          open={!!reviewRental}
          onOpenChange={(open) => { if (!open) setReviewRental(null); }}
          rentalId={reviewRental.id}
          customerId={reviewRental.customer.id}
          customerName={reviewRental.customer.name}
          rentalNumber={reviewRental.rental_number}
        />
      )}

      {/* Extension Request Dialog */}
      {selectedRental && (
        <ExtensionRequestDialog
          open={showExtensionDialog}
          onOpenChange={(open) => {
            setShowExtensionDialog(open);
            if (!open) setSelectedRental(null);
          }}
          rental={{
            id: selectedRental.id,
            // `ExtensionRequestDialog` declares `start_date` required and
            // divides by (end_date - start_date) to price an extension. The v1
            // page has never passed it, so that subtraction runs against
            // undefined and quotes NaN days. Passing it here is what makes this
            // file typecheck, and it is the same one-line fix the design branch
            // carried; the v1 page keeps its behaviour byte for byte.
            start_date: selectedRental.start_date || '',
            end_date: selectedRental.end_date || '',
            previous_end_date: selectedRental.previous_end_date || null,
            customers: {
              id: selectedRental.customer.id,
              name: selectedRental.customer.name,
            },
            vehicles: {
              id: selectedRental.vehicle.id,
              reg: selectedRental.vehicle.reg,
              make: selectedRental.vehicle.make,
              model: selectedRental.vehicle.model,
            },
          }}
        />
      )}

      {/* Lean tenants without usable Stripe Connect — dismissible here, because
          there IS a page behind it to return to. */}
      <ConnectStripeRequiredDialog
        open={showConnectStripeDialog}
        onOpenChange={setShowConnectStripeDialog}
      />
    </div>
  );
}
