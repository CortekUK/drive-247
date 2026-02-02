'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  Banknote,
  CreditCard,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  XCircle,
  Loader2,
  RotateCcw,
  Ban,
} from 'lucide-react';
import { format } from 'date-fns';
import { useInstallmentPlan, InstallmentPlanWithSchedule, ScheduledInstallment } from '@/hooks/use-installment-plan';

interface InstallmentPlanCardProps {
  rentalId: string;
  formatCurrency: (amount: number) => string;
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'active':
      return <Badge variant="default" className="bg-green-500">Active</Badge>;
    case 'completed':
      return <Badge variant="default" className="bg-blue-500">Completed</Badge>;
    case 'overdue':
      return <Badge variant="destructive">Overdue</Badge>;
    case 'cancelled':
      return <Badge variant="secondary">Cancelled</Badge>;
    case 'pending':
      return <Badge variant="outline">Pending</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

const getInstallmentStatusIcon = (status: string) => {
  switch (status) {
    case 'paid':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'scheduled':
      return <Clock className="h-4 w-4 text-blue-500" />;
    case 'processing':
      return <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'overdue':
      return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case 'cancelled':
      return <Ban className="h-4 w-4 text-gray-500" />;
    default:
      return <Clock className="h-4 w-4 text-gray-500" />;
  }
};

export default function InstallmentPlanCard({ rentalId, formatCurrency }: InstallmentPlanCardProps) {
  const {
    plan,
    isLoading,
    hasInstallmentPlan,
    retryPayment,
    isRetrying,
    cancelPlan,
    isCancelling,
    markPaid,
    isMarkingPaid,
  } = useInstallmentPlan(rentalId);

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!hasInstallmentPlan || !plan) {
    return null; // Don't render anything if no installment plan
  }

  const progressPercent = (plan.paid_installments / plan.number_of_installments) * 100;
  const totalContractValue = plan.upfront_amount + plan.total_installable_amount;
  const totalPaidAmount = plan.upfront_paid ? plan.upfront_amount + plan.total_paid : plan.total_paid;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Installment Plan</CardTitle>
          </div>
          {getStatusBadge(plan.status)}
        </div>
        <CardDescription>
          {plan.plan_type === 'weekly' ? 'Weekly' : 'Monthly'} payment plan ({plan.number_of_installments} payments)
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Overview */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-medium">
              {plan.paid_installments} of {plan.number_of_installments} paid
            </span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Financial Summary */}
        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
          <div>
            <p className="text-xs text-muted-foreground">Upfront Paid</p>
            <p className="text-lg font-semibold">
              {plan.upfront_paid ? (
                <span className="text-green-600">{formatCurrency(plan.upfront_amount)}</span>
              ) : (
                <span className="text-orange-600">{formatCurrency(plan.upfront_amount)} (Pending)</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Installments Paid</p>
            <p className="text-lg font-semibold">
              {formatCurrency(plan.total_paid)} / {formatCurrency(plan.total_installable_amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Per Installment</p>
            <p className="text-lg font-semibold">{formatCurrency(plan.installment_amount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Contract</p>
            <p className="text-lg font-semibold">{formatCurrency(totalContractValue)}</p>
          </div>
        </div>

        {/* Next Due Date */}
        {plan.next_due_date && plan.status === 'active' && (
          <div className="flex items-center gap-2 p-3 border rounded-lg bg-blue-50 dark:bg-blue-950">
            <Calendar className="h-4 w-4 text-blue-600" />
            <span className="text-sm">
              Next payment due: <strong>{format(new Date(plan.next_due_date), 'MMM d, yyyy')}</strong>
            </span>
          </div>
        )}

        {/* Payment Schedule Table */}
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.scheduled_installments.map((installment) => (
                <TableRow key={installment.id}>
                  <TableCell className="font-medium">{installment.installment_number}</TableCell>
                  <TableCell>{format(new Date(installment.due_date), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="text-right">{formatCurrency(installment.amount)}</TableCell>
                  <TableCell className="text-center">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-center gap-1">
                            {getInstallmentStatusIcon(installment.status)}
                            <span className="text-xs capitalize">{installment.status}</span>
                          </div>
                        </TooltipTrigger>
                        {installment.last_failure_reason && (
                          <TooltipContent>
                            <p className="text-xs">{installment.last_failure_reason}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell>
                    {(installment.status === 'failed' || installment.status === 'overdue') && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => retryPayment(installment.id)}
                          disabled={isRetrying}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markPaid({ installmentId: installment.id })}
                          disabled={isMarkingPaid}
                        >
                          <CheckCircle className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {installment.paid_at && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(installment.paid_at), 'MMM d')}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Saved Card Info */}
        {plan.stripe_payment_method_id && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="h-4 w-4" />
            <span>Card on file for automatic payments</span>
          </div>
        )}

        {/* Actions */}
        {plan.status === 'active' && (
          <div className="flex justify-end">
            <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Ban className="h-4 w-4 mr-2" />
                  Cancel Plan
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel Installment Plan</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will cancel all remaining scheduled payments. Already paid installments will not be affected.
                    Are you sure you want to continue?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Plan</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      cancelPlan('Cancelled by admin');
                      setCancelDialogOpen(false);
                    }}
                    disabled={isCancelling}
                  >
                    {isCancelling ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    Cancel Plan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* Overdue Warning */}
        {plan.status === 'overdue' && (
          <div className="flex items-start gap-2 p-3 border rounded-lg bg-red-50 dark:bg-red-950 border-red-200">
            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-600">Payment Overdue</p>
              <p className="text-xs text-muted-foreground">
                One or more installments have failed multiple times. Please contact the customer or manually mark as paid.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
