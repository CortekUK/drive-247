"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  X,
  User,
  Calendar as CalendarIcon,
  FileText,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useAuditLogs,
  useAuditLogsServerCount,
  AUDIT_LOGS_V2_LIMIT,
  useAuditLogActions,
  useAdminUsers,
  filterAuditLogs,
  formatActionName,
  getActionColor,
  AuditLogsFilters,
} from "@/hooks/use-audit-logs";
import { useV2 } from "@/lib/v2-context";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2 } from "@/components/shared/header-icon-button-v2";
import { useTenant } from "@/contexts/TenantContext";
import { AuditLogsTableV2 } from "@/components/admin-v2/audit-logs-table-v2";
import { usePageSearch } from "@/components/shared/layout/page-search-slot";
import { OverviewFlip } from "@/components/shared/layout/overview-flip";
import {
  AuditLogsFilterPanel,
  countActiveAuditLogFilters,
} from "@/components/admin-v2/audit-logs-filter-panel";
import { AuditLogsOverview } from "@/components/admin-v2/audit-logs-overview";

const AuditLogs = () => {
  const [filters, setFilters] = useState<AuditLogsFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  // v2 only. The top bar owns both: the search field writes `searchTerm` (there
  // is no box anywhere on v1, so it stays "" there), and its Filters button
  // turns the overview over to the filter panel.
  const [searchTerm, setSearchTerm] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pageSize = 25;
  const { toast } = useToast();

  const { data: logs, isLoading } = useAuditLogs(filters);
  const { data: actions } = useAuditLogActions();
  const { data: adminUsers } = useAdminUsers();

  // v2 chrome (canary tenants only; fails closed to v1). On v2 there is no
  // pager: useAuditLogs loads up to AUDIT_LOGS_V2_LIMIT rows and the table
  // grows as it scrolls. When that fetch comes back full, a HEAD count says how
  // many match on the server, so the footer never calls a capped list complete.
  // Up here, above the loading early return, so the hooks run on every render.
  const v2Chrome = useV2("chrome");
  const { tenant } = useTenant();
  const logsCapped = v2Chrome && (logs?.length ?? 0) >= AUDIT_LOGS_V2_LIMIT;
  const { data: serverLogCount } = useAuditLogsServerCount(filters, logsCapped);

  /**
   * v2 only: the rows the table, the graph and Export CSV all work from.
   *
   * The five filters are query clauses and stay on the server. The search box
   * is the one thing that is NOT: it sifts the rows already loaded, and never
   * touches the query — an audit log has no searchable column that would not
   * mean a new index, and a search that silently covered only the loaded page
   * while LOOKING like a server search is the worse lie of the two. The caption
   * on the graph says what is loaded.
   *
   * With no term this returns the fetch result itself (same array, not a copy),
   * so an unsearched page behaves exactly as it did, and v1 — which registers
   * no search box at all — can never reach a narrowed set.
   */
  const visibleLogs = useMemo(
    () => (v2Chrome ? filterAuditLogs(logs ?? [], searchTerm) : logs ?? []),
    [v2Chrome, logs, searchTerm],
  );

  // Pagination
  const totalLogs = logs?.length || 0;
  const totalPages = Math.ceil(totalLogs / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalLogs);
  const paginatedLogs = logs?.slice(startIndex, endIndex) || [];

  const clearFilters = () => {
    setFilters({});
    // v2's top-bar search; always "" on v1, where nothing can set it.
    setSearchTerm("");
    setCurrentPage(1);
  };

  const hasActiveFilters =
    filters.entityType ||
    filters.action ||
    filters.actorId ||
    filters.dateFrom ||
    filters.dateTo ||
    // v2 only, and the reason the empty state below still offers a way out when
    // a search — rather than a filter — is what emptied the table.
    searchTerm.trim();

  const handleExportCSV = () => {
    // The rows the table is showing. Identical to the fetch result whenever
    // nothing is searched, which is every v1 page and every unsearched v2 one;
    // with a search it exports what you are looking at, as the customers list
    // does, rather than rows that are not on screen.
    if (visibleLogs.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    const headers = ["Date & Time", "Action", "Entity Type", "Entity Name", "Details", "Performed By"];
    const rows = visibleLogs.map((log) => [
      format(new Date(log.created_at), "yyyy-MM-dd HH:mm:ss"),
      formatActionName(log.action),
      log.entity_type || "",
      log.details?.customer_name || "",
      log.details?.reason
        ? `Reason: ${log.details.reason}`
        : log.details?.previous_status && log.details?.new_status
          ? `Status: ${log.details.previous_status} → ${log.details.new_status}`
          : JSON.stringify(log.details || {}),
      log.actor?.name || log.actor?.email || "System",
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-logs-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported successfully" });
  };

  /**
   * v2 only: hand the top bar this page's search and its filter button, the
   * way every other v2 list does. `null` on v1, which leaves the bar (and the
   * inline filter bar below) exactly as they were.
   *
   * No debounce here — this page has never debounced anything, and the
   * filtering is a pass over rows already in memory, so the bar's own 400ms is
   * the only delay and `onChange` is the raw setter.
   *
   * It sits down here, after every piece of state it reads and before the
   * `isLoading` early return, so the hook runs on every render.
   */
  usePageSearch(
    v2Chrome
      ? {
          placeholder: "Search log entries…",
          value: searchTerm,
          onChange: setSearchTerm,
          filters: {
            open: filtersOpen,
            onOpenChange: setFiltersOpen,
            activeCount: countActiveAuditLogFilters(filters),
          },
        }
      : null,
  );

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        {/* v2 has no inline filter bar: hold the hero row's shape instead (the
            graph across the whole row, since this tab has no featured card), so
            the table does not jump when the rows land. 260px is the loaded
            graph's height. v1 keeps its one-line bar placeholder. */}
        {v2Chrome ? (
          <div className="grid grid-cols-1 gap-6 py-2">
            <Skeleton className="h-[260px]" />
          </div>
        ) : (
        <Skeleton className="h-10 w-full" />
        )}
        <Card>
          <CardContent className="p-0">
            <div className="space-y-4 p-4">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2 sm:gap-4 min-w-0">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold">Audit Logs</h1>
            <p className="text-muted-foreground text-sm sm:text-base">
              Track all system actions and changes
            </p>
          </div>
        </div>
        {v2Chrome ? (
          // v2: Export CSV is this page's one action, so it stays the labelled
          // button, as the 32px pill centred on the subtitle line (team lead
          // Sep 16 2026; the subtitle is text-base from sm, HEADER_ACTIONS_V2's box).
          <div className={`flex items-center gap-2 ${HEADER_ACTIONS_V2}`}>
            <Button onClick={handleExportCSV} className={`bg-gradient-primary w-full sm:w-auto ${HEADER_PRIMARY_V2}`}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        ) : (
        <Button onClick={handleExportCSV} className="bg-gradient-primary w-full sm:w-auto">
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
        )}
      </div>

      {/* v2: the overview turns over to show the filter panel. Its front face
          is the hero row — one graph over the same rows the table shows, full
          width because this tab has no featured card (see the overview's own
          header). The five filters that used to sit in a row under the title
          now live on the back face, and the search field is in the top bar. */}
      {v2Chrome && (
        <OverviewFlip
          flipped={filtersOpen}
          onFlipBack={() => setFiltersOpen(false)}
          front={
            <AuditLogsOverview
              logs={visibleLogs}
              filtered={!!hasActiveFilters}
              capped={logsCapped}
            />
          }
          back={
            <AuditLogsFilterPanel
              filters={filters}
              actions={actions ?? []}
              users={adminUsers ?? []}
              onChange={setFilters}
              onClear={clearFilters}
              onClose={() => setFiltersOpen(false)}
            />
          }
        />
      )}

      {/* Filter Bar */}
      {!v2Chrome && (
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.entityType || "all"}
          onValueChange={(value) =>
            setFilters((prev) => ({
              ...prev,
              entityType: value === "all" ? undefined : value,
            }))
          }
        >
          <SelectTrigger className="w-[160px] h-8 text-sm">
            <SelectValue placeholder="Entity type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Entities</SelectItem>
            <SelectItem value="customer">Customer</SelectItem>
            <SelectItem value="rental">Rental</SelectItem>
            <SelectItem value="vehicle">Vehicle</SelectItem>
            <SelectItem value="payment">Payment</SelectItem>
            <SelectItem value="fine">Fine</SelectItem>
            <SelectItem value="invoice">Invoice</SelectItem>
            <SelectItem value="document">Document</SelectItem>
            <SelectItem value="plate">Plate</SelectItem>
            <SelectItem value="identity">Identity</SelectItem>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="settings">Settings</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.action || "all"}
          onValueChange={(value) =>
            setFilters((prev) => ({
              ...prev,
              action: value === "all" ? undefined : value,
            }))
          }
        >
          <SelectTrigger className="w-[160px] h-8 text-sm">
            <SelectValue placeholder="Action type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {actions?.map((action) => (
              <SelectItem key={action} value={action}>
                {formatActionName(action)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.actorId || "all"}
          onValueChange={(value) =>
            setFilters((prev) => ({
              ...prev,
              actorId: value === "all" ? undefined : value,
            }))
          }
        >
          <SelectTrigger className="w-[160px] h-8 text-sm">
            <SelectValue placeholder="Performed by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Users</SelectItem>
            {adminUsers?.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name || user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[150px] h-8 text-sm justify-between text-left font-normal",
                !filters.dateFrom && "text-muted-foreground"
              )}
            >
              {filters.dateFrom ? (
                format(new Date(filters.dateFrom), "MMM dd, yyyy")
              ) : (
                <span>From date</span>
              )}
              <CalendarIcon className="ml-2 h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent
              mode="single"
              selected={
                filters.dateFrom
                  ? new Date(filters.dateFrom)
                  : undefined
              }
              onSelect={(date) =>
                setFilters((prev) => ({
                  ...prev,
                  dateFrom: date ? format(date, "yyyy-MM-dd") : undefined,
                }))
              }
              initialFocus
            />
          </PopoverContent>
        </Popover>

        <span className="text-sm text-muted-foreground">to</span>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-[150px] h-8 text-sm justify-between text-left font-normal",
                !filters.dateTo && "text-muted-foreground"
              )}
            >
              {filters.dateTo ? (
                format(new Date(filters.dateTo), "MMM dd, yyyy")
              ) : (
                <span>To date</span>
              )}
              <CalendarIcon className="ml-2 h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent
              mode="single"
              selected={
                filters.dateTo ? new Date(filters.dateTo) : undefined
              }
              onSelect={(date) =>
                setFilters((prev) => ({
                  ...prev,
                  dateTo: date ? format(date, "yyyy-MM-dd") : undefined,
                }))
              }
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="h-8 text-sm">
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>
      )}

      {/* Audit Logs Table. `visibleLogs` is the fetch result itself on v1 and on
          an unsearched v2 page, so this reads exactly as `logs?.length` did. */}
      {visibleLogs.length > 0 ? (
        v2Chrome ? (
          // v2: the rentals list's table (components/shared/list-table-v2).
          // Every fetched row, no page slice and no pager: rows arrive as it
          // scrolls. Rows open nothing, as in v1.
          <AuditLogsTableV2
            logs={visibleLogs}
            // The search term is in the key too: it changes the result set, so
            // the table's 25-row fill starts again rather than holding a window
            // measured against the rows a previous term left.
            resetKey={`${tenant?.id ?? ""}|${filters.entityType ?? ""}|${filters.action ?? ""}|${filters.actorId ?? ""}|${filters.dateFrom ?? ""}|${filters.dateTo ?? ""}|${searchTerm.trim().toLowerCase()}`}
            // Left exactly as it was. A search narrows the rows below the cap,
            // so the table's own `capped` check turns false and the count is
            // ignored — it is only ever used when the rows on screen really are
            // the first 1,000 the server would have returned.
            serverCount={logsCapped ? serverLogCount : undefined}
          />
        ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Performed By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">
                              {format(new Date(log.created_at), "MMM dd, yyyy")}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(log.created_at), "HH:mm:ss")}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          title={formatActionName(log.action)}
                          className={cn(
                            "inline-block w-[120px] sm:w-auto sm:max-w-none max-w-[120px] truncate whitespace-nowrap text-center align-middle",
                            getActionColor(log.action)
                          )}
                        >
                          {formatActionName(log.action)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {log.entity_type ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="capitalize">
                              {log.entity_type}
                            </Badge>
                            {log.details?.customer_name && (
                              <span className="text-sm font-medium">
                                {log.details.customer_name}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="truncate text-sm text-muted-foreground cursor-help">
                                {log.details?.reason && (
                                  <span>Reason: {log.details.reason}</span>
                                )}
                                {log.details?.previous_status &&
                                  log.details?.new_status && (
                                    <span>
                                      Status: {log.details.previous_status} →{" "}
                                      {log.details.new_status}
                                    </span>
                                  )}
                                {!log.details?.reason &&
                                  !log.details?.previous_status && (
                                    <span>
                                      {JSON.stringify(log.details).substring(
                                        0,
                                        50
                                      )}
                                      ...
                                    </span>
                                  )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent
                              side="bottom"
                              className="max-w-[400px]"
                            >
                              <pre className="text-xs whitespace-pre-wrap">
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">
                            {log.actor?.name || log.actor?.email || "System"}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1}-{endIndex} of {totalLogs} log entries
            </p>
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-center sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Page {currentPage} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages || totalPages <= 1}
              >
                Next
              </Button>
            </div>
          </div>
        </>
        )
      ) : (
        <div className="text-center py-12">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No audit logs found</h3>
          <p className="text-muted-foreground mb-4">
            {hasActiveFilters
              ? "Try adjusting your filter criteria"
              : "Activity logs will appear here as actions are performed"}
          </p>
          {hasActiveFilters && (
            <Button variant="outline" onClick={clearFilters}>
              <X className="h-4 w-4 mr-2" />
              Clear Filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default AuditLogs;
