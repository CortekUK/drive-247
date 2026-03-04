"use client";

import { useState, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertTriangle, Plus, Eye, MoreVertical, CreditCard, Ban, ArrowUpDown, Info } from "lucide-react";
import { format, subMonths, startOfMonth } from "date-fns";
import { FineStatusBadge } from "@/components/shared/status/fine-status-badge";
import { FineKPIs } from "@/components/fines/fine-kpis";
import { FineFilters, FineFilterState } from "@/components/fines/fine-filters";
import { BulkActionBar } from "@/components/fines/bulk-action-bar";
import { useFinesData, EnhancedFine } from "@/hooks/use-fines-data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuditLog } from "@/hooks/use-audit-log";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

// Chart configs
const STATUS_COLORS: Record<string, string> = {
  Open: "#f59e0b",
  Charged: "#6366f1",
  Waived: "#94a3b8",
  Appealed: "#06b6d4",
  Paid: "#22c55e",
};

const statusChartConfig: ChartConfig = {
  Open: { label: "Open", color: STATUS_COLORS.Open },
  Charged: { label: "Charged", color: STATUS_COLORS.Charged },
  Waived: { label: "Waived", color: STATUS_COLORS.Waived },
  Appealed: { label: "Appealed", color: STATUS_COLORS.Appealed },
  Paid: { label: "Paid", color: STATUS_COLORS.Paid },
};

const overdueRadialConfig: ChartConfig = {
  value: { label: "Overdue", color: "#ef4444" },
};

const monthlyConfig: ChartConfig = {
  count: { label: "Fines", color: "#6366f1" },
};

const vehicleBarConfig: ChartConfig = {
  count: { label: "Fines", color: "#f59e0b" },
};

const FinesList = () => {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { logAction } = useAuditLog();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();

  // State for filtering, sorting, and selection
  const [filters, setFilters] = useState<FineFilterState>({
    status: [],
    vehicleSearch: '',
    customerSearch: '',
    search: '',
  });

  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  const [selectedFines, setSelectedFines] = useState<string[]>([]);

  // Fetch fines data with current filters
  const { data: finesData, isLoading, error } = useFinesData({
    filters,
    sortBy,
    sortOrder,
  });

  // All fines with pagination
  const allFines = finesData?.fines || [];
  const totalFines = allFines.length;
  const totalPages = Math.ceil(totalFines / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFines);
  const filteredFines = allFines.slice(startIndex, endIndex);

  // Chart data derivations
  const statusDonutData = useMemo(() => {
    if (!allFines.length) return [];
    const counts = new Map<string, number>();
    allFines.forEach(f => counts.set(f.status, (counts.get(f.status) || 0) + 1));
    return Array.from(counts, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [allFines]);

  const overdueRadialData = useMemo(() => {
    if (!allFines.length) return { rate: 0, overdue: 0, openTotal: 0 };
    const openFines = allFines.filter(f => f.status === 'Open' || f.status === 'Charged');
    const overdue = openFines.filter(f => f.isOverdue).length;
    const rate = openFines.length > 0 ? Math.round((overdue / openFines.length) * 100) : 0;
    return { rate, overdue, openTotal: openFines.length };
  }, [allFines]);

  const monthlyFinesData = useMemo(() => {
    if (!allFines.length) return [];
    const now = new Date();
    const months: { label: string; start: Date }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = subMonths(now, i);
      months.push({ label: format(startOfMonth(d), 'MMM yyyy'), start: startOfMonth(d) });
    }
    return months.map((m, i) => {
      const nextStart = i < months.length - 1 ? months[i + 1].start : new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const count = allFines.filter(f => {
        const d = new Date(f.issue_date);
        return d >= m.start && d < nextStart;
      }).length;
      return { name: format(m.start, 'MMM'), count };
    });
  }, [allFines]);

  const topVehiclesData = useMemo(() => {
    if (!allFines.length) return [];
    const counts = new Map<string, { count: number; label: string }>();
    allFines.forEach(f => {
      const key = f.vehicles.reg;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { count: 1, label: `${f.vehicles.reg}` });
    });
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(v => ({ name: v.label, count: v.count }));
  }, [allFines]);

  // Reset to page 1 when filters change
  const handleFiltersChange = (newFilters: FineFilterState) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  // Get selected fine objects for bulk actions
  const selectedFineObjects = filteredFines.filter(fine => selectedFines.includes(fine.id));

  // Handle individual fine actions
  const chargeFineAction = useMutation({
    mutationFn: async (fineId: string) => {
      const { data, error } = await supabase.functions.invoke('apply-fine', {
        body: { fineId, action: 'charge' }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to charge fine');
      return { ...data, fineId };
    },
    onSuccess: (data) => {
      toast({ title: "Fine charged to customer account successfully" });
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });

      // Audit log
      logAction({
        action: "fine_charged",
        entityType: "fine",
        entityId: data.fineId,
        details: { amount: data.amount }
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to charge fine",
        variant: "destructive",
      });
    },
  });

  const waiveFineAction = useMutation({
    mutationFn: async (fineId: string) => {
      const { data, error } = await supabase.functions.invoke('apply-fine', {
        body: { fineId, action: 'waive' }
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to waive fine');
      return { ...data, fineId };
    },
    onSuccess: (data) => {
      toast({ title: "Fine waived successfully" });
      queryClient.invalidateQueries({ queryKey: ["fines-enhanced"] });
      queryClient.invalidateQueries({ queryKey: ["fines-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs"] });

      // Audit log
      logAction({
        action: "fine_waived",
        entityType: "fine",
        entityId: data.fineId,
        details: { amount: data.amount }
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to waive fine",
        variant: "destructive",
      });
    },
  });

  // Handle sorting
  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  // Handle row selection
  const handleSelectFine = (fineId: string, checked: boolean) => {
    setSelectedFines(prev =>
      checked
        ? [...prev, fineId]
        : prev.filter(id => id !== fineId)
    );
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedFines(checked ? filteredFines.map(f => f.id) : []);
  };

  // Render individual fine row
  const renderFineRow = (fine: EnhancedFine) => {
    const canCharge = fine.status === 'Open';
    const canWaive = fine.status === 'Open';

    return (
      <TableRow
        key={fine.id}
        className={cn(
          "hover:bg-muted/50",
          fine.isOverdue && "border-l-4 border-l-destructive",
          selectedFines.includes(fine.id) && "bg-primary/5"
        )}
      >
        <TableCell className="w-12">
          {canEdit('fines') && (
            <Checkbox
              checked={selectedFines.includes(fine.id)}
              onCheckedChange={(checked) => handleSelectFine(fine.id, checked as boolean)}
            />
          )}
        </TableCell>

        <TableCell className="font-medium">
          {fine.reference_no || fine.id.slice(0, 8)}
        </TableCell>

        <TableCell>
          {fine.vehicles.reg} • {fine.vehicles.make} {fine.vehicles.model}
        </TableCell>

        <TableCell>
          {fine.customers?.name || '-'}
        </TableCell>

        <TableCell>
          {new Date(fine.issue_date).toLocaleDateString()}
        </TableCell>

        <TableCell className={cn(fine.isOverdue && "text-destructive font-medium")}>
          {new Date(fine.due_date).toLocaleDateString()}
          {fine.isOverdue && (
            <Badge variant="destructive" className="ml-2 text-xs">
              {Math.abs(fine.daysUntilDue)} days overdue
            </Badge>
          )}
        </TableCell>

        <TableCell>
          <FineStatusBadge
            status={fine.status}
            dueDate={fine.due_date}
            remainingAmount={fine.amount}
          />
        </TableCell>

        <TableCell className="text-left font-medium">
          {formatCurrency(Number(fine.amount), tenant?.currency_code || 'GBP')}
        </TableCell>

        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/fines/${fine.id}`)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </TableCell>

        <TableCell className="text-right">
          {(canCharge || canWaive) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit('fines') && canCharge && (
                  <DropdownMenuItem
                    onClick={() => chargeFineAction.mutate(fine.id)}
                    disabled={chargeFineAction.isPending}
                  >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Charge to Customer
                  </DropdownMenuItem>
                )}
                {canEdit('fines') && canWaive && (
                  <DropdownMenuItem
                    onClick={() => waiveFineAction.mutate(fine.id)}
                    disabled={waiveFineAction.isPending}
                  >
                    <Ban className="h-4 w-4 mr-2" />
                    Waive Fine
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </TableCell>
      </TableRow>
    );
  };

  // Render fines table
  const renderFinesTable = (fines: EnhancedFine[]) => (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              {canEdit('fines') && (
                <Checkbox
                  checked={selectedFines.length === fines.length && fines.length > 0}
                  onCheckedChange={handleSelectAll}
                />
              )}
            </TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Issue Date</TableHead>
            <TableHead
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => handleSort('due_date')}
            >
              <div className="flex items-center gap-1">
                Due Date
                <ArrowUpDown className="h-4 w-4" />
              </div>
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead
              className="text-left cursor-pointer hover:bg-muted/50"
              onClick={() => handleSort('amount')}
            >
              <div className="flex items-center gap-1">
                Amount
                <ArrowUpDown className="h-4 w-4" />
              </div>
            </TableHead>
            <TableHead className="w-12">View</TableHead>
            <TableHead className="text-right w-12">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fines.length > 0 ? (
            fines.map(renderFineRow)
          ) : (
            <TableRow>
              <TableCell colSpan={10} className="text-center py-8">
                <div className="flex flex-col items-center space-y-2">
                  <AlertTriangle className="h-12 w-12 text-muted-foreground" />
                  <p className="text-lg font-medium">No fines found</p>
                  <p className="text-muted-foreground">
                    {filters.status.length > 0 || filters.vehicleSearch || filters.customerSearch || filters.search
                      ? "Try adjusting your filters"
                      : "Get started by adding your first fine"
                    }
                  </p>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Failed to load fines</h2>
          <p className="text-muted-foreground">Please try refreshing the page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Fines Management</h1>
          <p className="text-muted-foreground">
            Track and manage traffic fines and penalties
          </p>
        </div>
        {canEdit('fines') && (
          <Button
            onClick={() => router.push("/fines/new")}
            className="bg-gradient-primary w-full sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Fine
          </Button>
        )}
      </div>

      {/* KPIs */}
      <FineKPIs />

      {/* Charts */}
      {allFines.length > 0 && (
        <TooltipProvider>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Fine Status Distribution */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Status Breakdown</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Distribution of fines by current status</TooltipContent>
                </Tooltip>
              </div>
              <ChartContainer config={statusChartConfig} className="h-[180px] w-full">
                <PieChart>
                  <Pie
                    data={statusDonutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={72}
                    dataKey="value"
                    nameKey="name"
                    strokeWidth={2}
                    stroke="hsl(var(--background))"
                  >
                    {statusDonutData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#94a3b8"} />
                    ))}
                  </Pie>
                  <ChartTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.name] || "#94a3b8" }} />
                            <span className="text-sm font-medium">{d.name}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{d.value} fine{d.value !== 1 ? 's' : ''}</p>
                        </div>
                      );
                    }}
                  />
                  <text x="50%" y="46%" textAnchor="middle" className="fill-foreground text-xl font-bold">
                    {allFines.length}
                  </text>
                  <text x="50%" y="58%" textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    Total
                  </text>
                </PieChart>
              </ChartContainer>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                {statusDonutData.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[d.name] || "#94a3b8" }} />
                    {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>

            {/* Overdue Rate Radial */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Overdue Rate</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Percentage of active fines (Open/Charged) that are past due</TooltipContent>
                </Tooltip>
              </div>
              <ChartContainer config={overdueRadialConfig} className="h-[180px] w-full">
                <RadialBarChart
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={75}
                  startAngle={90}
                  endAngle={-270}
                  data={[{ name: "Overdue", value: overdueRadialData.rate }]}
                  barSize={14}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar
                    dataKey="value"
                    cornerRadius={8}
                    fill="#ef4444"
                    background={{ fill: "hsl(var(--muted))" }}
                    angleAxisId={0}
                  />
                  <text x="50%" y="44%" textAnchor="middle" className="fill-foreground text-2xl font-bold">
                    {overdueRadialData.rate}%
                  </text>
                  <text x="50%" y="56%" textAnchor="middle" className="fill-muted-foreground text-[11px]">
                    Overdue
                  </text>
                </RadialBarChart>
              </ChartContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  Overdue ({overdueRadialData.overdue})
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  On Time ({overdueRadialData.openTotal - overdueRadialData.overdue})
                </div>
              </div>
            </div>

            {/* Monthly Fines Trend */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Monthly Trend</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Number of fines issued per month (last 6 months)</TooltipContent>
                </Tooltip>
              </div>
              <ChartContainer config={monthlyConfig} className="h-[180px] w-full">
                <BarChart data={monthlyFinesData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <ChartTooltip
                    cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="text-xs text-muted-foreground mb-0.5">{d.name}</p>
                          <p className="text-sm font-semibold">{d.count} fine{d.count !== 1 ? 's' : ''}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Top Fined Vehicles */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Top Fined Vehicles</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Vehicles with the most fines</TooltipContent>
                </Tooltip>
              </div>
              <ChartContainer config={vehicleBarConfig} className="h-[180px] w-full">
                <BarChart data={topVehiclesData} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={75}
                  />
                  <ChartTooltip
                    cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="text-xs text-muted-foreground mb-0.5">{d.name}</p>
                          <p className="text-sm font-semibold">{d.count} fine{d.count !== 1 ? 's' : ''}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        </TooltipProvider>
      )}

      {/* Filters */}
      <FineFilters onFiltersChange={handleFiltersChange} />

      {/* Bulk Action Bar */}
      {canEdit('fines') && selectedFines.length > 0 && (
        <BulkActionBar
          selectedFines={selectedFineObjects}
          onClearSelection={() => setSelectedFines([])}
        />
      )}

      {/* Fines Table */}
      {isLoading ? (
        <div className="text-center py-8">Loading fines...</div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              {renderFinesTable(filteredFines)}
            </CardContent>
          </Card>

          {/* Pagination */}
          {totalFines > 0 && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {startIndex + 1}-{endIndex} of {totalFines} fines
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
          )}
        </>
      )}
    </div>
  );
};

export default FinesList;
