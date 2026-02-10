'use client';

import { useState, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, Car, DollarSign, TrendingUp, TrendingDown, Download, ArrowUpDown, ArrowUp, ArrowDown, BarChart3 } from "lucide-react";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { PLBreadcrumb } from "@/components/shared/data-display/pl-breadcrumb";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency as formatCurrencyUtil } from "@/lib/format-utils";

interface VehicleMonthlyPL {
  vehicle_id: string;
  vehicle_reg: string;
  make_model: string;
  revenue_rental: number;
  revenue_fees: number;
  cost_service: number;
  cost_fines: number;
  cost_other: number;
  total_revenue: number;
  total_costs: number;
  net_profit: number;
}

type SortField = 'vehicle_reg' | 'total_revenue' | 'total_costs' | 'net_profit';
type SortDirection = 'asc' | 'desc';

const MonthlyPLDrilldown = () => {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { tenant } = useTenant();
  const [sortField, setSortField] = useState<SortField>('net_profit');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showChart, setShowChart] = useState(false);

  // Extract filter context from URL params
  const fromDateRange = searchParams.get('from');
  const groupByMonth = searchParams.get('groupByMonth') === 'true';

  const month = params.month as string;

  if (!month) {
    router.push('/pl-dashboard');
    return null;
  }

  // Parse month parameter (format: YYYY-MM)
  const monthDate = parseISO(`${month}-01`);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);

  // Fetch vehicle P&L data for the specific month
  const { data: vehicleData, isLoading } = useQuery({
    queryKey: ["monthlyVehiclePL", month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pnl_entries")
        .select(`
          vehicle_id,
          side,
          category,
          amount,
          vehicles!pnl_entries_vehicle_id_fkey(id, reg, make, model)
        `)
        .gte("entry_date", monthStart.toISOString().split('T')[0])
        .lte("entry_date", monthEnd.toISOString().split('T')[0]);

      if (error) throw error;

      // Group by vehicle and calculate totals (filter out entries with missing vehicles)
      const groupedData: Record<string, VehicleMonthlyPL> = {};

      data?.filter(entry => entry.vehicles).forEach((entry) => {
        const vehicleId = entry.vehicle_id;
        const vehicle = entry.vehicles as any;

        if (!groupedData[vehicleId]) {
          groupedData[vehicleId] = {
            vehicle_id: vehicleId,
            vehicle_reg: vehicle.reg,
            make_model: `${vehicle.make} ${vehicle.model}`.trim(),
            revenue_rental: 0,
            revenue_fees: 0,
            cost_service: 0,
            cost_fines: 0,
            cost_other: 0,
            total_revenue: 0,
            total_costs: 0,
            net_profit: 0,
          };
        }

        const amount = Number(entry.amount);

        if (entry.side === 'Revenue') {
          if (entry.category === 'Rental') {
            groupedData[vehicleId].revenue_rental += amount;
          } else if (entry.category === 'Initial Fees' || entry.category === 'Initial Fee') {
            groupedData[vehicleId].revenue_fees += amount;
          }
          groupedData[vehicleId].total_revenue += amount;
        } else if (entry.side === 'Cost') {
          if (entry.category === 'Service') {
            groupedData[vehicleId].cost_service += amount;
          } else if (entry.category === 'Fines' || entry.category === 'Fine') {
            groupedData[vehicleId].cost_fines += amount;
          } else {
            groupedData[vehicleId].cost_other += amount;
          }
          groupedData[vehicleId].total_costs += amount;
        }
      });

      // Calculate net profit
      Object.values(groupedData).forEach(vehicle => {
        vehicle.net_profit = vehicle.total_revenue - vehicle.total_costs;
      });

      return Object.values(groupedData);
    },
  });

  // Calculate monthly summary
  const monthlyTotals = useMemo(() => {
    if (!vehicleData) return null;

    return vehicleData.reduce(
      (acc, vehicle) => ({
        total_revenue: acc.total_revenue + vehicle.total_revenue,
        total_costs: acc.total_costs + vehicle.total_costs,
        net_profit: acc.net_profit + vehicle.net_profit,
        active_vehicles: acc.active_vehicles + 1,
      }),
      { total_revenue: 0, total_costs: 0, net_profit: 0, active_vehicles: 0 }
    );
  }, [vehicleData]);

  // Sort vehicles data
  const sortedVehicleData = useMemo(() => {
    if (!vehicleData) return [];

    return [...vehicleData].sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      const numA = Number(aValue);
      const numB = Number(bValue);
      return sortDirection === 'asc' ? numA - numB : numB - numA;
    });
  }, [vehicleData, sortField, sortDirection]);

  const formatCurrency = (amount: number) => {
    return formatCurrencyUtil(amount, tenant?.currency_code || 'USD');
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'vehicle_reg' ? 'asc' : 'desc');
    }
  };

  const exportToCSV = () => {
    if (!vehicleData?.length) return;

    const headers = [
      'Vehicle',
      'Make/Model',
      'Rental Revenue',
      'Initial Fees',
      'Service Cost',
      'Fines Cost',
      'Other Cost',
      'Total Revenue',
      'Total Costs',
      'Net Profit',
    ];

    const csvContent = [
      headers.join(','),
      ...sortedVehicleData.map(vehicle => [
        vehicle.vehicle_reg,
        `"${vehicle.make_model}"`,
        vehicle.revenue_rental,
        vehicle.revenue_fees,
        vehicle.cost_service,
        vehicle.cost_fines,
        vehicle.cost_other,
        vehicle.total_revenue,
        vehicle.total_costs,
        vehicle.net_profit,
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `pl-breakdown-${month}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      className="h-auto p-0 font-medium hover:bg-transparent"
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortField === field ? (
          sortDirection === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        )}
      </div>
    </Button>
  );

  const getStatusBadge = (netProfit: number) => {
    if (netProfit > 0) {
      return <Badge className="bg-success text-success-foreground">Profitable</Badge>;
    } else if (netProfit < 0) {
      return <Badge className="bg-destructive text-destructive-foreground">Loss</Badge>;
    } else {
      return <Badge variant="secondary">Break Even</Badge>;
    }
  };

  // Prepare chart data
  const chartData = sortedVehicleData?.map(vehicle => ({
    vehicle: vehicle.vehicle_reg,
    Revenue: vehicle.total_revenue,
    Costs: vehicle.total_costs,
    Net: vehicle.net_profit,
  }));

  // Breadcrumb items
  const breadcrumbItems = [
    { label: "Global P&L Dashboard", href: `/pl-dashboard${fromDateRange ? `?dateRange=${fromDateRange}` : ''}${groupByMonth ? `${fromDateRange ? '&' : '?'}groupByMonth=true` : ''}` },
    { label: format(parseISO(`${month}-01`), 'MMMM yyyy'), current: true }
  ];

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading monthly breakdown...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <PLBreadcrumb items={breadcrumbItems} />
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <UITooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => router.push(`/pl-dashboard${fromDateRange ? `?dateRange=${fromDateRange}` : ''}${groupByMonth ? `${fromDateRange ? '&' : '?'}groupByMonth=true` : ''}`)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Back to Global P&L Dashboard</p>
              </TooltipContent>
            </UITooltip>
          </TooltipProvider>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              P&L Breakdown – {format(monthDate, 'MMMM yyyy')}
            </h1>
            <p className="text-muted-foreground mt-1">
              Vehicle performance breakdown for the selected month
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={exportToCSV}
            className="flex items-center gap-2"
            disabled={!vehicleData?.length}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>

          <Button
            variant="outline"
            onClick={() => setShowChart(!showChart)}
            className="flex items-center gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            {showChart ? 'Show Table' : 'Show Chart'}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {monthlyTotals && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(monthlyTotals.total_revenue)}</div>
              <div className="text-xs text-muted-foreground mt-2">Monthly total</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Costs</CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(monthlyTotals.total_costs)}</div>
              <div className="text-xs text-muted-foreground mt-2">Monthly total</div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
              <DollarSign className={cn(
                "h-4 w-4",
                monthlyTotals.net_profit > 0 ? "text-success" :
                monthlyTotals.net_profit < 0 ? "text-destructive" :
                "text-muted-foreground"
              )} />
            </CardHeader>
            <CardContent>
              <div className={cn(
                "text-2xl font-bold",
                monthlyTotals.net_profit > 0 ? "text-success" :
                monthlyTotals.net_profit < 0 ? "text-destructive" : ""
              )}>
                {formatCurrency(monthlyTotals.net_profit)}
              </div>
              <div className="flex items-center mt-2 text-xs text-muted-foreground">
                {monthlyTotals.net_profit > 0 && (
                  <>
                    <TrendingUp className="h-3 w-3 text-success mr-1" />
                    <span>Positive</span>
                  </>
                )}
                {monthlyTotals.net_profit < 0 && (
                  <>
                    <TrendingDown className="h-3 w-3 text-destructive mr-1" />
                    <span>Negative</span>
                  </>
                )}
                {monthlyTotals.net_profit === 0 && <span>—</span>}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Vehicles Active</CardTitle>
              <Car className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{monthlyTotals.active_vehicles}</div>
              <div className="text-xs text-muted-foreground mt-2">This month</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Vehicle Breakdown */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Vehicle Performance Breakdown</CardTitle>
          <CardDescription>
            Click on a vehicle to view detailed P&L for this month
          </CardDescription>
        </CardHeader>
        <CardContent>
          {showChart ? (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="vehicle" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(value) => `${formatCurrencyUtil(value / 1000, tenant?.currency_code || 'GBP').replace(/[^0-9.-]/g, '')}k`} />
                  <Tooltip
                    formatter={(value: number, name: string) => [formatCurrency(value), name]}
                    labelClassName="text-foreground"
                    contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Legend />
                  <Bar dataKey="Revenue" fill="hsl(var(--success))" />
                  <Bar dataKey="Costs" fill="hsl(var(--destructive))" />
                  <Bar dataKey="Net" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>
                      <SortButton field="vehicle_reg">Vehicle</SortButton>
                    </TableHead>
                    <TableHead className="text-right">Rental Revenue</TableHead>
                    <TableHead className="text-right">Initial Fees</TableHead>
                    <TableHead className="text-right">Services</TableHead>
                    <TableHead className="text-right">Fines</TableHead>
                    <TableHead className="text-right">Other</TableHead>
                    <TableHead className="text-right">
                      <SortButton field="total_costs">Total Costs</SortButton>
                    </TableHead>
                    <TableHead className="text-right">
                      <SortButton field="net_profit">Net</SortButton>
                    </TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedVehicleData?.map((vehicle) => (
                    <TableRow
                      key={vehicle.vehicle_id}
                      className="hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/vehicles/${vehicle.vehicle_id}?tab=pl&month=${month}&from=monthly`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && router.push(`/vehicles/${vehicle.vehicle_id}?tab=pl&month=${month}&from=monthly`)}
                    >
                      <TableCell>
                        <div>
                          <div className="font-medium">{vehicle.vehicle_reg}</div>
                          <div className="text-xs text-muted-foreground">{vehicle.make_model}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(vehicle.revenue_rental)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(vehicle.revenue_fees)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(vehicle.cost_service)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(vehicle.cost_fines)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(vehicle.cost_other)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{formatCurrency(vehicle.total_costs)}</TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        <span className={cn(
                          vehicle.net_profit > 0 ? 'text-success' :
                          vehicle.net_profit < 0 ? 'text-destructive' : ''
                        )}>
                          {formatCurrency(vehicle.net_profit)}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(vehicle.net_profit)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default MonthlyPLDrilldown;
