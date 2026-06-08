"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TableTile,
  bentoTable,
  Money,
  StatusPill,
  EmptyState,
  TableSkeleton,
  Eyebrow,
} from "@/components/bento";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
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
  BarChart3,
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
import { useOrgSettings } from "@/hooks/use-org-settings";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format-utils";
import { parseLocalDate } from "@/lib/date-utils";
import { useTenant } from "@/contexts/TenantContext";
import { useManagerPermissions } from "@/hooks/use-manager-permissions";
import { cn } from "@/lib/utils";

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
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div className="min-w-0">
          <Eyebrow>Finance</Eyebrow>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Payments</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Record and manage customer payments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/payments/analytics" className="shrink-0">
            <Button variant="outline" size="icon">
              <BarChart3 className="h-4 w-4" />
            </Button>
          </Link>
          <Button variant="outline" size="icon" onClick={handleExportCSV} className="shrink-0">
            <Download className="h-4 w-4" />
          </Button>
          <AddPaymentDialog
            open={showAddDialog}
            onOpenChange={setShowAddDialog}
          />
          {canEdit('payments') && (
            <Button onClick={() => setShowAddDialog(true)} className="flex-1 sm:flex-none gap-2">
              <Plus className="h-4 w-4" />
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
        <TableSkeleton rows={8} cols={9} />
      ) : payments && payments.length > 0 ? (
        <>
          <TableTile>
              <div className="max-h-[calc(100vh-380px)] min-h-[300px] overflow-auto relative">
              <Table>
                  <TableHeader className={cn("sticky top-0 z-10", bentoTable.header)}>
                    <TableRow>
                      <TableHead
                        className="cursor-pointer"
                        onClick={() => handleSort('payment_date')}
                      >
                        Date {sortBy === 'payment_date' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead
                        className="cursor-pointer"
                        onClick={() => handleSort('customer')}
                      >
                        Customer {sortBy === 'customer' && (sortOrder === 'asc' ? '↑' : '↓')}
                      </TableHead>
                      <TableHead>Vehicle</TableHead>
                      <TableHead>Rental</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead
                        className="text-left cursor-pointer"
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
                        <TableRow key={payment.id} className={bentoTable.row}>
                          <TableCell className="font-mono tabular-nums text-foreground">
                            {formatInTimeZone(new Date(payment.payment_date), 'America/New_York', 'MM/dd/yyyy')}
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
                                <span className="font-mono">{payment.vehicles.reg}</span>
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
                               <StatusPill tone="primary" className="cursor-pointer font-mono"
                                 onClick={() => router.push(`/rentals/${payment.rentals!.id}`)}>
                                 {payment.rentals.rental_number || `R-${payment.rentals.id.slice(0, 6)}`}
                               </StatusPill>
                             ) : (
                               <span className="text-muted-foreground text-xs">No Rental</span>
                             )}
                           </TableCell>
                           <TableCell>
                             <StatusPill tone={payment.payment_type === 'InitialFee' ? 'primary' : 'neutral'}>
                               {getPaymentTypeDisplay(payment.payment_type)}
                             </StatusPill>
                           </TableCell>
                           <TableCell className="text-muted-foreground">{payment.method ? payment.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-'}</TableCell>
                          <TableCell className="text-left">
                            <div>
                              <Money className="font-semibold text-foreground">
                                {formatCurrency(payment.amount, tenant?.currency_code || 'USD')}
                              </Money>
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
                                  <StatusPill tone="warn">
                                    <Undo2 className="h-3 w-3" />
                                    Reversed
                                  </StatusPill>
                                );
                              }

                              const verificationStatus = payment.verification_status || 'auto_approved';
                              const statusInfo = getVerificationStatusInfo(verificationStatus);
                              const tone =
                                verificationStatus === 'pending'
                                  ? 'warn'
                                  : verificationStatus === 'rejected'
                                  ? 'danger'
                                  : 'success';
                              return (
                                <StatusPill tone={tone}>
                                  {verificationStatus === 'pending' && <Clock className="h-3 w-3" />}
                                  {verificationStatus === 'approved' && <CheckCircle className="h-3 w-3" />}
                                  {verificationStatus === 'rejected' && <XCircle className="h-3 w-3" />}
                                  {statusInfo.label}
                                </StatusPill>
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
                                            className="h-8 w-8 p-0 text-[color:var(--bento-success)] hover:text-[color:var(--bento-success)] hover:[background:var(--bento-success-weak)]"
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
                                            className="h-8 w-8 p-0 text-[color:var(--bento-danger-fg)] hover:text-[color:var(--bento-danger-fg)] hover:[background:var(--bento-danger-weak)]"
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
                                      className="text-[color:var(--bento-warn-accent)] focus:text-[color:var(--bento-warn-accent)]"
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
          </TableTile>

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
        <EmptyState
          icon={<CreditCard className="h-5 w-5" />}
          title="No payments found"
          description={
            Object.values(filters).some(f => f && f !== 'all' && f !== 'thisMonth')
              ? "No payments match your current filters"
              : "Start recording payments to track your cash flow"
          }
          action={
            canEdit('payments') ? (
              <Button onClick={() => setShowAddDialog(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Record Payment
              </Button>
            ) : undefined
          }
        />
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
              <Label htmlFor="reject-reason">Reason for Rejection <span className="text-destructive">*</span></Label>
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
            <DialogTitle className="flex items-center gap-2 text-[color:var(--bento-warn-accent)]">
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
            <div className="rounded-lg [background:var(--bento-warn-bg)] [border-color:var(--bento-warn-border)] border p-3">
              <div className="flex gap-2">
                <AlertTriangle className="h-4 w-4 text-[color:var(--bento-warn-accent)] mt-0.5 flex-shrink-0" />
                <div className="text-sm text-[color:var(--bento-warn-fg)]">
                  <p className="font-medium">This action cannot be undone.</p>
                  <p className="mt-1">The payment will be marked as reversed and all allocations to charges will be removed.</p>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reverse-reason">Reason for Reversal <span className="text-destructive">*</span></Label>
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
              className="[background:var(--bento-warn-accent)] text-white hover:opacity-90"
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
