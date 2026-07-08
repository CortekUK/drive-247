"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { RentalsFilters } from "@/components/rentals/rentals-filters";
import { ExtensionRequestDialog } from "@/components/rentals/ExtensionRequestDialog";
import { ReviewStatusBadge } from "@/components/reviews/review-status-badge";
import { RentalReviewDialog } from "@/components/reviews/rental-review-dialog";
import { CalendarView } from "@/components/rentals/calendar/calendar-view";
import { formatDuration, formatRentalDuration } from "@/lib/rental-utils";
import { getCurrencySymbol } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

const RentalsList = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showExtensionDialog, setShowExtensionDialog] = useState(false);
  const [selectedRental, setSelectedRental] = useState<EnhancedRental | null>(null);
  const [reviewRental, setReviewRental] = useState<EnhancedRental | null>(null);
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();

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
          `${currencySymbol}${rental.monthly_amount}`,
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
              onClick={() => router.push("/rentals/new")}
              className="bg-gradient-primary text-white hover:opacity-90 transition-all duration-200 shadow-md hover:shadow-lg flex-1 sm:flex-none"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Rental
            </Button>
          )}
        </div>
      </div>

      {/* Quick Stats — list view only */}
      {currentView !== "calendar" && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <Card className="bg-card hover:bg-accent/50 border transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold">{stats.total}</div>
              <p className="text-xs sm:text-sm text-muted-foreground">Total Rentals</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-success/10 to-success/5 border-success/20 hover:border-success/40 transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-success">
                {stats.active}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card className="bg-card hover:bg-accent/50 border transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-muted-foreground">
                {stats.closed}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">Completed</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20 hover:border-amber-500/40 transition-all duration-200 cursor-pointer hover:shadow-md">
            <CardContent className="p-3 sm:p-4">
              <div className="text-xl sm:text-2xl font-bold text-amber-500">
                {stats.pending}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">Pending</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters — list view only */}
      {currentView !== "calendar" && (
        <RentalsFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onClearFilters={handleClearFilters}
        />
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
    </div>
  );
};

export default RentalsList;
