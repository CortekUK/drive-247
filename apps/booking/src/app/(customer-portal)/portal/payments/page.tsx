'use client';

import { useState } from 'react';
import { format, formatDistanceToNow, isPast, isToday } from 'date-fns';
import {
  useCustomerInstallmentPlans,
  useInstallmentStats,
  useNextInstallmentPayment,
  useCustomerPaymentHistory,
  getInstallmentStatusBadge,
  type InstallmentPlan,
  type ScheduledInstallment,
} from '@/hooks/use-customer-installments';
import { useCustomerInvoices, useInvoiceStats, type CustomerInvoice } from '@/hooks/use-customer-invoices';
import {
  usePayInstallmentEarly,
  usePayRemainingInstallments,
  useRetryPayment,
} from '@/hooks/use-payment-actions';
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
import { cn } from '@/lib/utils';

// Mock data for demo installments
const mockInstallmentPlans = [
  {
    id: 'demo-1',
    vehicleName: '2024 BMW M4 Competition',
    planType: 'Weekly',
    totalAmount: 4500,
    paidAmount: 1500,
    remainingAmount: 3000,
    status: 'active',
    startDate: '2024-01-15',
    installments: [
      { number: 1, amount: 750, dueDate: '2024-01-22', status: 'paid', paidAt: '2024-01-22' },
      { number: 2, amount: 750, dueDate: '2024-01-29', status: 'paid', paidAt: '2024-01-29' },
      { number: 3, amount: 750, dueDate: '2024-02-05', status: 'scheduled', paidAt: null },
      { number: 4, amount: 750, dueDate: '2024-02-12', status: 'scheduled', paidAt: null },
      { number: 5, amount: 750, dueDate: '2024-02-19', status: 'scheduled', paidAt: null },
      { number: 6, amount: 750, dueDate: '2024-02-26', status: 'scheduled', paidAt: null },
    ],
  },
  {
    id: 'demo-2',
    vehicleName: '2023 Mercedes-AMG GT',
    planType: 'Bi-Weekly',
    totalAmount: 6000,
    paidAmount: 2000,
    remainingAmount: 4000,
    status: 'active',
    startDate: '2024-01-01',
    installments: [
      { number: 1, amount: 1000, dueDate: '2024-01-15', status: 'paid', paidAt: '2024-01-15' },
      { number: 2, amount: 1000, dueDate: '2024-01-29', status: 'paid', paidAt: '2024-01-29' },
      { number: 3, amount: 1000, dueDate: '2024-02-12', status: 'overdue', paidAt: null },
      { number: 4, amount: 1000, dueDate: '2024-02-26', status: 'scheduled', paidAt: null },
      { number: 5, amount: 1000, dueDate: '2024-03-11', status: 'scheduled', paidAt: null },
      { number: 6, amount: 1000, dueDate: '2024-03-25', status: 'scheduled', paidAt: null },
    ],
  },
  {
    id: 'demo-3',
    vehicleName: '2024 Porsche 911 Turbo S',
    planType: 'Monthly',
    totalAmount: 12000,
    paidAmount: 8000,
    remainingAmount: 4000,
    status: 'active',
    startDate: '2023-11-01',
    installments: [
      { number: 1, amount: 4000, dueDate: '2023-12-01', status: 'paid', paidAt: '2023-12-01' },
      { number: 2, amount: 4000, dueDate: '2024-01-01', status: 'paid', paidAt: '2024-01-01' },
      { number: 3, amount: 4000, dueDate: '2024-02-01', status: 'scheduled', paidAt: null },
    ],
  },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={cn('h-4 w-4', variantStyles[variant])} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function NextPaymentCard({
  plan,
  installment,
  onPayNow,
  onRetry,
  onUpdateCard,
  isPaying,
}: {
  plan: InstallmentPlan;
  installment: ScheduledInstallment;
  onPayNow: (installmentId: string) => void;
  onRetry: (installmentId: string) => void;
  onUpdateCard: (planId: string) => void;
  isPaying: boolean;
}) {
  const dueDate = new Date(installment.due_date);
  const isOverdue = isPast(dueDate) && !isToday(dueDate);
  const isDueToday = isToday(dueDate);
  const isFailed = installment.status === 'failed';

  const vehicle = plan.rentals?.vehicles;
  const vehicleName = vehicle
    ? `${vehicle.make || ''} ${vehicle.model || ''} (${vehicle.reg})`.trim()
    : 'Vehicle';

  return (
    <Card className={cn(
      'border-2',
      isOverdue || isFailed ? 'border-red-500 bg-red-50 dark:bg-red-950/20' :
      isDueToday ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20' :
      'border-accent'
    )}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOverdue || isFailed ? (
              <AlertTriangle className="h-5 w-5 text-red-600" />
            ) : isDueToday ? (
              <AlertCircle className="h-5 w-5 text-yellow-600" />
            ) : (
              <Clock className="h-5 w-5 text-accent" />
            )}
            <CardTitle className="text-lg">
              {isOverdue ? 'Overdue Payment' : isFailed ? 'Payment Failed' : isDueToday ? 'Payment Due Today' : 'Next Payment'}
            </CardTitle>
          </div>
          <Badge variant={isOverdue || isFailed ? 'destructive' : isDueToday ? 'secondary' : 'outline'}>
            {isOverdue ? 'Overdue' : isFailed ? 'Failed' : isDueToday ? 'Due Today' : formatDistanceToNow(dueDate, { addSuffix: true })}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-1 mt-1">
          <Car className="h-3 w-3" />
          {vehicleName}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-3xl font-bold">{formatCurrency(installment.amount)}</p>
            <p className="text-sm text-muted-foreground">
              Installment #{installment.installment_number} of {plan.number_of_installments}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium">Due Date</p>
            <p className="text-lg">{format(dueDate, 'MMM dd, yyyy')}</p>
          </div>
        </div>

        {isFailed && installment.last_failure_reason && (
          <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-3">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              Payment Failed
            </p>
            <p className="text-sm text-red-600 dark:text-red-300">
              {installment.last_failure_reason}
            </p>
            <p className="text-xs text-red-500 mt-1">
              Attempts: {installment.failure_count || 1}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          {isFailed ? (
            <>
              <Button
                onClick={() => onRetry(installment.id)}
                disabled={isPaying}
                variant="destructive"
                className="flex-1"
              >
                {isPaying ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Retry Payment
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => onUpdateCard(plan.id)}
              >
                <CreditCard className="h-4 w-4 mr-2" />
                Update Card
              </Button>
            </>
          ) : isOverdue ? (
            <Button
              onClick={() => onPayNow(installment.id)}
              disabled={isPaying}
              variant="destructive"
              className="flex-1"
            >
              {isPaying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Pay Now
            </Button>
          ) : (
            <Button
              onClick={() => onPayNow(installment.id)}
              disabled={isPaying}
              variant="default"
              className="flex-1"
            >
              {isPaying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 mr-2" />
              )}
              Pay Early
            </Button>
          )}
        </div>

        {!isFailed && !isOverdue && (
          <p className="text-xs text-muted-foreground">
            Payment will be automatically charged to your saved card on the due date.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InstallmentPlanCard({
  plan,
  onPayNow,
  onPayOff,
  isPaying,
}: {
  plan: InstallmentPlan;
  onPayNow: (installmentId: string) => void;
  onPayOff: (planId: string) => void;
  isPaying: boolean;
}) {
  const vehicle = plan.rentals?.vehicles;
  const vehicleName = vehicle
    ? `${vehicle.make || ''} ${vehicle.model || ''} (${vehicle.reg})`.trim()
    : 'Vehicle';

  const paidInstallments = plan.paid_installments || 0;
  const progressPercent = (paidInstallments / plan.number_of_installments) * 100;
  const totalPaid = plan.total_paid || 0;
  const remaining = plan.total_installable_amount - totalPaid;

  const isCompleted = plan.status === 'completed';
  const isOverdue = plan.status === 'overdue';

  // Get remaining unpaid installments
  const unpaidInstallments = plan.scheduled_installments.filter(
    (i) => i.status === 'scheduled' || i.status === 'failed'
  );

  return (
    <Card className={cn(
      isOverdue && 'border-red-300 dark:border-red-800'
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{vehicleName}</CardTitle>
              <Badge variant={
                isCompleted ? 'default' :
                isOverdue ? 'destructive' :
                'secondary'
              }>
                {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
              </Badge>
            </div>
            <CardDescription>
              {plan.plan_type.charAt(0).toUpperCase() + plan.plan_type.slice(1)} Plan
              {plan.rentals?.rental_number && ` • ${plan.rentals.rental_number}`}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="font-semibold">{formatCurrency(plan.total_installable_amount + plan.upfront_amount)}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {paidInstallments} of {plan.number_of_installments} installments paid
            </span>
            <span className="font-medium">{Math.round(progressPercent)}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
          <div className="flex justify-between text-sm">
            <span className="text-green-600">Paid: {formatCurrency(totalPaid + plan.upfront_amount)}</span>
            {remaining > 0 && (
              <span className="text-muted-foreground">Remaining: {formatCurrency(remaining)}</span>
            )}
          </div>
        </div>

        {/* Pay Off Button */}
        {!isCompleted && unpaidInstallments.length > 0 && (
          <Button
            onClick={() => onPayOff(plan.id)}
            disabled={isPaying}
            variant="outline"
            className="w-full"
          >
            {isPaying ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Zap className="h-4 w-4 mr-2" />
            )}
            Pay Off Remaining ({formatCurrency(remaining)})
          </Button>
        )}

        <Separator />

        {/* Schedule */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="schedule" className="border-none">
            <AccordionTrigger className="py-2 hover:no-underline">
              <span className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Payment Schedule
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 pt-2">
                {/* Upfront Payment */}
                <div className="flex items-center justify-between text-sm py-2 border-b">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span>Upfront (Deposit + Fees)</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">{formatCurrency(plan.upfront_amount)}</span>
                    <Badge variant="default" className="ml-2 text-xs">Paid</Badge>
                  </div>
                </div>

                {/* Installments */}
                {plan.scheduled_installments.map((inst) => {
                  const isPaid = inst.status === 'paid';
                  const isFailed = inst.status === 'failed';
                  const isScheduled = inst.status === 'scheduled';
                  const dueDate = new Date(inst.due_date);
                  const isInstOverdue = isScheduled && isPast(dueDate) && !isToday(dueDate);

                  return (
                    <div
                      key={inst.id}
                      className={cn(
                        'flex items-center justify-between text-sm py-2 border-b last:border-0',
                        (isFailed || isInstOverdue) && 'bg-red-50 dark:bg-red-950/20 -mx-2 px-2 rounded'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {isPaid ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : isFailed || isInstOverdue ? (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <span>Installment #{inst.installment_number}</span>
                          <p className="text-xs text-muted-foreground">
                            {format(dueDate, 'MMM dd, yyyy')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{formatCurrency(inst.amount)}</span>
                        {isPaid ? (
                          <Badge variant="default" className="text-xs">Paid</Badge>
                        ) : isFailed ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onPayNow(inst.id)}
                            disabled={isPaying}
                          >
                            Retry
                          </Button>
                        ) : isInstOverdue ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onPayNow(inst.id)}
                            disabled={isPaying}
                          >
                            Pay
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onPayNow(inst.id)}
                            disabled={isPaying}
                          >
                            Pay Early
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

function PaymentHistoryList() {
  const { data: payments, isLoading } = useCustomerPaymentHistory(10);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (!payments || payments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No payment history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {payments.map((payment) => {
        const vehicle = payment.rentals?.vehicles;
        const vehicleName = vehicle
          ? `${vehicle.make || ''} ${vehicle.model || ''}`
          : null;

        return (
          <div
            key={payment.id}
            className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-full',
                payment.status === 'Applied' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-muted'
              )}>
                <Banknote className={cn(
                  'h-4 w-4',
                  payment.status === 'Applied' ? 'text-green-600' : 'text-muted-foreground'
                )} />
              </div>
              <div>
                <p className="font-medium text-sm">
                  {payment.payment_type || 'Payment'}
                  {vehicleName && <span className="text-muted-foreground"> • {vehicleName}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(payment.payment_date), 'MMM dd, yyyy')} • {payment.method}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-semibold text-green-600">
                {formatCurrency(payment.amount)}
              </p>
              <Badge variant="outline" className="text-xs">
                {payment.status}
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvoiceList({
  onViewInvoice,
}: {
  onViewInvoice: (invoice: CustomerInvoice) => void;
}) {
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
          ? `${vehicle.reg} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
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
                  {format(new Date(invoice.invoice_date), 'MMM dd, yyyy')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="font-semibold">
                  {formatCurrency(invoice.total_amount)}
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
  if (!invoice) return null;

  const vehicle = invoice.vehicles;
  const vehicleName = vehicle
    ? `${vehicle.reg} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
    : 'Vehicle';

  const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
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
            {vehicleName} • {format(new Date(invoice.invoice_date), 'MMM dd, yyyy')}
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
                <span>{formatCurrency(invoice.rental_fee)}</span>
              </div>
            )}
            {invoice.protection_fee != null && invoice.protection_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Protection Fee</span>
                <span>{formatCurrency(invoice.protection_fee)}</span>
              </div>
            )}
            {invoice.service_fee != null && invoice.service_fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Service Fee</span>
                <span>{formatCurrency(invoice.service_fee)}</span>
              </div>
            )}
            {invoice.security_deposit != null && invoice.security_deposit > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Security Deposit</span>
                <span>{formatCurrency(invoice.security_deposit)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(invoice.subtotal)}</span>
            </div>
            {invoice.tax_amount != null && invoice.tax_amount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(invoice.tax_amount)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="text-lg">{formatCurrency(invoice.total_amount)}</span>
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
                    {format(new Date(invoice.rentals.start_date), 'MMM dd')} - {format(new Date(invoice.rentals.end_date), 'MMM dd, yyyy')}
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

type MockInstallmentPlan = typeof mockInstallmentPlans[0];

function DemoInstallmentCard({
  plan,
  onClick,
}: {
  plan: MockInstallmentPlan;
  onClick: () => void;
}) {
  const progressPercent = (plan.paidAmount / plan.totalAmount) * 100;
  const paidInstallments = plan.installments.filter(i => i.status === 'paid').length;

  return (
    <Card
      className="cursor-pointer hover:border-accent transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{plan.vehicleName}</CardTitle>
              <Badge variant="secondary">Demo</Badge>
            </div>
            <CardDescription>{plan.planType} Plan</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="font-semibold">{formatCurrency(plan.totalAmount)}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {paidInstallments} of {plan.installments.length} installments paid
            </span>
            <span className="font-medium">{Math.round(progressPercent)}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
          <div className="flex justify-between text-sm">
            <span className="text-green-600">Paid: {formatCurrency(plan.paidAmount)}</span>
            <span className="text-muted-foreground">Remaining: {formatCurrency(plan.remainingAmount)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DemoInstallmentTimeline({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: MockInstallmentPlan | null;
}) {
  if (!plan) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <Car className="h-5 w-5" />
            {plan.vehicleName}
          </SheetTitle>
          <SheetDescription>
            {plan.planType} Installment Plan • Started {format(new Date(plan.startDate), 'MMM dd, yyyy')}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Progress Summary */}
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xl font-bold text-green-600">{formatCurrency(plan.paidAmount)}</p>
                <p className="text-xs text-muted-foreground">Paid</p>
              </div>
              <div>
                <p className="text-xl font-bold">{formatCurrency(plan.remainingAmount)}</p>
                <p className="text-xs text-muted-foreground">Remaining</p>
              </div>
              <div>
                <p className="text-xl font-bold">{formatCurrency(plan.totalAmount)}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-0">
            {plan.installments.map((inst, index) => (
              <div key={inst.number} className="flex gap-4">
                {/* Timeline line */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "w-3 h-3 rounded-full border-2",
                    inst.status === 'paid' ? "bg-green-500 border-green-500" :
                    inst.status === 'overdue' ? "bg-red-500 border-red-500" :
                    "bg-background border-muted-foreground"
                  )} />
                  {index < plan.installments.length - 1 && (
                    <div className={cn(
                      "w-0.5 h-12",
                      inst.status === 'paid' ? "bg-green-500" : "bg-muted"
                    )} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Installment #{inst.number}</p>
                      <p className="text-xs text-muted-foreground">
                        Due: {format(new Date(inst.dueDate), 'MMM dd, yyyy')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatCurrency(inst.amount)}</p>
                      <Badge
                        variant={
                          inst.status === 'paid' ? 'default' :
                          inst.status === 'overdue' ? 'destructive' :
                          'secondary'
                        }
                        className="text-xs"
                      >
                        {inst.status === 'paid' ? 'Paid' :
                         inst.status === 'overdue' ? 'Overdue' :
                         'Scheduled'}
                      </Badge>
                    </div>
                  </div>
                  {inst.paidAt && (
                    <p className="text-xs text-green-600 mt-1">
                      Paid on {format(new Date(inst.paidAt), 'MMM dd, yyyy')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function PaymentsPage() {
  const { data: plans, isLoading: plansLoading } = useCustomerInstallmentPlans();
  const { data: installmentStats, isLoading: installmentStatsLoading } = useInstallmentStats();
  const { data: invoiceStats, isLoading: invoiceStatsLoading } = useInvoiceStats();
  const { data: nextPayment, isLoading: nextLoading } = useNextInstallmentPayment();

  const payEarly = usePayInstallmentEarly();
  const payOff = usePayRemainingInstallments();
  const retryPayment = useRetryPayment();

  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'pay' | 'payoff' | 'retry';
    id: string;
    amount: number;
    title: string;
  } | null>(null);

  const [updateCardDialog, setUpdateCardDialog] = useState<{
    open: boolean;
    planId?: string;
  }>({ open: false });

  // Demo installments state
  const [showDemoInstallments, setShowDemoInstallments] = useState(false);
  const [selectedDemoPlan, setSelectedDemoPlan] = useState<MockInstallmentPlan | null>(null);
  const [demoTimelineOpen, setDemoTimelineOpen] = useState(false);

  // Invoice detail state
  const [selectedInvoice, setSelectedInvoice] = useState<CustomerInvoice | null>(null);
  const [invoiceDetailOpen, setInvoiceDetailOpen] = useState(false);

  const activePlans = (plans || []).filter(
    (p) => p.status === 'active' || p.status === 'overdue'
  );
  const completedPlans = (plans || []).filter((p) => p.status === 'completed');

  const isLoading = plansLoading || installmentStatsLoading || invoiceStatsLoading || nextLoading;

  // Combined stats: use invoice stats as primary, installment stats as secondary
  const stats = {
    activePlans: installmentStats?.activePlans || 0,
    totalPaid: (invoiceStats?.totalPaid || 0) + (installmentStats?.totalPaid || 0),
    totalRemaining: (invoiceStats?.totalDue || 0) + (installmentStats?.totalRemaining || 0),
    overdueCount: (invoiceStats?.overdueCount || 0) + (installmentStats?.overdueCount || 0),
    paidInvoices: invoiceStats?.paidCount || 0,
    pendingInvoices: invoiceStats?.pendingCount || 0,
  };
  const isPaying = payEarly.isPending || payOff.isPending || retryPayment.isPending;

  const handlePayNow = (installmentId: string) => {
    const plan = plans?.find(p => p.scheduled_installments.some(i => i.id === installmentId));
    const inst = plan?.scheduled_installments.find(i => i.id === installmentId);
    if (inst) {
      setConfirmDialog({
        type: inst.status === 'failed' ? 'retry' : 'pay',
        id: installmentId,
        amount: inst.amount,
        title: `Installment #${inst.installment_number}`,
      });
    }
  };

  const handlePayOff = (planId: string) => {
    const plan = plans?.find(p => p.id === planId);
    if (plan) {
      const remaining = plan.total_installable_amount - (plan.total_paid || 0);
      setConfirmDialog({
        type: 'payoff',
        id: planId,
        amount: remaining,
        title: 'All Remaining Installments',
      });
    }
  };

  const handleRetry = (installmentId: string) => {
    handlePayNow(installmentId);
  };

  const executePayment = async () => {
    if (!confirmDialog) return;

    try {
      if (confirmDialog.type === 'payoff') {
        await payOff.mutateAsync(confirmDialog.id);
      } else if (confirmDialog.type === 'retry') {
        await retryPayment.mutateAsync(confirmDialog.id);
      } else {
        await payEarly.mutateAsync(confirmDialog.id);
      }
    } finally {
      setConfirmDialog(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-muted-foreground">
            Manage your installment plans and view payment history
          </p>
        </div>
        {activePlans.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setUpdateCardDialog({ open: true })}
          >
            <CreditCard className="h-4 w-4 mr-2" />
            Update Card
          </Button>
        )}
      </div>

      {/* Stats */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active Plans"
            value={stats.activePlans}
            icon={CreditCard}
            description={stats.paidInvoices ? `${stats.paidInvoices} invoices paid` : undefined}
          />
          <StatCard
            title="Total Paid"
            value={formatCurrency(stats.totalPaid)}
            icon={CheckCircle2}
            variant="success"
          />
          <StatCard
            title="Remaining"
            value={formatCurrency(stats.totalRemaining)}
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

      {/* Tabs Section */}
      <Tabs defaultValue="installments" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="installments">Installments</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-4 mt-6">
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
        </TabsContent>

        <TabsContent value="installments" className="space-y-6 mt-6">
          {/* Demo Installments Section */}
          <Card className="border-dashed">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Demo Installments</CardTitle>
                  <CardDescription>See how installment plans work</CardDescription>
                </div>
                <Button
                  variant={showDemoInstallments ? "secondary" : "outline"}
                  onClick={() => setShowDemoInstallments(!showDemoInstallments)}
                >
                  {showDemoInstallments ? 'Hide Demo' : 'Show Demo'}
                </Button>
              </div>
            </CardHeader>
            {showDemoInstallments && (
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {mockInstallmentPlans.map((plan) => (
                    <DemoInstallmentCard
                      key={plan.id}
                      plan={plan}
                      onClick={() => {
                        setSelectedDemoPlan(plan);
                        setDemoTimelineOpen(true);
                      }}
                    />
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Next Payment */}
          {isLoading ? (
            <Card>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ) : nextPayment ? (
            <NextPaymentCard
              plan={nextPayment.plan}
              installment={nextPayment.installment}
              onPayNow={handlePayNow}
              onRetry={handleRetry}
              onUpdateCard={(planId) => setUpdateCardDialog({ open: true, planId })}
              isPaying={isPaying}
            />
          ) : activePlans.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-semibold text-lg mb-2">No Active Installment Plans</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  You don't have any active installment plans. When you book a vehicle with installments,
                  your payment schedule will appear here.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Active Plans */}
          {activePlans.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Active Installment Plans</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {activePlans.map((plan) => (
                  <InstallmentPlanCard
                    key={plan.id}
                    plan={plan}
                    onPayNow={handlePayNow}
                    onPayOff={handlePayOff}
                    isPaying={isPaying}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Completed Plans */}
          {completedPlans.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-muted-foreground">Completed Plans</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {completedPlans.map((plan) => (
                  <InstallmentPlanCard
                    key={plan.id}
                    plan={plan}
                    onPayNow={handlePayNow}
                    onPayOff={handlePayOff}
                    isPaying={isPaying}
                  />
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Demo Timeline Dialog */}
      <DemoInstallmentTimeline
        open={demoTimelineOpen}
        onOpenChange={setDemoTimelineOpen}
        plan={selectedDemoPlan}
      />

      {/* Invoice Detail Sheet */}
      <InvoiceDetailSheet
        open={invoiceDetailOpen}
        onOpenChange={setInvoiceDetailOpen}
        invoice={selectedInvoice}
      />

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog?.type === 'retry' ? 'Retry Payment' :
               confirmDialog?.type === 'payoff' ? 'Pay Off Remaining' :
               'Pay Early'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.type === 'retry' ? (
                <>
                  This will retry the failed payment for <strong>{confirmDialog.title}</strong>.
                  <br />
                  Amount: <strong>{formatCurrency(confirmDialog.amount)}</strong>
                </>
              ) : confirmDialog?.type === 'payoff' ? (
                <>
                  This will pay off all remaining installments at once.
                  <br />
                  Total: <strong>{formatCurrency(confirmDialog.amount)}</strong>
                </>
              ) : (
                <>
                  This will charge your saved card for <strong>{confirmDialog?.title}</strong> now.
                  <br />
                  Amount: <strong>{formatCurrency(confirmDialog?.amount || 0)}</strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPaying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executePayment} disabled={isPaying}>
              {isPaying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                `Pay ${formatCurrency(confirmDialog?.amount || 0)}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Update Payment Method Dialog */}
      <UpdatePaymentMethodDialog
        open={updateCardDialog.open}
        onOpenChange={(open) => setUpdateCardDialog({ open, planId: updateCardDialog.planId })}
        installmentPlanId={updateCardDialog.planId}
        onSuccess={() => {
          // Refetch data after card update
          window.location.reload();
        }}
      />
    </div>
  );
}
