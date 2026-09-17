"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  DropdownMenu as DropdownMenuV2,
  DropdownMenuContent as DropdownMenuContentV2,
  DropdownMenuItem as DropdownMenuItemV2,
  DropdownMenuTrigger as DropdownMenuTriggerV2,
} from "@/components/ui-v2/dropdown-menu";
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
  BarChart3,
  Link2Off,
} from "lucide-react";
import Link from "next/link";
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
import { useVoidPaymentLink } from "@/hooks/use-void-payment-link";
import { useOrgSettings } from "@/hooks/use-org-settings";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useIsLean } from "@/lib/lean-context";
import { PaymentsTeachingEmptyState } from "@/components/empty-states/lean-empty-states";
import { useForcedEmptyState } from "@/hooks/use-forced-empty-state";
import { formatCurrency } from "@/lib/format-utils";
import { parseLocalDate } from "@/lib/date-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { TabTourButton } from "@/components/onboarding/tab-tour-button";
import { HEADER_ACTIONS_V2, HEADER_PRIMARY_V2, HeaderIconButton } from "@/components/shared/header-icon-button-v2";
import {
  LIST_CLASSES,
  LIST_ROW_ACTION,
  ListBody,
  ListCell,
  ListFooter,
  ListHead,
  ListMetaChip,
  ListRow,
  ListStatusText,
  ListTable,
  ListTableHeader,
  useProgressiveRows,
  type ListTone,
} from "@/components/shared/list-table-v2";
import { useV2 } from "@/lib/v2-context";

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

// v2 only: the Status column's hue, by meaning. Labels still come from
// `getVerificationStatusInfo`, exactly as the v1 badge reads them.
const PAYMENT_VERIFICATION_TONE_V2: Record<string, ListTone> = {
  pending: 'warning',
  approved: 'success',
  auto_approved: 'success',
  rejected: 'danger',
};


const PaymentsList = () => {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { tenant, tenantSlug } = useTenant();
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

  // Void payment-link state — remove a duplicate/stale UNPAID pay-link without
  // touching the rental (the safe alternative to "Reject", which closes the rental).
  const [voidTarget, setVoidTarget] = useState<{ id: string; customerName: string; amount: number } | null>(null);

  // Get settings and verification actions
  const { settings } = useOrgSettings();
  const { approvePayment, rejectPayment, isLoading: isVerifying } = usePaymentVerificationActions();
  const voidLink = useVoidPaymentLink();

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

  // v2 chrome (canary tenants only; fails closed to v1). On v2 there is no
  // pager: the table grows as it scrolls, like the rentals list.
  const v2Chrome = useV2("chrome");

  // v2 lists newest ADDED first (`created_at` desc) and has no control to
  // change it, so a backdated payment entered today sits at the top. v1 keeps
  // its payment-date order and its sortable headers.
  const listSortBy = v2Chrome ? 'created_at' : sortBy;
  const listSortOrder: 'asc' | 'desc' = v2Chrome ? 'desc' : sortOrder;

  const { data: paymentsData, isLoading } = usePaymentsData({
    filters,
    sortBy: listSortBy,
    sortOrder: listSortOrder,
    page,
    pageSize
    // v2: page 1 of up to 1,000 rows (PostgREST's per-request maximum), grown
    // on screen by `useProgressiveRows`. Same hook, so the "payments-data" key
    // prefix every invalidation uses still matches; v1's arguments are untouched.
    // `innerJoinSearch` makes a customer search narrow on the SERVER, so a match
    // past row 1,000 still loads and `totalCount` counts matches (see the footer).
    , ...(v2Chrome ? { page: 1, pageSize: 1000, innerJoinSearch: true } : {})
  });

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

  // Approve/Reject only apply to a genuinely pending (not-yet-reversed/voided) payment.
  const isPendingActionable = (p: any) =>
    p.verification_status === 'pending' &&
    p.status !== 'Reversed' &&
    p.capture_status !== 'cancelled';

  // A payments row that is an UNPAID checkout LINK (Turo-style pay-link) — safe to remove
  // without touching the rental. The void-payment-link edge function enforces this
  // fail-closed (refuses anything carrying money), so this UI gate is just for surfacing.
  const isVoidableLink = (p: any) =>
    isPendingActionable(p) &&
    !!p.stripe_checkout_session_id &&
    !p.stripe_payment_intent_id &&
    !p.paid_at &&
    p.capture_status !== 'captured' &&
    // Mirror the server's isCaptured() status clause so the UI never offers Void where
    // the edge function would refuse it as already paid/captured.
    !(['Applied', 'Completed', 'Partial'].includes(p.status) && p.capture_status !== 'requires_capture') &&
    p.payment_type !== 'InitialFee';

  const handleVoidLink = async () => {
    if (!voidTarget) return;
    try {
      await voidLink.mutateAsync({
        paymentId: voidTarget.id,
        reason: 'Duplicate/stale payment link removed from Payments tab',
      });
      queryClient.invalidateQueries({ queryKey: ['payments-data'] });
      queryClient.invalidateQueries({ queryKey: ['payment-summary'] });
      queryClient.invalidateQueries({ queryKey: ['payments-chart-data'] });
      toast({ title: 'Payment link removed', description: 'The duplicate link was cancelled — the rental is unaffected.' });
    } catch (e: any) {
      toast({ title: 'Could not remove link', description: e?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setVoidTarget(null);
    }
  };

  const handleExportCSV = async () => {
    try {
      if (!tenant?.id) throw new Error("No tenant context available");
      await exportPaymentsCSV(filters, tenant.id);
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

  /**
   * v2 (northwind) has no pager: the table grows 25 rows at a time as it is
   * scrolled, like the rentals list. On v2 the hook above fetched page 1 with
   * up to 1,000 rows, so this is a bigger slice of `payments` and no new query.
   * The fill resets only when the result set changes: tenant, any filter, or
   * the sort. Nothing here moves on a background refetch.
   */
  const paymentRows = useProgressiveRows(
    payments,
    `${tenant?.id}|${filters.customerSearch}|${filters.vehicleSearch}|${filters.method}|${filters.verificationStatus}|${filters.dateFrom?.toISOString()}|${filters.dateTo?.toISOString()}|${filters.quickFilter}|${listSortBy}|${listSortOrder}`,
  );

  // v2 only: the Status column as one line of coloured text. The conditions
  // and labels are the v1 badge's, verbatim, so both paths name a row alike.
  const paymentStatusV2 = (payment: (typeof payments)[number]): { label: string; tone: ListTone } => {
    if (payment.status === 'Reversed' || payment.refund_reason?.includes('[REVERSED]')) {
      const isVoidedLink = payment.refund_reason?.includes('[VOIDED]');
      return { label: isVoidedLink ? 'Voided' : 'Reversed', tone: 'danger' };
    }
    const verificationStatus = payment.verification_status || 'auto_approved';
    const statusInfo = getVerificationStatusInfo(verificationStatus);
    return {
      label: statusInfo.label,
      tone: PAYMENT_VERIFICATION_TONE_V2[String(verificationStatus).toLowerCase()] ?? 'muted',
    };
  };

  // v2 only: the v1 rate line under Amount, as the same text on one line.
  // The arithmetic is v1's, unchanged (including its discount branch).
  const paymentRateV2 = (payment: (typeof payments)[number]): string | null => {
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

    const totalDays = Math.max(1, Math.ceil((parseLocalDate(rental.end_date).getTime() - parseLocalDate(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    let units = 1;
    if (unitLabel === 'day') units = totalDays;
    else if (unitLabel === 'week') units = Math.ceil(totalDays / 7);
    else units = Math.max(1, Math.round(totalDays / (tenant?.monthly_tier_days ?? 30)));

    const cc = tenant?.currency_code || 'USD';
    const disc = Number((rental as any).discount_applied) || 0;
    const shownRate = disc > 0
      ? Math.max(0, ((Number(rental.monthly_amount) || 0) - disc) / units)
      : unitRate;
    return `${formatCurrency(shownRate, cc)}/${unitLabel} × ${units}${disc > 0 ? ` (after ${formatCurrency(disc, cc)} discount)` : ''}`;
  };

  // `totalCount` above is the count for the CURRENT filters, and the page opens
  // with a date range already applied — so it reads zero for an operator whose
  // last payment was last month. That is not someone who needs teaching, so the
  // teaching state needs its own unfiltered count.
  //
  // `enabled` pins it to the canary: the other 56 tenants never issue this
  // query at all, so the shared page costs them nothing. `head: true` fetches
  // no rows, and `.eq('tenant_id')` is applied before anything else because RLS
  // is off on `payments` (V2_PLAN §5).
  const teachEligible = useIsLean();
  const { data: lifetimePayments } = useQuery({
    queryKey: ["payments-lifetime-count", tenant?.id],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
      return (count as number | null) ?? 0;
    },
    enabled: teachEligible && !!tenant?.id,
    staleTime: 60_000,
  });

  // Undefined while the count is still in flight — never teach on a guess.
  //
  // `devForceEmpty` is the /dev preview switch (lib/dev-overrides.ts): inert
  // outside development, and INSIDE the slug gate (`teachEligible`) so it
  // reaches nobody else.
  const devForceEmpty = useForcedEmptyState("payments");
  const teachEmptyPayments = teachEligible && (lifetimePayments === 0 || devForceEmpty);

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0" data-tour="payments-overview">
          <h1 className="text-2xl sm:text-3xl font-bold">Payments</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Record and manage customer payments
          </p>
        </div>
        {/* v2: every control here is 32px and the cluster sits on the subtitle
            line (HEADER_ACTIONS_V2 / HEADER_PRIMARY_V2, team lead Sep 16 2026).
            v1 keeps "flex items-center gap-2" and its outline icon Buttons
            byte for byte. */}
        <div className={`flex items-center gap-2${v2Chrome ? ` ${HEADER_ACTIONS_V2}` : ""}`}>
          {/* Canary-only: self-gates on the resolved tenant slug, so this
              shared v1 header is unchanged for the other 56 tenants. */}
          <TabTourButton tour="payments" size="h-10" />
          {v2Chrome ? (
            <>
              <HeaderIconButton label="Payment analytics" href="/payments/analytics" data-tour="payments-analytics">
                <BarChart3 className="h-4 w-4" />
              </HeaderIconButton>
              <HeaderIconButton label="Export CSV" onClick={handleExportCSV} data-tour="payments-export">
                <Download className="h-4 w-4" />
              </HeaderIconButton>
            </>
          ) : (
            <>
              <Link href="/payments/analytics" className="shrink-0">
                <Button variant="outline" size="icon" data-tour="payments-analytics" className="border-primary/20 hover:border-primary/40 hover:bg-primary/5">
                  <BarChart3 className="h-4 w-4" />
                </Button>
              </Link>
              <Button variant="outline" size="icon" data-tour="payments-export" onClick={handleExportCSV} className="shrink-0">
                <Download className="h-4 w-4" />
              </Button>
            </>
          )}
          <AddPaymentDialog
            open={showAddDialog}
            onOpenChange={setShowAddDialog}
          />
          {canEdit('payments') && (
            <Button onClick={() => setShowAddDialog(true)} data-tour="payments-record" className={`bg-gradient-primary flex-1 sm:flex-none${v2Chrome ? ` ${HEADER_PRIMARY_V2}` : ""}`}>
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <PaymentSummaryCards />

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
      ) : payments && payments.length > 0 && !teachEmptyPayments ? (
        <>
        {v2Chrome ? (
          <>
            {/* v2: the rentals list's table (components/shared/list-table-v2).
                No pager: rows arrive 25 at a time as the table scrolls. The row
                opens the ledger this payment posted to, the same destination as
                the menu's View Ledger, which stays in the menu. Every cell with
                a control stops its click so the control never opens the row. */}
            <ListTable rows={paymentRows} minWidth="min-w-[880px]">
              {/* Widths, measured in the portal's Manrope at a 944px card: every
                  value that must read whole fits on one line (the "CUSTOMER
                  PAYMENT" chip 116.7px, "Paid Out Of Band" 109.6, "Pending
                  Review" 103.2, the rate "$1,200.00/month × 3" 106.9, the date
                  80.7, three row buttons 96), and so does every column label.
                  Nine columns like that need 994px at the kit's 12px cell
                  padding, more than the card has, so this table's cells and
                  labels take 8px (`px-2`). Customer, Vehicle and Rental truncate
                  and keep their full value in `title`. Headings do not sort:
                  rows are newest added first. */}
              <ListTableHeader>
                <ListHead className="w-[10.4%] px-2">Date</ListHead>
                <ListHead className="w-[11.3%] px-2">Customer</ListHead>
                <ListHead className="w-[7%] px-2">Vehicle</ListHead>
                <ListHead className="w-[6.45%] px-2">Rental</ListHead>
                <ListHead className="w-[14.2%] px-2" data-tour="payments-type-column">Type</ListHead>
                <ListHead className="w-[13.5%] px-2">Method</ListHead>
                <ListHead className="w-[13.2%] px-2">Amount</ListHead>
                <ListHead className="w-[12.85%] px-2">Status</ListHead>
                {/* Stays the last column: the tour's actions step stands to its left. */}
                <ListHead className="w-[11.1%] text-right" data-tour="payments-actions-column">
                  <span className="sr-only">Actions</span>
                </ListHead>
              </ListTableHeader>
              <ListBody>
                {paymentRows.visible.map((payment) => {
                  const statusV2 = paymentStatusV2(payment);
                  const rateV2 = paymentRateV2(payment);
                  const amountV2 = formatCurrency(payment.amount, tenant?.currency_code || 'USD');
                  const typeV2 = getPaymentTypeDisplay(payment.payment_type);
                  const methodV2 = payment.method ? payment.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null;
                  return (
                    <ListRow
                      key={payment.id}
                      data-tour="payment-row"
                      onOpen={() => handleViewLedger(payment)}
                    >
                      <ListCell className="px-2 tabular-nums">
                        <span className={LIST_CLASSES.text}>
                          {formatInTimeZone(parseLocalDate(payment.payment_date), 'America/New_York', 'MM/dd/yyyy')}
                        </span>
                      </ListCell>
                      <ListCell className="px-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => router.push(`/customers/${payment.customers.id}`)}
                          className={`${LIST_CLASSES.text} mx-auto block max-w-full truncate text-center hover:underline`}
                          title={payment.customers.name}
                        >
                          {payment.customers.name}
                        </button>
                      </ListCell>
                      <ListCell className="px-2" onClick={payment.vehicles ? (e) => e.stopPropagation() : undefined}>
                        {payment.vehicles ? (
                          <button
                            type="button"
                            onClick={() => router.push(`/vehicles/${payment.vehicles!.id}`)}
                            className={`${LIST_CLASSES.text} mx-auto block max-w-full truncate text-center hover:underline`}
                            title={payment.vehicles.make && payment.vehicles.model ? `${payment.vehicles.reg} • ${payment.vehicles.make} ${payment.vehicles.model}` : payment.vehicles.reg}
                          >
                            {payment.vehicles.reg}
                            {payment.vehicles.make && payment.vehicles.model && (
                              <span className="font-normal text-muted-foreground"> • {payment.vehicles.make} {payment.vehicles.model}</span>
                            )}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </ListCell>
                      <ListCell className="px-2 tabular-nums" onClick={payment.rentals ? (e) => e.stopPropagation() : undefined}>
                        {payment.rentals ? (
                          <button
                            type="button"
                            onClick={() => router.push(`/rentals/${payment.rentals!.id}`)}
                            className={`${LIST_CLASSES.text} mx-auto block max-w-full truncate text-center hover:underline`}
                            title={payment.rentals.rental_number || `R-${payment.rentals.id.slice(0, 6)}`}
                          >
                            {payment.rentals.rental_number || `R-${payment.rentals.id.slice(0, 6)}`}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </ListCell>
                      <ListCell className="px-2">
                        <div className="truncate" title={typeV2}>
                          <ListMetaChip>{typeV2}</ListMetaChip>
                        </div>
                      </ListCell>
                      <ListCell className="px-2">
                        {methodV2 ? (
                          <span className={`block truncate ${LIST_CLASSES.text}`} title={methodV2}>{methodV2}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </ListCell>
                      {/* The amount carries the row. v1's rate line sits UNDER it
                          as a muted second line, the way rentals stacks a flag
                          under its identifier: the rate is a figure the operator
                          reads, and the tour's note calls it "under the amount".
                          It wraps rather than truncates, so a discount suffix is
                          never cut off. */}
                      <ListCell className="px-2 tabular-nums">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`block max-w-full truncate ${LIST_CLASSES.identifier}`} title={amountV2}>{amountV2}</span>
                          {rateV2 && (
                            <span data-tour="payments-rate" className="block whitespace-normal break-words text-[11px] font-normal text-muted-foreground tabular-nums">
                              {rateV2}
                            </span>
                          )}
                        </div>
                      </ListCell>
                      <ListCell className="px-2">
                        <span className="block truncate" title={statusV2.label}>
                          <ListStatusText tone={statusV2.tone}>{statusV2.label}</ListStatusText>
                        </span>
                      </ListCell>
                      {/* Approve, reject and the menu must not open the ledger:
                          clicks on them and on the menu's items (portalled, but
                          still React children of this cell) stop here. */}
                      <ListCell className="px-1 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end">
                          {/* Show Accept/Reject buttons for pending payments (hidden once voided/reversed) */}
                          {isPendingActionable(payment) && (
                            <>
                              {canEdit('payments') && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="-my-1.5 h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                                        onClick={() => handleApprovePayment(payment.id)}
                                        disabled={isVerifying}
                                        aria-label="Approve Payment"
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
                                        size="icon"
                                        className="-my-1.5 h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => handleOpenRejectDialog(payment.id)}
                                        disabled={isVerifying}
                                        aria-label="Reject Payment"
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
                          {/* The ui-v2 menu, as on the other v2 lists: `w-auto`
                              lets a label keep one line in the trigger-wide
                              content, and its items already space the icon. */}
                          <DropdownMenuV2>
                            <DropdownMenuTriggerV2 asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                data-tour="payments-row-actions"
                                className={LIST_ROW_ACTION}
                                aria-label={`Actions for payment from ${payment.customers.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTriggerV2>
                            <DropdownMenuContentV2 align="end" className="w-auto">
                              <DropdownMenuItemV2 onClick={() => handleViewLedger(payment)}>
                                <FileText className="h-4 w-4" />
                                View Ledger
                              </DropdownMenuItemV2>
                              {/* Remove a duplicate/stale UNPAID pay-link — safe, never touches the rental */}
                              {canEdit('payments') && isVoidableLink(payment) && (
                                <DropdownMenuItemV2
                                  onClick={() => setVoidTarget({ id: payment.id, customerName: payment.customers?.name || 'the customer', amount: payment.amount })}
                                  className="text-red-600 focus:text-red-600"
                                >
                                  <Link2Off className="h-4 w-4" />
                                  Remove payment link
                                </DropdownMenuItemV2>
                              )}
                              {/* Same Reverse gate as v1: never for an unpaid pay-link, which must be
                                  removed via "Remove payment link" so its Stripe session expires. */}
                              {canEdit('payments') &&
                               !isVoidableLink(payment) &&
                               !payment.stripe_payment_intent_id &&
                               payment.status !== 'Reversed' &&
                               !payment.refund_reason?.includes('[REVERSED]') &&
                               payment.refund_status !== 'completed' &&
                               payment.refund_status !== 'processing' &&
                               payment.verification_status !== 'rejected' && (
                                <DropdownMenuItemV2
                                  onClick={() => handleOpenReverseDialog(payment)}
                                  className="text-orange-600 focus:text-orange-600"
                                >
                                  <Undo2 className="h-4 w-4" />
                                  Reverse Payment
                                </DropdownMenuItemV2>
                              )}
                            </DropdownMenuContentV2>
                          </DropdownMenuV2>
                        </div>
                      </ListCell>
                    </ListRow>
                  );
                })}
              </ListBody>
            </ListTable>
            {/* `serverTotal`: how big the set is on the server, whenever the
                rows loaded are not all of it. With a customer search the hook
                narrows on the server (`innerJoinSearch`), so `totalCount` is
                the matches: pass it whenever it exceeds the rows loaded.
                Without one, the count also includes any row the hook drops
                after the fetch (a payment whose customer did not embed), so
                pass it only when the 1,000-row fetch was actually capped, or a
                complete list would read as truncated. */}
            <ListFooter
              rows={paymentRows}
              one="payment"
              many="payments"
              serverTotal={
                filters.customerSearch
                  ? (totalCount > payments.length ? totalCount : undefined)
                  : (totalCount > 1000 ? totalCount : undefined)
              }
            />
          </>
        ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative">
              <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
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
                      <TableHead data-tour="payments-type-column">Type</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead
                        className="text-left cursor-pointer hover:bg-muted/50"
                        onClick={() => handleSort('amount')}
                      >
                        Amount {sortBy === 'amount' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead data-tour="payments-actions-column">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => {
                      return (
                        <TableRow key={payment.id} data-tour="payment-row" className="hover:bg-muted/50">
                          <TableCell className="font-medium">
                            {formatInTimeZone(parseLocalDate(payment.payment_date), 'America/New_York', 'MM/dd/yyyy')}
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

                                const totalDays = Math.max(1, Math.ceil((parseLocalDate(rental.end_date).getTime() - parseLocalDate(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
                                let units = 1;
                                if (unitLabel === 'day') units = totalDays;
                                else if (unitLabel === 'week') units = Math.ceil(totalDays / 7);
                                else units = Math.max(1, Math.round(totalDays / (tenant?.monthly_tier_days ?? 30)));

                                const cc = tenant?.currency_code || 'USD';
                                // With a discount the vehicle's list rate is not what this
                                // customer pays, so quote the agreed per-period figure.
                                const disc = Number((rental as any).discount_applied) || 0;
                                const shownRate = disc > 0
                                  ? Math.max(0, ((Number(rental.monthly_amount) || 0) - disc) / units)
                                  : unitRate;
                                return (
                                  <p data-tour="payments-rate" className="text-xs text-muted-foreground font-normal">
                                    {formatCurrency(shownRate, cc)}/{unitLabel} × {units}
                                    {disc > 0 ? ` (after ${formatCurrency(disc, cc)} discount)` : ''}
                                  </p>
                                );
                              })()}
                            </div>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              // Check if payment is reversed/voided first
                              if (payment.status === 'Reversed' || payment.refund_reason?.includes('[REVERSED]')) {
                                // A voided unpaid pay-link reads "Voided" (matching the rental/customer
                                // Payment Links panels); a genuinely reversed captured payment reads "Reversed".
                                const isVoidedLink = payment.refund_reason?.includes('[VOIDED]');
                                return (
                                  <Badge className="bg-orange-100 text-orange-800 border-orange-200">
                                    <Undo2 className="h-3 w-3 mr-1" />
                                    {isVoidedLink ? 'Voided' : 'Reversed'}
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
                              {/* Show Accept/Reject buttons for pending payments (hidden once voided/reversed) */}
                              {isPendingActionable(payment) && (
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
                                  <Button variant="ghost" size="sm" data-tour="payments-row-actions" className="h-8 w-8 p-0">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleViewLedger(payment)}>
                                    <FileText className="h-4 w-4 mr-2" />
                                    View Ledger
                                  </DropdownMenuItem>
                                  {/* Remove a duplicate/stale UNPAID pay-link — safe, never touches the rental */}
                                  {canEdit('payments') && isVoidableLink(payment) && (
                                    <DropdownMenuItem
                                      onClick={() => setVoidTarget({ id: payment.id, customerName: payment.customers?.name || 'the customer', amount: payment.amount })}
                                      className="text-red-600 focus:text-red-600"
                                    >
                                      <Link2Off className="h-4 w-4 mr-2" />
                                      Remove payment link
                                    </DropdownMenuItem>
                                  )}
                                  {/* Show Reverse Payment for non-reversed, non-refunded manual payments without Stripe intent.
                                      NOT for an unpaid pay-link — that must be removed via "Remove payment link", which
                                      expires the Stripe session; Reverse would leave the link live and still chargeable. */}
                                  {canEdit('payments') &&
                                   !isVoidableLink(payment) &&
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
              </div>
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
        )}
        </>
      ) : teachEmptyPayments ? (
        <PaymentsTeachingEmptyState
          onRecordPayment={
            canEdit('payments') ? () => setShowAddDialog(true) : undefined
          }
        />
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
              Reject payment &amp; close rental
            </DialogTitle>
            <DialogDescription>
              Heads up — this does more than reject the payment. It <strong className="text-destructive">closes the entire rental</strong>: ends it today, frees the vehicle back to Available, writes off any outstanding charges, and emails the customer. To remove a duplicate or unpaid payment link <em>without</em> cancelling the rental, use &ldquo;Remove payment link&rdquo; from the row&rsquo;s &#8943; menu instead.
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
              {isVerifying ? 'Rejecting...' : 'Reject & close rental'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Payment Link (void) Dialog — the SAFE alternative to Reject */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2Off className="h-5 w-5 text-red-600" />
              Remove payment link
            </DialogTitle>
            <DialogDescription>
              This cancels only this one <strong>unpaid</strong> payment link
              {voidTarget ? <> for <span className="font-semibold">{voidTarget.customerName}</span> ({formatCurrency(voidTarget.amount || 0, tenant?.currency_code || 'USD')})</> : null}, so it can no longer be paid.
              The rental, the vehicle, and any payment the customer has already made are <strong>not affected</strong>. Nothing was charged on this link, so there is nothing to refund.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleVoidLink}
              disabled={voidLink.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {voidLink.isPending ? 'Removing...' : 'Remove link'}
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
