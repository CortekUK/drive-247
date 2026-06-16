'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Calendar, Car, MapPin, CreditCard, Clock, AlertCircle, AlertTriangle, Pencil, CalendarPlus, XCircle, RefreshCw, ExternalLink, Lock, FileSignature, Gauge, Zap, Loader2 } from 'lucide-react';
import { format, differenceInDays, isPast, isToday } from 'date-fns';
import { parseDateString } from '@/lib/calculate-rental-price';
import { CustomerRental } from '@/hooks/use-customer-rentals';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, getUnlimitedLabel, getDistanceUnitShort, type DistanceUnit } from '@/lib/format-utils';
import { isUnlimitedMileage, calculateTotalMileageAllowance } from '@/lib/mileage-utils';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { EditInsuranceDialog } from './EditInsuranceDialog';
import { ExtendRentalDialog } from './ExtendRentalDialog';
import { CancelBookingDialog } from './CancelBookingDialog';
import { RenewRentalDialog } from './RenewRentalDialog';
import { RentalTimeline } from './RentalTimeline';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface RentalCardProps {
  rental: CustomerRental;
  insuranceReuploadRequired?: boolean;
}

function getStatusBadgeVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'Active':
      return 'default';
    case 'Pending':
    case 'Reserved':
      return 'secondary';
    case 'Completed':
    case 'Ended':
      return 'outline';
    case 'Cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function RentalCard({ rental, insuranceReuploadRequired }: RentalCardProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const currencyCode = tenant?.currency_code || 'GBP';
  const [showEditInsurance, setShowEditInsurance] = useState(false);
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showRenewDialog, setShowRenewDialog] = useState(false);
  const [showCancelExtension, setShowCancelExtension] = useState(false);
  const vehicle = rental.vehicles;

  // Cancel extension request mutation
  const cancelExtension = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('rentals')
        .update({ is_extended: false, previous_end_date: null })
        .eq('id', rental.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-rentals'] });
      toast.success('Extension request cancelled');
      setShowCancelExtension(false);
    },
    onError: () => {
      toast.error('Failed to cancel extension request');
    },
  });

  // Fetch supercharger charges for this rental (if any)
  const { data: superchargerData } = useQuery({
    queryKey: ['supercharger-charges-customer', rental.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tesla_supercharger_charges')
        .select('amount, status, charged_amount')
        .eq('rental_id', rental.id);
      if (error) return null;
      if (!data?.length) return null;
      const total = data.reduce((sum: number, c: any) => sum + Number(c.amount), 0);
      const pendingCount = data.filter((c: any) => c.status === 'pending').length;
      const chargedTotal = data
        .filter((c: any) => c.status === 'charged')
        .reduce((sum: number, c: any) => sum + Number(c.charged_amount || c.amount), 0);
      return { total, count: data.length, pendingCount, chargedTotal };
    },
    enabled: !!rental.id,
  });
  const distanceUnit = (tenant?.distance_unit || 'miles') as DistanceUnit;

  // Check if booking can be edited (only Pending status)
  const canEditInsurance = rental.status === 'Pending';
  // Check if rental can be extended (Active status and no pending extension)
  const canExtend = rental.status === 'Active' && !rental.is_extended;
  const hasExtensionPending = rental.is_extended === true;
  // Check if booking can be cancelled (Pending status and no pending cancellation)
  const canCancel = rental.status === 'Pending' && !rental.cancellation_requested;
  const hasCancellationPending = rental.cancellation_requested === true;
  // Check if rental can be renewed (Closed/completed status)
  const canRenew = rental.status === 'Closed' || (rental.status === 'Active' && isPast(parseDateString(rental.end_date)) && !isToday(parseDateString(rental.end_date)));
  // Check if agreement needs signing
  const hasSignedAgreement = !!rental.docusign_envelope_id &&
    (rental.document_status === 'signed' || rental.document_status === 'completed' || !!rental.signed_document_id);
  const hasUnsignedAgreement = !!rental.docusign_envelope_id && !hasSignedAgreement;
  const vehicleName = vehicle
    ? vehicle.make && vehicle.model
      ? `${vehicle.make} ${vehicle.model}`
      : vehicle.reg
    : 'Vehicle';

  const vehicleImage =
    vehicle?.photo_url ||
    vehicle?.vehicle_photos?.[0]?.photo_url ||
    '/placeholder.svg';

  const durationDays = differenceInDays(
    parseDateString(rental.end_date),
    parseDateString(rental.start_date)
  );

  const mtd = tenant?.monthly_tier_days ?? 30;
  const formatDuration = (days: number): string => {
    if (days >= mtd) {
      const months = Math.floor(days / mtd);
      const remainingDays = days % mtd;
      return remainingDays > 0
        ? `${months} month${months > 1 ? 's' : ''} ${remainingDays} day${remainingDays > 1 ? 's' : ''}`
        : `${months} month${months > 1 ? 's' : ''}`;
    }
    if (days >= 7) {
      const weeks = Math.floor(days / 7);
      const remainingDays = days % 7;
      return remainingDays > 0
        ? `${weeks} week${weeks > 1 ? 's' : ''} ${remainingDays} day${remainingDays > 1 ? 's' : ''}`
        : `${weeks} week${weeks > 1 ? 's' : ''}`;
    }
    return `${days} day${days > 1 ? 's' : ''}`;
  };

  // Get installment plan info
  const installmentPlan = rental.installment_plans?.[0];
  const hasInstallments = rental.has_installment_plan && installmentPlan;

  // Calculate installment progress
  const paidInstallments = installmentPlan?.paid_installments || 0;
  const totalInstallments = installmentPlan?.number_of_installments || 0;
  const progressPercent = totalInstallments > 0 ? (paidInstallments / totalInstallments) * 100 : 0;

  // Calculate paid amounts
  const totalPaid = hasInstallments
    ? (installmentPlan.total_paid || 0) + (installmentPlan.upfront_paid ? (installmentPlan.upfront_amount || 0) : 0)
    : rental.monthly_amount || 0;
  const chargeFirst = (installmentPlan as any)?.config?.charge_first_upfront !== false;
  const firstInstAmt = chargeFirst ? (installmentPlan?.installment_amount || 0) : 0;
  const totalAmount = hasInstallments
    ? (installmentPlan.total_installable_amount || 0) + (installmentPlan.upfront_amount || 0) - firstInstAmt
    : rental.monthly_amount || 0;

  // Get next scheduled installment
  const nextInstallment = hasInstallments
    ? installmentPlan.scheduled_installments
        ?.filter((i) => i.status === 'scheduled' || i.status === 'failed')
        .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
    : null;

  const isOverdue = nextInstallment && isPast(parseDateString(nextInstallment.due_date)) && !isToday(parseDateString(nextInstallment.due_date));
  const isFailed = nextInstallment?.status === 'failed';

  return (
    <Card className={cn(
      'overflow-hidden hover:shadow-md transition-shadow',
      (isOverdue || isFailed) && 'border-red-300 dark:border-red-800',
      insuranceReuploadRequired && !isOverdue && !isFailed && 'border-amber-300 dark:border-amber-800'
    )}>
      <div className="flex flex-col sm:flex-row">
        {/* Vehicle Image */}
        <div className="sm:w-48 h-32 sm:h-auto bg-muted relative">
          <img
            src={vehicleImage}
            alt={vehicleName}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = '/placeholder.svg';
            }}
          />
          {hasInstallments && (
            <div className="absolute bottom-2 left-2">
              <Badge variant="secondary" className="text-xs bg-black/70 text-white">
                <CreditCard className="h-3 w-3 mr-1" />
                {installmentPlan.plan_type.charAt(0).toUpperCase() + installmentPlan.plan_type.slice(1)}
              </Badge>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-lg">{vehicleName}</h3>
                {vehicle?.reg && (
                  <p className="text-sm text-muted-foreground">
                    {vehicle.colour && `${vehicle.colour} • `}
                    {vehicle.reg}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant={getStatusBadgeVariant(rental.status)}>
                  {rental.status}
                </Badge>
                {insuranceReuploadRequired && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Insurance Required
                  </Badge>
                )}
                {hasExtensionPending && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                    Extension Pending
                  </Badge>
                )}
                {hasCancellationPending && (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
                    Cancellation Requested
                  </Badge>
                )}
                {hasUnsignedAgreement && (
                  <Link href="/portal/agreements" onClick={(e) => e.stopPropagation()}>
                    <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors">
                      <FileSignature className="h-3 w-3 mr-1" />
                      Sign Agreement
                    </Badge>
                  </Link>
                )}
                {hasSignedAgreement && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">
                    <FileSignature className="h-3 w-3 mr-1" />
                    Agreement Signed
                  </Badge>
                )}
                {canEditInsurance && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowEditInsurance(true);
                    }}
                    title="Update Insurance"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {canRenew && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowRenewDialog(true);
                    }}
                    title="Renew Rental"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <div className="grid gap-2 text-sm">
              {/* Dates */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>
                  {format(parseDateString(rental.start_date), 'MMM dd, yyyy')} -{' '}
                  {format(parseDateString(rental.end_date), 'MMM dd, yyyy')}
                </span>
              </div>

              {/* Pending Extension Info */}
              {hasExtensionPending && rental.previous_end_date && (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                    <CalendarPlus className="h-4 w-4" />
                    <span className="text-sm">
                      Requested: {format(parseDateString(rental.previous_end_date), 'MMM dd, yyyy')}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowCancelExtension(true);
                    }}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              )}

              {/* Duration */}
              <div className="flex items-center gap-2 text-muted-foreground">
                <Car className="h-4 w-4" />
                <span>{formatDuration(durationDays)}</span>
              </div>

              {/* Location */}
              {rental.pickup_location && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span className="truncate">{rental.pickup_location}</span>
                </div>
              )}

              {/* Lockbox delivery indicator */}
              {rental.delivery_method === 'lockbox' && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  <span>Keys via secure lockbox</span>
                </div>
              )}

              {/* Mileage Allowance */}
              {vehicle && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Gauge className="h-4 w-4" />
                  {isUnlimitedMileage(vehicle) ? (
                    <span>{getUnlimitedLabel(distanceUnit)}</span>
                  ) : (
                    <span>
                      {(() => {
                        const totalAllowance = calculateTotalMileageAllowance(vehicle, durationDays, mtd);
                        if (totalAllowance === null) return getUnlimitedLabel(distanceUnit);
                        return `${totalAllowance.toLocaleString()} ${getDistanceUnitShort(distanceUnit)} allowance`;
                      })()}
                      {vehicle.excess_mileage_rate != null && (
                        <span className="text-muted-foreground/70">
                          {' '}· {formatCurrency(vehicle.excess_mileage_rate, currencyCode)}/{getDistanceUnitShort(distanceUnit)} excess
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}

              {/* Supercharger Charges */}
              {superchargerData && superchargerData.count > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Zap className="h-4 w-4 text-red-500" />
                  <span>
                    Supercharger: {formatCurrency(superchargerData.chargedTotal || superchargerData.total, currencyCode)}
                    {superchargerData.pendingCount > 0 && (
                      <span className="text-amber-600 ml-1">
                        ({superchargerData.pendingCount} pending)
                      </span>
                    )}
                  </span>
                </div>
              )}

              {/* Insurance Re-upload Alert */}
              {insuranceReuploadRequired && (
                <div
                  className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowEditInsurance(true);
                  }}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="text-sm">Please re-upload your insurance document</span>
                </div>
              )}

              {/* Extension Info - shown when rental was extended and has unpaid extension */}
              {rental.previous_end_date && !rental.is_extended && rental.status === 'Active' && rental.extension_checkout_url && (
                <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-2">
                  <div className="flex items-center gap-2">
                    <CalendarPlus className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      Rental Extended
                    </span>
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    Extended from {format(parseDateString(rental.previous_end_date), 'MMM dd')} to {format(parseDateString(rental.end_date), 'MMM dd, yyyy')}
                  </p>
                  <button
                    className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const btn = e.currentTarget;
                      btn.disabled = true;
                      btn.textContent = 'Loading...';
                      try {
                        const extAmount = rental.extension_amount;
                        if (!extAmount || extAmount <= 0) {
                          window.location.href = rental.extension_checkout_url!;
                          return;
                        }
                        const { data, error } = await supabase.functions.invoke('create-checkout-session', {
                          body: {
                            rentalId: rental.id,
                            totalAmount: extAmount,
                            tenantId: tenant?.id,
                            customerEmail: rental.customers?.email,
                            source: 'booking',
                            targetCategories: ['Extension Rental', 'Extension Tax', 'Extension Service Fee', 'Extension Insurance'],
                            successUrl: `${window.location.origin}/booking-success?session_id={CHECKOUT_SESSION_ID}&rental_id=${rental.id}&type=invoice`,
                            cancelUrl: `${window.location.origin}/portal/bookings`,
                          },
                        });
                        if (error) throw error;
                        if (data?.url) {
                          window.location.href = data.url;
                        } else {
                          window.location.href = rental.extension_checkout_url!;
                        }
                      } catch (err) {
                        window.location.href = rental.extension_checkout_url!;
                      }
                    }}
                  >
                    <CreditCard className="h-4 w-4" />
                    Pay Extension Fee
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Agreements & Insurance Timeline */}
              <RentalTimeline rentalId={rental.id} />

              {/* Installment Info */}
              {hasInstallments ? (
                <div className="pt-2 border-t mt-2 space-y-2">
                  {/* Progress */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">
                        {paidInstallments} of {totalInstallments} installments
                      </span>
                      <span className="font-medium">{Math.round(progressPercent)}%</span>
                    </div>
                    <Progress value={progressPercent} className="h-1.5" />
                  </div>

                  {/* Paid / Total */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-muted-foreground">Paid</span>
                      <p className="font-medium text-green-600">{formatCurrency(totalPaid, currencyCode)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-muted-foreground">Total</span>
                      <p className="font-semibold">{formatCurrency(totalAmount, currencyCode)}</p>
                    </div>
                  </div>

                  {/* Next Payment */}
                  {nextInstallment && (
                    <Link href="/portal/payments">
                      <div className={cn(
                        'flex items-center justify-between p-2 rounded-lg -mx-2 cursor-pointer transition-colors',
                        isOverdue || isFailed
                          ? 'bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50'
                          : 'bg-muted/50 hover:bg-muted'
                      )}>
                        <div className="flex items-center gap-2">
                          {isOverdue || isFailed ? (
                            <AlertCircle className="h-4 w-4 text-red-600" />
                          ) : (
                            <Clock className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div>
                            <p className={cn(
                              'text-xs font-medium',
                              (isOverdue || isFailed) && 'text-red-700 dark:text-red-400'
                            )}>
                              {isOverdue ? 'Overdue' : isFailed ? 'Payment Failed' : 'Next Payment'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(parseDateString(nextInstallment.due_date), 'MMM dd, yyyy')}
                            </p>
                          </div>
                        </div>
                        <span className={cn(
                          'font-semibold',
                          (isOverdue || isFailed) ? 'text-red-600' : ''
                        )}>
                          {formatCurrency(nextInstallment.amount, currencyCode)}
                        </span>
                      </div>
                    </Link>
                  )}

                  {/* Completed badge */}
                  {installmentPlan.status === 'completed' && (
                    <div className="flex items-center gap-2 text-green-600 bg-green-50 dark:bg-green-900/20 p-2 rounded-lg -mx-2">
                      <CreditCard className="h-4 w-4" />
                      <span className="text-sm font-medium">All installments paid</span>
                    </div>
                  )}
                </div>
              ) : (
                /* Non-installment: Simple total */
                <div className="pt-2 flex items-center justify-between border-t mt-2">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold text-lg">
                    {formatCurrency(rental.monthly_amount || 0, currencyCode)}
                  </span>
                </div>
              )}

              {/* Requests section */}
              {(canExtend || canCancel) && (
                <div className="pt-2 border-t mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">Requests:</span>
                  {canExtend && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowExtendDialog(true);
                      }}
                    >
                      <CalendarPlus className="h-3 w-3 mr-1" />
                      Extension
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowCancelDialog(true);
                      }}
                    >
                      <XCircle className="h-3 w-3 mr-1" />
                      Cancellation
                    </Button>
                  )}
                </div>
              )}

            </div>
          </CardContent>
        </div>
      </div>

      {/* Edit Insurance Dialog */}
      <EditInsuranceDialog
        open={showEditInsurance}
        onOpenChange={setShowEditInsurance}
        rental={rental}
      />

      {/* Extend Rental Dialog */}
      <ExtendRentalDialog
        open={showExtendDialog}
        onOpenChange={setShowExtendDialog}
        rental={rental}
      />

      {/* Cancel Booking Dialog */}
      <CancelBookingDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        rental={rental}
      />

      {/* Renew Rental Dialog */}
      <RenewRentalDialog
        open={showRenewDialog}
        onOpenChange={setShowRenewDialog}
        rental={rental}
      />

      {/* Cancel Extension Request Dialog */}
      <AlertDialog open={showCancelExtension} onOpenChange={setShowCancelExtension}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Extension Request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel your request to extend until {rental.previous_end_date ? format(parseDateString(rental.previous_end_date), 'MMM dd, yyyy') : ''}. You can submit a new extension request later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Request</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelExtension.mutate()}
              disabled={cancelExtension.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {cancelExtension.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Cancel Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
