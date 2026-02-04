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
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

export default function PaymentsPage() {
  const { data: plans, isLoading: plansLoading } = useCustomerInstallmentPlans();
  const { data: stats, isLoading: statsLoading } = useInstallmentStats();
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

  const activePlans = (plans || []).filter(
    (p) => p.status === 'active' || p.status === 'overdue'
  );
  const completedPlans = (plans || []).filter((p) => p.status === 'completed');

  const isLoading = plansLoading || statsLoading || nextLoading;
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
            value={stats?.activePlans || 0}
            icon={CreditCard}
            description={stats?.completedPlans ? `${stats.completedPlans} completed` : undefined}
          />
          <StatCard
            title="Total Paid"
            value={formatCurrency(stats?.totalPaid || 0)}
            icon={CheckCircle2}
            variant="success"
          />
          <StatCard
            title="Remaining"
            value={formatCurrency(stats?.totalRemaining || 0)}
            icon={DollarSign}
            description={stats?.upcomingCount ? `${stats.upcomingCount} payments left` : undefined}
          />
          <StatCard
            title="Overdue"
            value={stats?.overdueCount || 0}
            icon={AlertTriangle}
            variant={stats?.overdueCount ? 'danger' : 'default'}
            description={stats?.overdueCount ? 'Action required' : 'All caught up'}
          />
        </div>
      )}

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

      {/* Payment History */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Recent Payments</h2>
        <Card>
          <CardContent className="pt-6">
            <PaymentHistoryList />
          </CardContent>
        </Card>
      </div>

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
