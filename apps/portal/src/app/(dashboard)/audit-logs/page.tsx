"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  History,
  X,
  User,
  Calendar as CalendarIcon,
  ExternalLink,
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
  const router = useRouter();
  const [filters, setFilters] = useState<AuditLogsFilters>({});

  const { data: logs, isLoading } = useAuditLogs(filters);
  const { data: actions } = useAuditLogActions();
  const { data: adminUsers } = useAdminUsers();

  const clearFilters = () => {
    setFilters({});
  };

  const hasActiveFilters =
    filters.entityType ||
    filters.action ||
    filters.actorId ||
    filters.dateFrom ||
    filters.dateTo;

  const navigateToEntity = (entityType: string | null, entityId: string | null) => {
    if (!entityType || !entityId) return;

    switch (entityType) {
      case "customer":
        router.push(`/customers/${entityId}`);
        break;
      case "rental":
        router.push(`/rentals/${entityId}`);
        break;
      case "vehicle":
        router.push(`/vehicles/${entityId}`);
        break;
      case "payment":
        router.push(`/payments/${entityId}`);
        break;
      case "fine":
        router.push(`/fines/${entityId}`);
        break;
      default:
        break;
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
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

      {/* Main Content */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Activity History
          </CardTitle>
          <CardDescription>
            View all actions performed in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 space-y-4">
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

            {/* Date Range Section - Separated */}
            <div className="pt-4 border-t">
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
          </div>

          {/* Results info */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              Showing {logs?.length || 0} log entries
            </p>
          </div>

          {logs && logs.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Performed By</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
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
                      <TableCell>
                        {log.entity_type && log.entity_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigateToEntity(log.entity_type, log.entity_id)
                            }
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditLogs;
