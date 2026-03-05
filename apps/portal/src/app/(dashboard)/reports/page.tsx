'use client';

import React, { useState, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { BarChart3, Download, FileText, TrendingUp, Users, Car, CreditCard, Clock, AlertTriangle, Info } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FilterSidebar } from '@/components/reports/filter-sidebar';
import { ReportCard } from '@/components/reports/report-card';
import { DataTable } from '@/components/reports/data-table';
import { ExportButtons } from '@/components/reports/export-buttons';
import { ReportPreviewModal } from '@/components/reports/report-preview-modal';
import { AgingReceivablesDetail } from '@/components/reports/aging-receivables-detail';
import { EmptyStateIllustration } from '@/components/reports/empty-state-illustration';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import {
  BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';

// --- Chart configs ---
const REPORT_COLORS: Record<string, string> = {
  Revenue: '#22c55e',
  Costs: '#dc2626',
  Profit: '#6366f1',
  Applied: '#22c55e',
  Unapplied: '#f59e0b',
  Payments: '#6366f1',
  Rentals: '#22c55e',
  Fines: '#dc2626',
  Aging: '#f59e0b',
};

const plBarConfig: ChartConfig = {
  amount: { label: 'Amount', color: '#6366f1' },
};

const paymentSplitConfig: ChartConfig = {
  Applied: { label: 'Applied', color: '#22c55e' },
  Unapplied: { label: 'Unapplied', color: '#f59e0b' },
};

const overviewConfig: ChartConfig = {
  value: { label: 'Amount', color: '#6366f1' },
};

export interface ReportFilters {
  fromDate: Date;
  toDate: Date;
  customers: string[];
  vehicles: string[];
  rentals: string[];
  paymentTypes: string[];
  statuses: string[];
}

const Reports = () => {
  const { tenant } = useTenant();
  const [filters, setFilters] = useState<ReportFilters>({
    fromDate: subDays(new Date(), 30),
    toDate: new Date(),
    customers: [],
    vehicles: [],
    rentals: [],
    paymentTypes: [],
    statuses: []
  });

  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewReportId, setPreviewReportId] = useState<string>('');
  const [showAgingDetail, setShowAgingDetail] = useState(false);
  const [exportingReport, setExportingReport] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const clearAllFilters = () => {
    setFilters({
      fromDate: subDays(new Date(), 30),
      toDate: new Date(),
      customers: [],
      vehicles: [],
      rentals: [],
      paymentTypes: [],
      statuses: []
    });
  };

  const handleExport = async (reportType: string, exportFormat: 'csv' | 'xlsx' | 'pdf') => {
    const exportKey = `${reportType}-${exportFormat}`;
    setExportingReport(exportKey);

    try {
      const exportData = {
        reportType,
        exportType: exportFormat,
        filters: {
          ...filters,
          fromDate: format(filters.fromDate, 'yyyy-MM-dd'),
          toDate: format(filters.toDate, 'yyyy-MM-dd')
        }
      };

      const { data, error } = await supabase.functions.invoke('generate-export', {
        body: exportData
      });

      if (error) throw error;

      // Create download with proper file naming
      const fromDateStr = format(filters.fromDate, 'yyyy-MM-dd');
      const toDateStr = format(filters.toDate, 'yyyy-MM-dd');
      const filename = `${reportType}_${fromDateStr}_${toDateStr}.${exportFormat}`;

      // Decode base64 for XLSX
      let blobData;
      if (exportFormat === 'xlsx') {
        const binaryString = atob(data.content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blobData = bytes;
      } else {
        blobData = data.content;
      }

      const blob = new Blob([blobData], {
        type: exportFormat === 'pdf' ? 'application/pdf' :
              exportFormat === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
              'text/csv'
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: 'Export successful',
        description: `${reportType.replace('-', ' ')} exported as ${exportFormat.toUpperCase()}`
      });

    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Export failed',
        description: 'There was an error generating the export. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setExportingReport(null);
    }
  };

  const openPreviewModal = (reportId: string) => {
    setPreviewReportId(reportId);
    setPreviewModalOpen(true);
  };

  // Fetch summary statistics for report cards
  const { data: reportStats, isLoading } = useQuery({
    queryKey: ['report-stats', filters],
    queryFn: async () => {
      const fromDate = format(filters.fromDate, 'yyyy-MM-dd');
      const toDate = format(filters.toDate, 'yyyy-MM-dd');

      // Get payments count and total with filters
      let paymentsQuery = supabase
        .from('view_payments_export')
        .select('amount, applied_amount, unapplied_amount, customer_id, payment_type')
        .gte('payment_date', fromDate)
        .lte('payment_date', toDate);

      if (filters.customers.length > 0) {
        paymentsQuery = paymentsQuery.in('customer_id', filters.customers);
      }
      if (filters.paymentTypes.length > 0) {
        paymentsQuery = paymentsQuery.in('payment_type', filters.paymentTypes);
      }
      if (tenant?.id) {
        paymentsQuery = paymentsQuery.eq('tenant_id', tenant.id);
      }

      const { data: payments } = await paymentsQuery;

      // Get P&L totals
      let plQuery = supabase
        .from('view_pl_consolidated')
        .select('*');

      if (tenant?.id) {
        plQuery = plQuery.eq('tenant_id', tenant.id);
      }

      const { data: plData } = await plQuery.single();

      // Get rentals count with filters
      let rentalsQuery: any = (supabase as any)
        .from('view_rentals_export')
        .select('rental_id, balance, customer_id, vehicle_id')
        .gte('start_date', fromDate)
        .lte('start_date', toDate);

      if (filters.customers.length > 0) {
        rentalsQuery = rentalsQuery.in('customer_id', filters.customers);
      }
      if (filters.vehicles.length > 0) {
        rentalsQuery = rentalsQuery.in('vehicle_id', filters.vehicles);
      }
      if (tenant?.id) {
        rentalsQuery = rentalsQuery.eq('tenant_id', tenant.id);
      }

      const { data: rentals } = await rentalsQuery;

      // Get aging receivables with filters
      let agingQuery: any = (supabase as any)
        .from('view_aging_receivables')
        .select('*');

      if (filters.customers.length > 0) {
        agingQuery = agingQuery.in('customer_id', filters.customers);
      }
      if (tenant?.id) {
        agingQuery = agingQuery.eq('tenant_id', tenant.id);
      }

      const { data: aging } = await agingQuery;

      // Get fines data with filters
      let finesQuery: any = (supabase as any)
        .from('view_fines_export')
        .select('fine_id, amount, remaining_amount, customer_id, vehicle_id')
        .gte('issue_date', fromDate)
        .lte('issue_date', toDate);

      if (filters.customers.length > 0) {
        finesQuery = finesQuery.in('customer_id', filters.customers);
      }
      if (filters.vehicles.length > 0) {
        finesQuery = finesQuery.in('vehicle_id', filters.vehicles);
      }
      if (tenant?.id) {
        finesQuery = finesQuery.eq('tenant_id', tenant.id);
      }

      const { data: fines } = await finesQuery;

      return {
        payments: {
          count: payments?.length || 0,
          totalAmount: payments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0,
          appliedAmount: payments?.reduce((sum, p) => sum + Number(p.applied_amount), 0) || 0,
          unappliedAmount: payments?.reduce((sum, p) => sum + Number(p.unapplied_amount), 0) || 0
        },
        pl: plData || {
          net_profit: 0,
          total_revenue: 0,
          total_costs: 0
        },
        rentals: {
          count: rentals?.length || 0,
          totalBalance: rentals?.reduce((sum, r) => sum + Number(r.balance), 0) || 0
        },
        fines: {
          count: fines?.length || 0,
          totalOutstanding: fines?.reduce((sum, f) => sum + Number(f.remaining_amount), 0) || 0
        },
        aging: {
          count: aging?.length || 0,
          totalDue: aging?.reduce((sum, a) => sum + Number(a.total_due), 0) || 0
        }
      };
    }
  });

  const reportCards = [
    {
      id: 'payments',
      title: 'Payments Export',
      description: 'Applied/unapplied payment analysis (CSV/XLSX)',
      icon: CreditCard,
      value: formatCurrency(reportStats?.payments.totalAmount || 0, tenant?.currency_code || 'GBP'),
      subtitle: `${reportStats?.payments.count || 0} payments`,
      metadata: `Applied: ${formatCurrency(reportStats?.payments.appliedAmount || 0, tenant?.currency_code || 'GBP')}`
    },
    {
      id: 'pl-report',
      title: 'P&L Report',
      description: 'Vehicle & consolidated profit/loss (CSV/XLSX)',
      icon: TrendingUp,
      value: formatCurrency(reportStats?.pl.net_profit || 0, tenant?.currency_code || 'GBP'),
      subtitle: 'Net Profit',
      metadata: `Revenue: ${formatCurrency(reportStats?.pl.total_revenue || 0, tenant?.currency_code || 'GBP')}`
    },
    {
      id: 'customer-statements',
      title: 'Customer Statements',
      description: 'Ledger-based with running balance (PDF/CSV/XLSX)',
      icon: FileText,
      value: `${reportStats?.aging.count || 0}`,
      subtitle: 'Customers with balances',
      metadata: `Total Due: ${formatCurrency(reportStats?.aging.totalDue || 0, tenant?.currency_code || 'GBP')}`
    },
    {
      id: 'rentals',
      title: 'Rentals Export',
      description: 'Active rentals with computed balance (CSV/XLSX)',
      icon: Car,
      value: `${reportStats?.rentals.count || 0}`,
      subtitle: 'Active rentals',
      metadata: `Outstanding: ${formatCurrency(reportStats?.rentals.totalBalance || 0, tenant?.currency_code || 'GBP')}`
    },
    {
      id: 'fines',
      title: 'Fines Export',
      description: 'Comprehensive fine data with status (CSV/XLSX)',
      icon: AlertTriangle,
      value: `${reportStats?.fines?.count || 0}`,
      subtitle: 'Total fines',
      metadata: `Outstanding: ${formatCurrency(reportStats?.fines?.totalOutstanding || 0, tenant?.currency_code || 'GBP')}`
    },
    {
      id: 'aging',
      title: 'Aging Receivables',
      description: 'Age buckets 0-30/31-60/61-90/90+ days (CSV/XLSX)',
      icon: Clock,
      value: formatCurrency(reportStats?.aging.totalDue || 0, tenant?.currency_code || 'GBP'),
      subtitle: 'Total overdue',
      metadata: `${reportStats?.aging.count || 0} customers`
    }
  ];

  // --- Chart data derivations ---
  const plComparisonData = useMemo(() => {
    if (!reportStats) return [];
    return [
      { name: 'Revenue', amount: Number(reportStats.pl.total_revenue) || 0, fill: REPORT_COLORS.Revenue },
      { name: 'Costs', amount: Number(reportStats.pl.total_costs) || 0, fill: REPORT_COLORS.Costs },
      { name: 'Profit', amount: Number(reportStats.pl.net_profit) || 0, fill: REPORT_COLORS.Profit },
    ];
  }, [reportStats]);

  const paymentSplitData = useMemo(() => {
    if (!reportStats) return [];
    return [
      { name: 'Applied', value: reportStats.payments.appliedAmount, fill: REPORT_COLORS.Applied },
      { name: 'Unapplied', value: reportStats.payments.unappliedAmount, fill: REPORT_COLORS.Unapplied },
    ].filter((d) => d.value > 0);
  }, [reportStats]);

  const outstandingOverviewData = useMemo(() => {
    if (!reportStats) return [];
    return [
      { name: 'Rental Balance', value: reportStats.rentals.totalBalance, fill: REPORT_COLORS.Rentals },
      { name: 'Fines Outstanding', value: reportStats.fines.totalOutstanding, fill: REPORT_COLORS.Fines },
      { name: 'Aging Due', value: reportStats.aging.totalDue, fill: REPORT_COLORS.Aging },
    ].filter((d) => d.value > 0);
  }, [reportStats]);

  const collectionRateData = useMemo(() => {
    if (!reportStats) return { rate: 0, applied: 0, total: 0 };
    const total = reportStats.payments.totalAmount;
    const applied = reportStats.payments.appliedAmount;
    const rate = total > 0 ? Math.round((applied / total) * 100) : 0;
    return { rate, applied, total };
  }, [reportStats]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="mb-2">
              <h1 className="text-xl font-semibold">Reports & Exports</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Generate detailed reports and export data across your fleet
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 h-full">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse h-48">
              <CardHeader>
                <div className="h-4 bg-muted rounded w-3/4"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <div className="mb-2">
          <h1 className="text-3xl font-bold whitespace-nowrap">Reports & Exports</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Generate detailed reports and export data across your fleet
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Filters Sidebar */}
        <div className="w-full lg:w-80 lg:flex-shrink-0">
          <FilterSidebar filters={filters} onFiltersChange={setFilters} />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {!selectedReport ? (
            <>
              {showAgingDetail ? (
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAgingDetail(false)}
                    className="mb-4"
                  >
                    ← Back to Reports
                  </Button>
                  <AgingReceivablesDetail isOpen={showAgingDetail} />
                </div>
              ) : reportStats && (reportStats.payments.count === 0 && reportStats.rentals.count === 0) ? (
                <EmptyStateIllustration
                  title="No data found"
                  description="No reports are available for the selected date range and filters. Try adjusting your criteria to see available data."
                  onClearFilters={clearAllFilters}
                />
              ) : (
                <>
                  <div className="mb-6">
                    <h2 className="text-lg font-medium mb-2">Available Reports</h2>
                    <p className="text-muted-foreground text-sm">
                      Click on a report card to preview data or use export icons for direct downloads.
                      All amounts shown in {tenant?.currency_code || 'GBP'} with America/NewYork timezone.
                    </p>
                  </div>

                  {/* Charts */}
                  <TooltipProvider>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                      {/* P&L Comparison */}
                      <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                        <div className="flex items-center gap-1.5 mb-3">
                          <h3 className="text-sm font-medium">P&L Overview</h3>
                          <Tooltip>
                            <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Revenue, costs, and net profit</TooltipContent>
                          </Tooltip>
                        </div>
                        {plComparisonData.length > 0 ? (
                          <ChartContainer config={plBarConfig} className="h-[180px] w-full">
                            <BarChart data={plComparisonData}>
                              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={45} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                              <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                                {plComparisonData.map((entry) => (
                                  <Cell key={entry.name} fill={entry.fill} />
                                ))}
                              </Bar>
                              <ChartTooltip cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.08 }} content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                                    <div className="flex items-center gap-2">
                                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
                                      <span className="text-sm font-medium">{d.name}</span>
                                    </div>
                                    <p className="text-sm font-semibold mt-0.5">{formatCurrency(d.amount, tenant?.currency_code || 'GBP')}</p>
                                  </div>
                                );
                              }} />
                            </BarChart>
                          </ChartContainer>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-10">No data</p>
                        )}
                      </div>

                      {/* Payment Split Donut */}
                      <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                        <div className="flex items-center gap-1.5 mb-3">
                          <h3 className="text-sm font-medium">Payment Allocation</h3>
                          <Tooltip>
                            <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Applied vs unapplied payments</TooltipContent>
                          </Tooltip>
                        </div>
                        {paymentSplitData.length > 0 ? (
                          <ChartContainer config={paymentSplitConfig} className="h-[180px] w-full">
                            <PieChart>
                              <Pie data={paymentSplitData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                                {paymentSplitData.map((entry) => (
                                  <Cell key={entry.name} fill={entry.fill} />
                                ))}
                              </Pie>
                              <ChartTooltip content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                                    <div className="flex items-center gap-2">
                                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
                                      <span className="text-sm font-medium">{d.name}</span>
                                    </div>
                                    <p className="text-sm font-semibold mt-0.5">{formatCurrency(d.value, tenant?.currency_code || 'GBP')}</p>
                                  </div>
                                );
                              }} />
                            </PieChart>
                          </ChartContainer>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-10">No data</p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                          {paymentSplitData.map((d) => (
                            <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="h-2 w-2 rounded-full" style={{ background: d.fill }} />
                              {d.name}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Collection Rate Radial */}
                      <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                        <div className="flex items-center gap-1.5 mb-3">
                          <h3 className="text-sm font-medium">Collection Rate</h3>
                          <Tooltip>
                            <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Percentage of payments applied</TooltipContent>
                          </Tooltip>
                        </div>
                        <ChartContainer config={{ rate: { label: 'Collection Rate', color: '#22c55e' } }} className="h-[180px] w-full">
                          <RadialBarChart
                            innerRadius="70%"
                            outerRadius="100%"
                            data={[{ rate: collectionRateData.rate, fill: '#22c55e' }]}
                            startAngle={180}
                            endAngle={0}
                            cx="50%"
                            cy="65%"
                          >
                            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                            <RadialBar background dataKey="rate" cornerRadius={6} />
                            <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                              {collectionRateData.rate}%
                            </text>
                            <text x="50%" y="70%" textAnchor="middle" className="fill-muted-foreground text-xs">
                              applied / total
                            </text>
                          </RadialBarChart>
                        </ChartContainer>
                      </div>

                      {/* Outstanding Overview */}
                      <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                        <div className="flex items-center gap-1.5 mb-3">
                          <h3 className="text-sm font-medium">Outstanding</h3>
                          <Tooltip>
                            <TooltipTrigger><Info className="h-3.5 w-3.5 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Outstanding balances across categories</TooltipContent>
                          </Tooltip>
                        </div>
                        {outstandingOverviewData.length > 0 ? (
                          <ChartContainer config={overviewConfig} className="h-[180px] w-full">
                            <BarChart data={outstandingOverviewData} layout="vertical" margin={{ left: 0, right: 8 }}>
                              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                              <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} width={90} />
                              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                {outstandingOverviewData.map((entry) => (
                                  <Cell key={entry.name} fill={entry.fill} />
                                ))}
                              </Bar>
                              <ChartTooltip cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.08 }} content={({ active, payload }) => {
                                if (!active || !payload?.length) return null;
                                const d = payload[0].payload;
                                return (
                                  <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                                    <div className="flex items-center gap-2">
                                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.fill }} />
                                      <span className="text-sm font-medium">{d.name}</span>
                                    </div>
                                    <p className="text-sm font-semibold mt-0.5">{formatCurrency(d.value, tenant?.currency_code || 'GBP')}</p>
                                  </div>
                                );
                              }} />
                            </BarChart>
                          </ChartContainer>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-10">No data</p>
                        )}
                      </div>
                    </div>
                  </TooltipProvider>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {reportCards.map((report) => (
                      <ReportCard
                        key={report.id}
                        {...report}
                        onClick={() => {
                          if (report.id === 'aging') {
                            setShowAgingDetail(true);
                          } else {
                            openPreviewModal(report.id);
                          }
                        }}
                        onExport={(exportFormat) => handleExport(report.id, exportFormat)}
                        exportingReport={exportingReport}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-6">
                <Button
                  variant="outline"
                  onClick={() => setSelectedReport(null)}
                >
                  ← Back to Reports
                </Button>
                <ExportButtons
                  reportType={selectedReport}
                  filters={filters}
                />
              </div>

              <DataTable
                reportType={selectedReport}
                filters={filters}
              />
            </div>
          )}
        </div>
      </div>

      {/* Report Preview Modal */}
      <ReportPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        reportId={previewReportId}
        reportTitle={reportCards.find(r => r.id === previewReportId)?.title || ''}
        filters={filters}
        onExport={(exportFormat) => handleExport(previewReportId, exportFormat)}
      />
    </div>
  );
};

export default Reports;
