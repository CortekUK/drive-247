'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useCustomerAuthStore } from '@/stores/customer-auth-store';
import { useCustomerInvoices, useInvoiceStats, type CustomerInvoice } from '@/hooks/use-customer-invoices';
import { UpdatePaymentMethodDialog } from '@/components/customer-portal/UpdatePaymentMethodDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CreditCard,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  Car,
  AlertTriangle,
  Banknote,
  Receipt,
  RefreshCw,
  Loader2,
  Zap,
  FileText,
  Eye,
  ChevronRight,
} from 'lucide-react';
import { AccountStatementDialog } from '@/components/customer-portal/AccountStatementDialog';
import { cn } from '@/lib/utils';
import { useTenant } from '@/contexts/TenantContext';
import { formatCurrency } from '@/lib/format-utils';
import { parseDateOnly } from '@/lib/date-utils';
import { vehicleDisplayName, vehicleDisplayLabel, displayRegistration } from "@/lib/vehicle-identity";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  variant = 'default',
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const variantStyles = {
    default: 'text-muted-foreground',
    success: 'text-green-600',
    warning: 'text-yellow-600',
    danger: 'text-red-600',
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 sm:p-6 sm:pb-2">
        <CardTitle className="text-xs sm:text-sm font-medium min-w-0 truncate">{title}</CardTitle>
        <Icon className={cn('h-4 w-4 shrink-0', variantStyles[variant])} />
      </CardHeader>
      <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
        <div className="text-xl sm:text-2xl font-bold break-words">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceList({
  onViewInvoice,
}: {
  onViewInvoice: (invoice: CustomerInvoice) => void;
}) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const { data: invoices, isLoading } = useCustomerInvoices();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (!invoices || invoices.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No invoices yet</p>
      </div>
    );
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'paid':
        return 'default';
      case 'partial':
        return 'secondary';
      case 'pending':
        return 'outline';
      case 'overdue':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid':
        return 'Paid';
      case 'partial':
        return 'Partial';
      case 'pending':
        return 'Pending';
      case 'overdue':
        return 'Overdue';
      default:
        return status;
    }
  };

  return (
    <div className="space-y-2">
      {invoices.map((invoice) => {
        const vehicle = invoice.vehicles;
        const vehicleName = vehicle
          ? vehicleDisplayLabel(vehicle, tenant)
          : null;

        const isPaid = invoice.computed_status === 'paid';
        const isOverdue = invoice.computed_status === 'overdue';

        return (
          <div
            key={invoice.id}
            className={cn(
              "flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer",
              isOverdue && "border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
            )}
            onClick={() => onViewInvoice(invoice)}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className={cn(
                'p-2 rounded-full shrink-0',
                isPaid ? 'bg-green-100 dark:bg-green-900/30' :
                isOverdue ? 'bg-red-100 dark:bg-red-900/30' :
                'bg-muted'
              )}>
                <FileText className={cn(
                  'h-4 w-4',
                  isPaid ? 'text-green-600' :
                  isOverdue ? 'text-red-600' :
                  'text-muted-foreground'
                )} />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">
                  {invoice.invoice_number}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {vehicleName && <span>{vehicleName} • </span>}
                  {format(parseDateOnly(invoice.invoice_date), 'MMM dd, yyyy')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="font-semibold">
                  {formatCurrency(invoice.total_amount, currencyCode)}
                </p>
                <Badge variant={getStatusVariant(invoice.computed_status)} className="text-xs">
                  {getStatusLabel(invoice.computed_status)}
                </Badge>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvoiceDetailSheet({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: CustomerInvoice | null;
}) {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  if (!invoice) return null;

  const vehicle = invoice.vehicles;
  const vehicleName = vehicle
    ? vehicleDisplayLabel(vehicle, tenant)
    : 'Vehicle';

  const dueDate = invoice.due_date ? parseDateOnly(invoice.due_date) : null;
  const isPaid = invoice.computed_status === 'paid';
  const isOverdue = invoice.computed_status === 'overdue';

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'paid':
        return 'default';
      case 'partial':
        return 'secondary';
      case 'pending':
        return 'outline';
      case 'overdue':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid':
        return 'Paid';
      case 'partial':
        return 'Partial';
      case 'pending':
        return 'Pending';
      case 'overdue':
        return 'Overdue';
      default:
        return status;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {invoice.invoice_number}
          </SheetTitle>
          <SheetDescription>
            {vehicleName} • {format(parseDateOnly(invoice.invoice_date), 'MMM dd, yyyy')}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Status and Due Date */}
          <div className="flex items-center justify-between">
            <Badge variant={getStatusVariant(invoice.computed_status)}>
              {getStatusLabel(invoice.computed_status)}
            </Badge>
            {dueDate && !isPaid && (
              <p className={cn(
                "text-sm",
                isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"
              )}>
                {isOverdue ? 'Overdue: ' : 'Due: '}
                {format(dueDate, 'MMM dd, yyyy')}
              </p>
            )}
          </div>

          {/* Invoice Details */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            {invoice.rental_fee != null && invoice.rental_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Rental Fee</span>
                <span>{formatCurrency(invoice.rental_fee, currencyCode)}</span>
              </div>
            )}
            {invoice.protection_fee != null && invoice.protection_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Protection Fee</span>
                <span>{formatCurrency(invoice.protection_fee, currencyCode)}</span>
              </div>
            )}
            {invoice.service_fee != null && invoice.service_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Service Fee</span>
                <span>{formatCurrency(invoice.service_fee, currencyCode)}</span>
              </div>
            )}
            {invoice.security_deposit != null && invoice.security_deposit > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{tenant?.deposit_charge_enabled ? 'Security Deposit' : 'Pre-Authorization'}</span>
                <span>{formatCurrency(invoice.security_deposit, currencyCode)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(invoice.subtotal, currencyCode)}</span>
            </div>
            {invoice.tax_amount != null && invoice.tax_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(invoice.tax_amount, currencyCode)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="text-lg">{formatCurrency(invoice.total_amount, currencyCode)}</span>
            </div>
          </div>

          {/* Rental Info */}
          {invoice.rentals && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Rental Information</h4>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                {invoice.rentals.rental_number && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Rental #</span>
                    <span>{invoice.rentals.rental_number}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Period</span>
                  <span>
                    {format(parseDateOnly(invoice.rentals.start_date), 'MMM dd')} - {format(parseDateOnly(invoice.rentals.end_date), 'MMM dd, yyyy')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Notes</h4>
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4">
                {invoice.notes}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// A deposit hold (pre-authorisation) only truly ends when the money is taken
// (`captured`) or handed back (`released`). Every other value — including
// `failed` and `expired`, and a NULL status left behind by a placement that
// errored — means the renter's card is still load-bearing for this rental,
// either because funds are reserved on it or because we need a working card to
// place the hold again.
const TERMINAL_HOLD_STATUSES = ['captured', 'released'];

// Long-term renters (60–120 day rentals) carry a deposit hold that has to be
// re-authorised repeatedly over the life of the rental. If their card expires
// or starts declining, the chain dies — and the only fix is a new card. This
// hook is what puts the "Update Card" button in front of exactly those renters.
function useHasActiveDepositHold() {
  const { customerUser } = useCustomerAuthStore();
  const customerId = customerUser?.customer_id;

  return useQuery({
    queryKey: ['customer-active-deposit-hold', customerId],
    queryFn: async () => {
      if (!customerId) return false;
      // No status filter in the query: a hold that FAILED TO PLACE has its
      // status rolled back to NULL by `place-deposit-hold` while the error is
      // left behind, so filtering on a non-null status would hide exactly the
      // renters who most need a working card. Both columns are read and the
      // decision is made below.
      const { data, error } = await supabase
        .from('rentals')
        .select('deposit_hold_status, deposit_hold_last_error')
        .eq('customer_id', customerId);
      // Fail toward showing the control: being unable to answer the question
      // must never be the reason a renter can't replace a failing card.
      if (error) return true;
      // Filtered client-side rather than with a `not.in` filter so the set of
      // terminal statuses stays readable and can't be broken by quoting rules.
      return (data || []).some((r) => {
        const status = (r as { deposit_hold_status?: string | null }).deposit_hold_status;
        const lastError = (r as { deposit_hold_last_error?: string | null })
          .deposit_hold_last_error;
        if (!status) return !!lastError; // attempted, never placed
        return !TERMINAL_HOLD_STATUSES.includes(status);
      });
    },
    enabled: !!customerId,
  });
}

export default function PaymentsPage() {
  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'USD';
  const { data: invoiceStats, isLoading: invoiceStatsLoading } = useInvoiceStats();
  const { data: hasActiveHold = false } = useHasActiveDepositHold();

  // Show success banner when redirected from Stripe payment
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('payment') === 'success';
    }
    return false;
  });

  const [updateCardDialog, setUpdateCardDialog] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  // Invoice detail state
  const [selectedInvoice, setSelectedInvoice] = useState<CustomerInvoice | null>(null);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);

  const isLoading = invoiceStatsLoading;

  const stats = {
    totalPaid: invoiceStats?.totalPaid || 0,
    totalRemaining: invoiceStats?.totalDue || 0,
    overdueCount: invoiceStats?.overdueCount || 0,
    paidInvoices: invoiceStats?.paidCount || 0,
    pendingInvoices: invoiceStats?.pendingCount || 0,
  };
  return (
    <div className="space-y-6">
      {/* Payment success banner */}
      {showPaymentSuccess && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-green-500/30 bg-green-500/10">
          <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-green-700 dark:text-green-400">Payment Successful</p>
            <p className="text-sm text-green-600 dark:text-green-500">Your payment has been processed successfully. Thank you!</p>
          </div>
          <button onClick={() => { setShowPaymentSuccess(false); window.history.replaceState({}, '', window.location.pathname); }} className="text-muted-foreground hover:text-foreground text-sm">Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Payments</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            View your invoices and payment history
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            onClick={() => setStatementOpen(true)}
            className="w-full sm:w-auto"
          >
            <FileText className="h-4 w-4 mr-2" />
            Download statement
          </Button>
          {/* Shown for renters with a live deposit hold — the saved card is what
              the hold is re-authorised against. */}
          {hasActiveHold && (
            <Button
              variant="outline"
              onClick={() => setUpdateCardDialog(true)}
              className="w-full sm:w-auto"
            >
              <CreditCard className="h-4 w-4 mr-2" />
              Update Card
            </Button>
          )}
        </div>
      </div>

      <AccountStatementDialog open={statementOpen} onOpenChange={setStatementOpen} />

      {/* Stats */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2 p-3 sm:p-6 sm:pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
                <Skeleton className="h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <StatCard
            title="Total Paid"
            value={formatCurrency(stats.totalPaid, currencyCode)}
            icon={CheckCircle2}
            variant="success"
            description={stats.paidInvoices ? `${stats.paidInvoices} invoices paid` : undefined}
          />
          <StatCard
            title="Remaining"
            value={formatCurrency(stats.totalRemaining, currencyCode)}
            icon={DollarSign}
            description={stats.pendingInvoices ? `${stats.pendingInvoices} pending` : undefined}
          />
          <StatCard
            title="Overdue"
            value={stats.overdueCount}
            icon={AlertTriangle}
            variant={stats.overdueCount ? 'danger' : 'default'}
            description={stats.overdueCount ? 'Action required' : 'All caught up'}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Invoices</CardTitle>
          <CardDescription>Your rental invoices and billing details</CardDescription>
        </CardHeader>
        <CardContent>
          <InvoiceList
            onViewInvoice={(invoice) => {
              setSelectedInvoice(invoice);
              setInvoiceDetailOpen(true);
            }}
          />
        </CardContent>
      </Card>

      {/* Invoice Detail Sheet */}
      <InvoiceDetailSheet
        open={invoiceDetailOpen}
        onOpenChange={setInvoiceDetailOpen}
        invoice={selectedInvoice}
      />

      {/* Update Payment Method Dialog */}
      <UpdatePaymentMethodDialog
        open={updateCardDialog}
        onOpenChange={setUpdateCardDialog}
        onSuccess={() => {
          // Refetch data after card update
          window.location.reload();
        }}
      />
    </div>
  );
}
