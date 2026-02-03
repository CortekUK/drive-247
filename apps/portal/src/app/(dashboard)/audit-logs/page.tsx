"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAuditLogs,
  useAuditLogActions,
  useAdminUsers,
  formatActionName,
  getActionColor,
  AuditLogsFilters,
} from "@/hooks/use-audit-logs";

const AuditLogs = () => {
  const [filters, setFilters] = useState<AuditLogsFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const { data: logs, isLoading } = useAuditLogs(filters);
  const { data: actions } = useAuditLogActions();
  const { data: adminUsers } = useAdminUsers();

  // Pagination
  const totalLogs = logs?.length || 0;
  const totalPages = Math.ceil(totalLogs / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalLogs);
  const paginatedLogs = logs?.slice(startIndex, endIndex) || [];

  const clearFilters = () => {
    setFilters({});
    setCurrentPage(1);
  };

  const hasActiveFilters =
    filters.entityType ||
    filters.action ||
    filters.actorId ||
    filters.dateFrom ||
    filters.dateTo;

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
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
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Audit Logs</h1>
          <p className="text-muted-foreground">
            Track all system actions and changes
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 items-center">
          <Select
            value={filters.entityType || "all"}
            onValueChange={(value) =>
              setFilters((prev) => ({
                ...prev,
                entityType: value === "all" ? undefined : value,
              }))
            }
          >
            <SelectTrigger className="w-full sm:w-48">
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
            <SelectTrigger className="w-full sm:w-48">
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
            <SelectTrigger className="w-full sm:w-48">
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
        </div>

        {/* Date Range Section */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            Date Range:
          </span>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full sm:w-[160px] justify-between text-left font-normal",
                    !filters.dateFrom && "text-muted-foreground"
                  )}
                >
                  {filters.dateFrom ? (
                    format(new Date(filters.dateFrom), "MMM dd, yyyy")
                  ) : (
                    <span>From date</span>
                  )}
                  <CalendarIcon className="ml-2 h-4 w-4" />
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

            <span className="text-muted-foreground text-center sm:text-left">to</span>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full sm:w-[160px] justify-between text-left font-normal",
                    !filters.dateTo && "text-muted-foreground"
                  )}
                >
                  {filters.dateTo ? (
                    format(new Date(filters.dateTo), "MMM dd, yyyy")
                  ) : (
                    <span>To date</span>
                  )}
                  <CalendarIcon className="ml-2 h-4 w-4" />
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
          </div>

          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={clearFilters} className="w-full sm:w-auto">
              <X className="h-4 w-4 mr-1" />
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Audit Logs Table */}
      {logs && logs.length > 0 ? (
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
                              {format(new Date(log.created_at), "dd MMM yyyy")}
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
                          className={getActionColor(log.action)}
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
