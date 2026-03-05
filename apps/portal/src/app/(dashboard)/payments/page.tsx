"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from "recharts";
import {
  CreditCard,
  Plus,
  MoreHorizontal,
  FileText,
  Download,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  XCircle,
  Clock,
  Undo2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { eachDayOfInterval, format, startOfMonth, endOfMonth } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { formatInTimeZone } from "date-fns-tz";
import { PaymentSummaryCards } from "@/components/payments/payment-summary-cards";
import { PaymentFilters, PaymentFilters as IPaymentFilters } from "@/components/payments/payment-filters";
import { AddPaymentDialog } from "@/components/shared/dialogs/add-payment-dialog";
import { usePaymentsData, exportPaymentsCSV } from "@/hooks/use-payments-data";
import { usePaymentVerificationActions, getVerificationStatusInfo, VerificationStatus } from "@/hooks/use-payment-verification";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";

// Helper function to display user-friendly payment type names
const getPaymentTypeDisplay = (paymentType: string): string => {
  switch (paymentType) {
    case 'InitialFee':
      return 'Initial Fee';
    case 'Payment':
      return 'Customer Payment';
    default:
      return paymentType;
  }
};

// Chart configs
const METHOD_COLORS: Record<string, string> = {
  Cash: "#6366f1",
  Card: "#8b5cf6",
  "Bank Transfer": "#06b6d4",
  Stripe: "#f59e0b",
  Other: "#94a3b8",
};

const methodChartConfig: ChartConfig = {
  Cash: { label: "Cash", color: METHOD_COLORS.Cash },
  Card: { label: "Card", color: METHOD_COLORS.Card },
  "Bank Transfer": { label: "Bank Transfer", color: METHOD_COLORS["Bank Transfer"] },
  Stripe: { label: "Stripe", color: METHOD_COLORS.Stripe },
  Other: { label: "Other", color: METHOD_COLORS.Other },
};

const VERIFICATION_COLORS: Record<string, string> = {
  auto_approved: "#22c55e",
  approved: "#16a34a",
  pending: "#f59e0b",
  rejected: "#ef4444",
};

const verificationChartConfig: ChartConfig = {
  auto_approved: { label: "Auto Approved", color: VERIFICATION_COLORS.auto_approved },
  approved: { label: "Approved", color: VERIFICATION_COLORS.approved },
  pending: { label: "Pending", color: VERIFICATION_COLORS.pending },
  rejected: { label: "Rejected", color: VERIFICATION_COLORS.rejected },
};

const amountDistConfig: ChartConfig = {
  count: { label: "Payments", color: "#6366f1" },
};

const areaChartConfig: ChartConfig = {
  amount: { label: "Amount", color: "#6366f1" },
};

const PaymentsList = () => {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const { canEdit } = useManagerPermissions();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectPaymentId, setRejectPaymentId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Reverse payment state
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [reversePaymentId, setReversePaymentId] = useState<string | null>(null);
  const [reversePaymentDetails, setReversePaymentDetails] = useState<{ amount: number; customerName: string } | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);

  // Get settings and verification actions
  const { settings } = useOrgSettings();
  const { approvePayment, rejectPayment, isLoading: isVerifying } = usePaymentVerificationActions();

  // Initialize date filters for "thisMonth" on mount
  const getInitialFilters = (): IPaymentFilters => {
    const today = new Date();
    return {
      customerSearch: '',
      vehicleSearch: '',
      method: 'all',
      dateFrom: new Date(today.getFullYear(), today.getMonth(), 1),
      dateTo: today,
      quickFilter: 'thisMonth',
      verificationStatus: 'all',
    };
  };

  // Filter and pagination state
  const [filters, setFilters] = useState<IPaymentFilters>(getInitialFilters);

  const [sortBy, setSortBy] = useState('payment_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data: paymentsData, isLoading } = usePaymentsData({
    filters,
    sortBy,
    sortOrder,
    page,
    pageSize
  });

  // Separate lightweight query for chart data (current month, all payments)
  const { data: chartPayments } = useQuery({
    queryKey: ["payments-chart-data", tenant?.id],
    queryFn: async () => {
      const firstOfMonth = startOfMonth(new Date()).toISOString().split('T')[0];
      const { data } = await supabase
        .from("payments")
        .select("amount, payment_date, method, payment_type, verification_status")
        .eq("tenant_id", tenant!.id)
        .gte("payment_date", firstOfMonth);
      return data || [];
    },
    enabled: !!tenant,
    staleTime: 60000,
  });

  // Chart data derivations
  const dailyTrendData = useMemo(() => {
    if (!chartPayments?.length) return [];
    const now = new Date();
    const days = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) });
    const dayMap = new Map<string, number>();
    chartPayments.forEach((p: any) => {
      const key = p.payment_date?.split('T')[0] || '';
      dayMap.set(key, (dayMap.get(key) || 0) + (p.amount || 0));
    });
    return days.map(d => {
      const key = format(d, 'yyyy-MM-dd');
      return { date: format(d, 'dd MMM'), amount: dayMap.get(key) || 0 };
    });
  }, [chartPayments]);

  const methodDonutData = useMemo(() => {
    if (!chartPayments?.length) return [];
    const counts = new Map<string, number>();
    chartPayments.forEach((p: any) => {
      const method = p.method || 'Other';
      counts.set(method, (counts.get(method) || 0) + 1);
    });
    return Array.from(counts, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [chartPayments]);

  const amountDistData = useMemo(() => {
    if (!chartPayments?.length) return [];
    const buckets = [
      { label: "< 100", min: 0, max: 100 },
      { label: "100–500", min: 100, max: 500 },
      { label: "500–1k", min: 500, max: 1000 },
      { label: "1k–2.5k", min: 1000, max: 2500 },
      { label: "2.5k–5k", min: 2500, max: 5000 },
      { label: "5k+", min: 5000, max: Infinity },
    ];
    const counts = new Array(buckets.length).fill(0);
    chartPayments.forEach((p: any) => {
      const amt = p.amount || 0;
      for (let i = 0; i < buckets.length; i++) {
        if (amt >= buckets[i].min && amt < buckets[i].max) {
          counts[i]++;
          break;
        }
      }
    });
    return buckets.map((b, i) => ({ name: b.label, count: counts[i] }));
  }, [chartPayments]);

  const approvalRadialData = useMemo(() => {
    if (!chartPayments?.length) return { rate: 0, approved: 0, total: 0, pending: 0, rejected: 0 };
    let approved = 0, pending = 0, rejected = 0;
    chartPayments.forEach((p: any) => {
      const s = p.verification_status || 'auto_approved';
      if (s === 'auto_approved' || s === 'approved') approved++;
      else if (s === 'pending') pending++;
      else if (s === 'rejected') rejected++;
    });
    const total = chartPayments.length;
    return { rate: Math.round((approved / total) * 100), approved, total, pending, rejected };
  }, [chartPayments]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const handleViewLedger = (payment: any) => {
    if (payment.rentals?.id) {
      router.push(`/rentals/${payment.rentals.id}#ledger`);
    } else if (payment.customers?.id) {
      router.push(`/customers/${payment.customers.id}?tab=payments`);
    }
  };

  const handleExportCSV = async () => {
    try {
      await exportPaymentsCSV(filters);
      toast({
        title: "Export Complete",
        description: "Payments data has been exported to CSV",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export data. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleApprovePayment = (paymentId: string) => {
    approvePayment.mutate(paymentId);
  };

  const handleOpenRejectDialog = (paymentId: string) => {
    setRejectPaymentId(paymentId);
    setRejectReason('');
    setShowRejectDialog(true);
  };

  const handleRejectPayment = () => {
    if (!rejectPaymentId || !rejectReason.trim()) return;
    rejectPayment.mutate(
      { paymentId: rejectPaymentId, reason: rejectReason.trim() },
      {
        onSuccess: () => {
          setShowRejectDialog(false);
          setRejectPaymentId(null);
          setRejectReason('');
        }
      }
    );
  };

  // Reverse payment handlers
  const handleOpenReverseDialog = (payment: any) => {
    // Only allow reversing manual payments (no Stripe)
    if (payment.stripe_payment_intent_id) {
      toast({
        title: "Cannot Reverse",
        description: "Stripe payments cannot be reversed. Use refund instead.",
        variant: "destructive",
      });
      return;
    }

    // Check if already reversed
    if (payment.status === 'Reversed' || payment.refund_reason?.includes('[REVERSED]')) {
      toast({
        title: "Already Reversed",
        description: "This payment has already been reversed.",
        variant: "destructive",
      });
      return;
    }

    setReversePaymentId(payment.id);
    setReversePaymentDetails({
      amount: payment.amount,
      customerName: payment.customers?.name || 'Unknown Customer'
    });
    setReverseReason('');
    setShowReverseDialog(true);
  };

  const handleReversePayment = async () => {
    if (!reversePaymentId || !reverseReason.trim()) return;

    setIsReversing(true);
    try {
      const { data, error } = await supabase.functions.invoke('reverse-payment', {
        body: {
          paymentId: reversePaymentId,
          reason: reverseReason.trim(),
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to reverse payment');

      toast({
        title: "Payment Reversed",
        description: `Payment of ${formatCurrency(reversePaymentDetails?.amount || 0, tenant?.currency_code || 'USD')} has been reversed. ${data.details?.applicationsReversed || 0} allocations were undone.`,
      });

      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: ['payments-data'] });
      queryClient.invalidateQueries({ queryKey: ['payment-summary'] });
      queryClient.invalidateQueries({ queryKey: ['payments-chart-data'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
      queryClient.invalidateQueries({ queryKey: ['rental-payments'] });
      queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
      queryClient.invalidateQueries({ queryKey: ['customer-balance'] });

      setShowReverseDialog(false);
      setReversePaymentId(null);
      setReversePaymentDetails(null);
      setReverseReason('');
    } catch (error: any) {
      console.error('Reverse payment error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to reverse payment",
        variant: "destructive",
      });
    } finally {
      setIsReversing(false);
    }
  };

  // Check if a payment can be reversed (only manual payments can be reversed)
  const canReversePayment = (payment: any) => {
    // Must be a manual payment (no Stripe payment intent)
    // Stripe payments have stripe_payment_intent_id and are "auto_approved"
    if (payment.stripe_payment_intent_id) {
      return false;
    }
    // Must not be already reversed
    if (payment.status === 'Reversed') {
      return false;
    }
    if (payment.refund_reason?.includes('[REVERSED]')) {
      return false;
    }
    // Must not be refunded
    if (payment.refund_status === 'completed' || payment.refund_status === 'processing') {
      return false;
    }
    // Must not be a rejected payment
    if (payment.verification_status === 'rejected') {
      return false;
    }
    return true;
  };

  const payments = paymentsData?.payments || [];
  const totalCount = paymentsData?.totalCount || 0;
  const totalPages = paymentsData?.totalPages || 1;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Payments</h1>
          <p className="text-muted-foreground">
            Record customer payments — automatically allocated to outstanding charges using FIFO
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={handleExportCSV} className="w-full sm:w-auto whitespace-nowrap">
            <Download className="h-4 w-4 mr-2 flex-shrink-0" />
            Export CSV
          </Button>
          <AddPaymentDialog
            open={showAddDialog}
            onOpenChange={setShowAddDialog}
          />
          {canEdit('payments') && (
            <Button onClick={() => setShowAddDialog(true)} className="bg-gradient-primary w-full sm:w-auto whitespace-nowrap">
              <Plus className="h-4 w-4 mr-2 flex-shrink-0" />
              Record Payment
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <PaymentSummaryCards />

      {/* Charts */}
      {chartPayments && chartPayments.length > 0 && (
        <TooltipProvider>
          <div className="space-y-4">
            {/* Hero: Daily Payment Collection Area Chart */}
            <div className="rounded-lg border border-border/60 bg-card/50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Daily Payment Collection</h3>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Total payment amounts collected per day this month</TooltipContent>
                </Tooltip>
              </div>
              <ChartContainer config={areaChartConfig} className="h-[220px] w-full">
                <BarChart data={dailyTrendData} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval={Math.max(0, Math.floor(dailyTrendData.length / 10))}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatCurrency(v, tenant?.currency_code || 'USD')}
                    width={70}
                  />
                  <ChartTooltip
                    cursor={{ fill: "hsl(var(--muted-foreground))", opacity: 0.08 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                          <p className="text-xs text-muted-foreground mb-0.5">{d.date}</p>
                          <p className="text-sm font-semibold">{formatCurrency(d.amount, tenant?.currency_code || 'USD')}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="amount" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Row: 3 supporting charts */}
            <div className="grid gap-4 md:grid-cols-3">
              {/* Payment Methods Donut */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Payment Methods</h3>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>Distribution of payment methods this month</TooltipContent>
                  </Tooltip>
                </div>
                <ChartContainer config={methodChartConfig} className="h-[200px] w-full">
                  <PieChart>
                    <Pie
                      data={methodDonutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      dataKey="value"
                      nameKey="name"
                      strokeWidth={2}
                      stroke="hsl(var(--background))"
                    >
                      {methodDonutData.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={METHOD_COLORS[entry.name] || METHOD_COLORS.Other}
                        />
                      ))}
                    </Pie>
                    <ChartTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
                            <div className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: METHOD_COLORS[d.name] || METHOD_COLORS.Other }} />
                              <span className="text-sm font-medium">{d.name}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{d.value} payment{d.value !== 1 ? 's' : ''}</p>
                          </div>
                        );
                      }}
                    />
                    <text x="50%" y="46%" textAnchor="middle" className="fill-foreground text-xl font-bold">
                      {chartPayments.length}
                    </text>
                    <text x="50%" y="58%" textAnchor="middle" className="fill-muted-foreground text-[11px]">
                      Total
                    </text>
                  </PieChart>
                </ChartContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
                  {methodDonutData.map((d) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: METHOD_COLORS[d.name] || METHOD_COLORS.Other }} />
                      {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment Amount Distribution */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Amount Distribution</h3>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>Number of payments by amount range this month</TooltipContent>
                  </Tooltip>
                </div>
                <ChartContainer config={amountDistConfig} className="h-[200px] w-full">
                  <BarChart data={amountDistData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
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
                            <p className="text-sm font-semibold">{d.count} payment{d.count !== 1 ? 's' : ''}</p>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} />
                  </BarChart>
                </ChartContainer>
              </div>

              {/* Approval Rate Radial */}
              <div className="rounded-lg border border-border/60 bg-card/50 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-medium text-muted-foreground">Approval Rate</h3>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>Percentage of payments approved this month</TooltipContent>
                  </Tooltip>
                </div>
                <ChartContainer config={verificationChartConfig} className="h-[200px] w-full">
                  <RadialBarChart
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={85}
                    startAngle={90}
                    endAngle={-270}
                    data={[{ name: "Approved", value: approvalRadialData.rate }]}
                    barSize={14}
                  >
                    <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                    <RadialBar
                      dataKey="value"
                      cornerRadius={8}
                      fill="#22c55e"
                      background={{ fill: "hsl(var(--muted))" }}
                      angleAxisId={0}
                    />
                    <text x="50%" y="44%" textAnchor="middle" className="fill-foreground text-2xl font-bold">
                      {approvalRadialData.rate}%
                    </text>
                    <text x="50%" y="56%" textAnchor="middle" className="fill-muted-foreground text-[11px]">
                      Approved
                    </text>
                  </RadialBarChart>
                </ChartContainer>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    Approved ({approvalRadialData.approved})
                  </div>
                  {approvalRadialData.pending > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      Pending ({approvalRadialData.pending})
                    </div>
                  )}
                  {approvalRadialData.rejected > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Rejected ({approvalRadialData.rejected})
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </TooltipProvider>
      )}

      {/* Filters */}
      <PaymentFilters onFiltersChange={(newFilters) => {
        setFilters(newFilters);
        setPage(1);
      }} />

      {/* Payments Table */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-pulse flex space-x-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4"></div>
                <div className="h-4 bg-muted rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      ) : payments && payments.length > 0 ? (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('payment_date')}
                      >
                        Date {sortBy === 'payment_date' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('customer')}
                      >
                        Customer {sortBy === 'customer' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Rental</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead
                        className="text-left cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('amount')}
                      >
                        Amount {sortBy === 'amount' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => {
                      return (
                        <TableRow key={payment.id} className="hover:bg-muted/50">
                          <TableCell className="font-medium">
                            {formatInTimeZone(new Date(payment.payment_date), 'Europe/London', 'dd/MM/yyyy')}
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={() => router.push(`/customers/${payment.customers.id}`)}
                              className="text-foreground hover:underline hover:opacity-80 font-medium"
                            >
                              {payment.customers.name}
                            </button>
                          </TableCell>
                          <TableCell>
                            {payment.vehicles ? (
                              <button
                                onClick={() => router.push(`/vehicles/${payment.vehicles!.id}`)}
                                className="text-foreground hover:underline hover:opacity-80 font-medium"
                              >
                                {payment.vehicles.reg}
                                {payment.vehicles.make && payment.vehicles.model &&
                                  <span className="text-muted-foreground"> • {payment.vehicles.make} {payment.vehicles.model}</span>
                                }
                              </button>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                           <TableCell>
                             {payment.rentals ? (
                               <Badge variant="outline" className="text-xs cursor-pointer"
                                 onClick={() => router.push(`/rentals/${payment.rentals!.id}`)}>
                                 {payment.rentals.rental_number || `R-${payment.rentals.id.slice(0, 6)}`}
                               </Badge>
                             ) : (
                               <span className="text-muted-foreground text-xs">No Rental</span>
                             )}
                           </TableCell>
                           <TableCell>
                             <Badge
                               variant={payment.payment_type === 'InitialFee' ? 'default' : 'secondary'}
                               className={payment.payment_type === 'InitialFee' ? 'bg-purple-600 hover:bg-purple-700' : ''}
                             >
                               {getPaymentTypeDisplay(payment.payment_type)}
                             </Badge>
                           </TableCell>
                           <TableCell>{payment.method ? payment.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-'}</TableCell>
                          <TableCell className="text-left font-medium">
                            <div>
                              {formatCurrency(payment.amount, tenant?.currency_code || 'USD')}
                              {(() => {
                                const rental = payment.rentals;
                                const vehicle = payment.vehicles;
                                if (!rental || !vehicle || !rental.start_date || !rental.end_date) return null;

                                const periodType = (rental.rental_period_type || 'monthly').toLowerCase();
                                let unitRate = 0;
                                let unitLabel = 'month';
                                if (periodType === 'daily' && vehicle.daily_rent) {
                                  unitRate = vehicle.daily_rent;
                                  unitLabel = 'day';
                                } else if (periodType === 'weekly' && vehicle.weekly_rent) {
                                  unitRate = vehicle.weekly_rent;
                                  unitLabel = 'week';
                                } else if (periodType === 'monthly' && vehicle.monthly_rent) {
                                  unitRate = vehicle.monthly_rent;
                                  unitLabel = 'month';
                                }
                                if (!unitRate) return null;

                                const totalDays = Math.max(1, Math.ceil((new Date(rental.end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
                                let units = 1;
                                if (unitLabel === 'day') units = totalDays;
                                else if (unitLabel === 'week') units = Math.ceil(totalDays / 7);
                                else units = Math.max(1, Math.round(totalDays / 30));

                                const cc = tenant?.currency_code || 'USD';
                                return (
                                  <p className="text-xs text-muted-foreground font-normal">
                                    {formatCurrency(unitRate, cc)}/{unitLabel} × {units}
                                  </p>
                                );
                              })()}
                            </div>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              // Check if payment is reversed first
                              if (payment.status === 'Reversed' || payment.refund_reason?.includes('[REVERSED]')) {
                                return (
                                  <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                                    <Undo2 className="h-3 w-3 mr-1" />
                                    Reversed
                                  </Badge>
                                );
                              }

                              const verificationStatus = payment.verification_status || 'auto_approved';
                              const statusInfo = getVerificationStatusInfo(verificationStatus);
                              return (
                                <Badge className={statusInfo.className}>
                                  {verificationStatus === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                                  {verificationStatus === 'approved' && <CheckCircle className="h-3 w-3 mr-1" />}
                                  {verificationStatus === 'rejected' && <XCircle className="h-3 w-3 mr-1" />}
                                  {statusInfo.label}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {/* Show Accept/Reject buttons for pending payments */}
                              {payment.verification_status === 'pending' && (
                                <>
                                  {canEdit('payments') && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                            onClick={() => handleApprovePayment(payment.id)}
                                            disabled={isVerifying}
                                          >
                                            <CheckCircle className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Approve Payment</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {canEdit('payments') && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                            onClick={() => handleOpenRejectDialog(payment.id)}
                                            disabled={isVerifying}
                                          >
                                            <XCircle className="h-4 w-4" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Reject Payment</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleViewLedger(payment)}>
                                    <FileText className="h-4 w-4 mr-2" />
                                    View Ledger
                                  </DropdownMenuItem>
                                  {/* Show Reverse Payment for non-reversed, non-refunded payments without Stripe intent */}
                                  {canEdit('payments') &&
                                   !payment.stripe_payment_intent_id &&
                                   payment.status !== 'Reversed' &&
                                   !payment.refund_reason?.includes('[REVERSED]') &&
                                   payment.refund_status !== 'completed' &&
                                   payment.refund_status !== 'processing' &&
                                   payment.verification_status !== 'rejected' && (
                                    <DropdownMenuItem
                                      onClick={() => handleOpenReverseDialog(payment)}
                                      className="text-orange-600 focus:text-orange-600"
                                    >
                                      <Undo2 className="h-4 w-4 mr-2" />
                                      Reverse Payment
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
            </CardContent>
          </Card>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Showing {((page - 1) * pageSize) + 1}-{Math.min(page * pageSize, totalCount)} of {totalCount} payments
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-center sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Page {page} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages || totalPages <= 1}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12">
          <CreditCard className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No payments found</h3>
          <p className="text-muted-foreground mb-4">
            {Object.values(filters).some(f => f && f !== 'all' && f !== 'thisMonth') ?
              "No payments match your current filters" :
              "Start recording payments to track your cash flow"
            }
          </p>
          {canEdit('payments') && (
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          )}
        </div>
      )}

      {/* Reject Payment Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" />
              Reject Payment
            </DialogTitle>
            <DialogDescription>
              This will reject the payment and mark the associated rental as rejected. The customer will be notified via email.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="reject-reason">Reason for Rejection <span className="text-red-500">*</span></Label>
              <Textarea
                id="reject-reason"
                placeholder="Please provide a reason for rejecting this payment..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectPayment}
              disabled={!rejectReason.trim() || isVerifying}
            >
              {isVerifying ? 'Rejecting...' : 'Reject Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reverse Payment Dialog */}
      <Dialog open={showReverseDialog} onOpenChange={setShowReverseDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <AlertTriangle className="h-5 w-5" />
              Reverse Payment
            </DialogTitle>
            <DialogDescription>
              This will reverse the payment of <span className="font-semibold">{formatCurrency(reversePaymentDetails?.amount || 0, tenant?.currency_code || 'USD')}</span> for{' '}
              <span className="font-semibold">{reversePaymentDetails?.customerName}</span>.
              All charge allocations will be undone and the charges will return to outstanding status.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 p-3">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-orange-800 dark:text-orange-200">
                  <p className="font-medium">This action cannot be undone.</p>
                  <p className="mt-1">The payment will be marked as reversed and all allocations to charges will be removed.</p>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reverse-reason">Reason for Reversal <span className="text-red-500">*</span></Label>
              <Textarea
                id="reverse-reason"
                placeholder="e.g., Payment entered in error, duplicate payment, customer dispute..."
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReverseDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-orange-600 hover:bg-orange-700"
              onClick={handleReversePayment}
              disabled={!reverseReason.trim() || isReversing}
            >
              {isReversing ? (
                <>
                  <Undo2 className="h-4 w-4 mr-2 animate-spin" />
                  Reversing...
                </>
              ) : (
                <>
                  <Undo2 className="h-4 w-4 mr-2" />
                  Reverse Payment
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PaymentsList;
