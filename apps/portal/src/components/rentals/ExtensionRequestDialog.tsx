'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, CalendarPlus, Check, X, AlertCircle, AlertTriangle, Calendar, CreditCard, Shield, Gauge } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useExtensionConflicts } from '@/hooks/use-extension-conflicts';
import { useExtensionPricing } from '@/hooks/use-extension-pricing';
import { format } from 'date-fns';
import { getCurrencySymbol } from '@/lib/format-utils';
import { useQuery } from '@tanstack/react-query';
import { calculateTotalMileageAllowance, getMileageTier, isUnlimitedMileage } from '@/lib/mileage-utils';

interface ExtensionRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    start_date: string;
    end_date: string;
    previous_end_date: string | null;
    has_installment_plan?: boolean;
    bonzah_policy_id?: string | null;
    customer_id?: string;
    vehicle_id?: string;
    customers?: { id: string; name: string; email?: string };
    vehicles?: { id: string; reg: string; make: string; model: string };
  };
}

export function ExtensionRequestDialog({
  open,
  onOpenChange,
  rental,
}: ExtensionRequestDialogProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const currentEndDate = new Date(rental.end_date);
  const requestedEndDate = rental.previous_end_date
    ? new Date(rental.previous_end_date)
    : null;

  const { extensionCost, extensionDays, dailyRate, dayBreakdown, hasSurcharges, isLoading: loadingRate } = useExtensionPricing({
    vehicleId: rental.vehicle_id || rental.vehicles?.id,
    currentEndDate: rental.end_date,
    newEndDate: rental.previous_end_date || undefined,
  });

  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');

  // Fetch vehicle mileage data for mileage impact display
  const vId = rental.vehicle_id || rental.vehicles?.id;
  const { data: vehicleMileage } = useQuery({
    queryKey: ['vehicle-mileage-fields', vId],
    queryFn: async () => {
      if (!vId) return null;
      const { data } = await supabase
        .from('vehicles')
        .select('daily_mileage, weekly_mileage, monthly_mileage')
        .eq('id', vId)
        .single();
      return data;
    },
    enabled: !!vId,
  });

  // Compute mileage impact
  const mileageImpact = (() => {
    if (!vehicleMileage || isUnlimitedMileage(vehicleMileage)) return null;
    const currentDays = Math.max(1, Math.ceil((new Date(rental.end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    const currentAllowance = calculateTotalMileageAllowance(vehicleMileage, currentDays);
    if (!rental.previous_end_date) return { currentAllowance, newAllowance: null, currentTier: getMileageTier(currentDays), newTier: null };
    const newDays = Math.max(1, Math.ceil((new Date(rental.previous_end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    const newAllowance = calculateTotalMileageAllowance(vehicleMileage, newDays);
    return { currentAllowance, newAllowance, currentTier: getMileageTier(currentDays), newTier: getMileageTier(newDays) };
  })();

  const { rentalConflicts, blockedDateConflicts, hasConflicts, isChecking: isCheckingConflicts } = useExtensionConflicts({
    vehicleId: rental.vehicle_id || rental.vehicles?.id,
    currentEndDate: rental.end_date,
    newEndDate: rental.previous_end_date || undefined,
    excludeRentalId: rental.id,
  });

  const handleApprove = async () => {
    if (!requestedEndDate || !tenant?.id) return;

    setIsApproving(true);
    try {
      // Swap dates: end_date ↔ previous_end_date
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          end_date: rental.previous_end_date,
          previous_end_date: rental.end_date,
          is_extended: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rental.id)
        .eq('tenant_id', tenant.id);

      if (updateError) {
        throw new Error(`Failed to approve extension: ${updateError.message}`);
      }

      // Insert ledger charge for extension
      if (extensionCost > 0) {
        const { error: ledgerError } = await supabase
          .from('ledger_entries')
          .insert({
            rental_id: rental.id,
            customer_id: rental.customer_id || rental.customers?.id,
            vehicle_id: rental.vehicle_id || rental.vehicles?.id,
            tenant_id: tenant.id,
            type: 'Charge',
            category: 'Extension',
            reference: `Rental extension: ${extensionDays} day${extensionDays !== 1 ? 's' : ''} (${format(currentEndDate, 'MMM dd')} → ${format(requestedEndDate, 'MMM dd, yyyy')})`,
            amount: extensionCost,
            remaining_amount: extensionCost,
            entry_date: new Date().toISOString().split('T')[0],
            due_date: new Date().toISOString().split('T')[0],
          });
        if (ledgerError) console.error('Failed to create ledger entry:', ledgerError);
      }

      // Create Stripe checkout for extension payment
      let checkoutUrl: string | undefined;
      if (extensionCost > 0) {
        try {
          const { data: session } = await supabase.auth.getSession();
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}/functions/v1/create-extension-checkout`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session?.session?.access_token}`,
              },
              body: JSON.stringify({
                rentalId: rental.id,
                customerId: rental.customer_id || rental.customers?.id,
                vehicleId: rental.vehicle_id || rental.vehicles?.id,
                customerEmail: rental.customers?.email,
                customerName: rental.customers?.name,
                extensionAmount: extensionCost,
                extensionDays,
                newEndDate: rental.previous_end_date,
                previousEndDate: rental.end_date,
                tenantId: tenant.id,
              }),
            }
          );
          if (res.ok) {
            const result = await res.json();
            checkoutUrl = result.checkoutUrl;

            // Save checkout URL to rental for customer portal visibility
            if (checkoutUrl) {
              await supabase
                .from('rentals')
                .update({ extension_checkout_url: checkoutUrl })
                .eq('id', rental.id);
            }
          } else {
            console.error('Failed to create extension checkout:', await res.text());
          }
        } catch (err) {
          console.error('Error creating extension checkout:', err);
        }
      }

      // Send notification email
      try {
        const { data: session } = await supabase.auth.getSession();
        await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}/functions/v1/notify-rental-extended`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.session?.access_token}`,
            },
            body: JSON.stringify({
              customerName: rental.customers?.name || 'Customer',
              customerEmail: rental.customers?.email || '',
              vehicleMake: rental.vehicles?.make || '',
              vehicleModel: rental.vehicles?.model || '',
              vehicleReg: rental.vehicles?.reg || '',
              bookingRef: rental.id.substring(0, 8).toUpperCase(),
              previousEndDate: format(currentEndDate, 'MMM dd, yyyy'),
              newEndDate: format(requestedEndDate, 'MMM dd, yyyy'),
              extensionDays,
              extensionAmount: extensionCost,
              paymentUrl: checkoutUrl,
              tenantId: tenant.id,
              newMileageAllowance: mileageImpact?.newAllowance?.toLocaleString() || '',
              distanceUnit: tenant?.distance_unit || 'miles',
            }),
          }
        );
      } catch (notifyErr) {
        console.error('Failed to send extension notification:', notifyErr);
      }

      // Create in-app notification for customer
      if (rental.customers?.id) {
        const { data: customerUser } = await supabase
          .from('customer_users')
          .select('id')
          .eq('customer_id', rental.customers.id)
          .maybeSingle();

        if (customerUser?.id) {
          await supabase.from('customer_notifications').insert({
            customer_user_id: customerUser.id,
            tenant_id: tenant.id,
            title: 'Extension Approved',
            message: `Your extension request for ${rental.vehicles?.make} ${rental.vehicles?.model} has been approved. New end date: ${format(requestedEndDate, 'MMM dd, yyyy')}.${extensionCost > 0 ? ` Extension fee: ${currencySymbol}${extensionCost.toFixed(2)}. A payment link has been sent to your email.` : ''}${mileageImpact?.newAllowance ? ` Your new mileage allowance is ${mileageImpact.newAllowance.toLocaleString()} ${tenant?.distance_unit || 'miles'}.` : ''}`,
            type: 'success',
            link: '/portal/bookings',
          });
        }
      }

      // Auto-send extension agreement (fire-and-forget)
      try {
        fetch('/api/esign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rentalId: rental.id,
            customerEmail: rental.customers?.email,
            customerName: rental.customers?.name,
            tenantId: tenant.id,
            agreementType: 'extension',
            extensionPreviousEndDate: rental.end_date,
            extensionNewEndDate: rental.previous_end_date,
          }),
        }).then(res => {
          if (!res.ok) console.error('Extension agreement send failed:', res.status);
          else console.log('Extension agreement sent successfully');
        }).catch(err => console.error('Extension agreement send error:', err));
      } catch (e) {
        console.error('Failed to trigger extension agreement:', e);
      }

      // Auto-create extension insurance (fire-and-forget)
      if (rental.bonzah_policy_id) {
        try {
          const { data: originalPolicy } = await supabase
            .from('bonzah_insurance_policies')
            .select('coverage_types, pickup_state, renter_details, status')
            .eq('id', rental.bonzah_policy_id)
            .single();

          if (originalPolicy?.status === 'active' && originalPolicy.coverage_types) {
            const ct = originalPolicy.coverage_types as any;
            const hasCoverage = ct.cdw || ct.rcli || ct.sli || ct.pai;

            if (hasCoverage && rental.previous_end_date) {
              // Gap period: current end_date → requested new end_date (previous_end_date after swap)
              const { data: quoteResult } = await supabase.functions.invoke('bonzah-create-quote', {
                body: {
                  rental_id: rental.id,
                  customer_id: rental.customer_id || rental.customers?.id,
                  tenant_id: tenant.id,
                  trip_dates: {
                    start: rental.end_date.split('T')[0],
                    end: rental.previous_end_date.split('T')[0],
                  },
                  pickup_state: originalPolicy.pickup_state,
                  coverage: { cdw: !!ct.cdw, rcli: !!ct.rcli, sli: !!ct.sli, pai: !!ct.pai },
                  renter: originalPolicy.renter_details,
                  policy_type: 'extension',
                },
              });

              if (quoteResult?.policy_record_id) {
                await supabase.functions.invoke('bonzah-confirm-payment', {
                  body: {
                    policy_record_id: quoteResult.policy_record_id,
                    stripe_payment_intent_id: `portal-extension-${rental.id}`,
                  },
                });
              }

              queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rental.id] });
              queryClient.invalidateQueries({ queryKey: ['bonzah-balance'] });
            }
          }
        } catch (insuranceErr) {
          console.error('Extension insurance auto-create failed (non-blocking):', insuranceErr);
        }
      }

      toast({
        title: 'Extension Approved',
        description: `Rental extended to ${format(requestedEndDate, 'MMMM dd, yyyy')}.${extensionCost > 0 ? ` Extension charge of ${currencySymbol}${extensionCost.toFixed(2)} created with payment link sent to customer.` : ' Customer has been notified.'} An extension agreement has been sent for signing.`,
      });

      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['rental-agreements', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rental.id] });

      logAction({
        action: "rental_extension_approved",
        entityType: "rental",
        entityId: rental.id,
        details: { newEndDate: rental.previous_end_date, previousEndDate: rental.end_date, extensionDays, extensionCost },
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error('Extension approval error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to approve extension',
        variant: 'destructive',
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!tenant?.id) return;

    setIsRejecting(true);
    try {
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          is_extended: false,
          previous_end_date: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rental.id)
        .eq('tenant_id', tenant.id);

      if (updateError) {
        throw new Error(`Failed to reject extension: ${updateError.message}`);
      }

      // Create in-app notification for customer
      if (rental.customers?.id) {
        const { data: customerUser } = await supabase
          .from('customer_users')
          .select('id')
          .eq('customer_id', rental.customers.id)
          .maybeSingle();

        if (customerUser?.id) {
          await supabase.from('customer_notifications').insert({
            customer_user_id: customerUser.id,
            tenant_id: tenant.id,
            title: 'Extension Request Declined',
            message: `Your extension request for ${rental.vehicles?.make} ${rental.vehicles?.model} could not be approved. Please contact support if you have questions.`,
            type: 'alert',
            link: '/portal/bookings',
          });
        }
      }

      toast({
        title: 'Extension Rejected',
        description: 'The extension request has been declined. Customer has been notified.',
      });

      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });

      logAction({
        action: "rental_extension_rejected",
        entityType: "rental",
        entityId: rental.id,
        details: { requestedEndDate: rental.previous_end_date },
      });

      onOpenChange(false);
    } catch (error: any) {
      console.error('Extension rejection error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to reject extension',
        variant: 'destructive',
      });
    } finally {
      setIsRejecting(false);
    }
  };

  const isProcessing = isApproving || isRejecting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-amber-600" />
            Extension Request
          </DialogTitle>
          <DialogDescription>
            {rental.customers?.name} has requested to extend their rental.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Vehicle Info */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">
              {rental.vehicles?.make} {rental.vehicles?.model}
            </Badge>
            <span>•</span>
            <span>{rental.vehicles?.reg}</span>
          </div>

          {/* Date Comparison */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">
                  Current End Date
                </span>
              </div>
              <p className="font-medium">{format(currentEndDate, 'MMM dd, yyyy')}</p>
            </div>

            <div className="border rounded-lg p-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 mb-1">
                <CalendarPlus className="h-4 w-4 text-amber-600" />
                <span className="text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                  Requested Date
                </span>
              </div>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {requestedEndDate ? format(requestedEndDate, 'MMM dd, yyyy') : 'N/A'}
              </p>
            </div>
          </div>

          {/* Extension Duration */}
          {requestedEndDate && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This extends the rental by <strong>{extensionDays} days</strong>.
              </AlertDescription>
            </Alert>
          )}

          {/* Availability Conflict Warning */}
          {isCheckingConflicts && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking vehicle availability...
            </div>
          )}
          {hasConflicts && !isCheckingConflicts && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="space-y-1">
                <p className="font-medium">Vehicle has scheduling conflicts for the requested dates:</p>
                {rentalConflicts.map((c) => (
                  <p key={c.id} className="text-xs">
                    Rental for {c.customerName} ({format(new Date(c.start_date), 'MMM dd')} – {format(new Date(c.end_date), 'MMM dd')})
                  </p>
                ))}
                {blockedDateConflicts.map((c) => (
                  <p key={c.id} className="text-xs">
                    Blocked: {c.reason || 'No reason'} ({format(new Date(c.start_date), 'MMM dd')} – {format(new Date(c.end_date), 'MMM dd')})
                  </p>
                ))}
                <p className="text-xs font-medium pt-1">Consider rejecting this request or resolving the conflict first.</p>
              </AlertDescription>
            </Alert>
          )}

          {/* Cost Preview */}
          {extensionDays > 0 && (
            <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-blue-600" />
                <span className="text-xs text-blue-700 dark:text-blue-400 uppercase tracking-wider font-medium">
                  Extension Cost
                </span>
              </div>
              {loadingRate ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Calculating...
                </div>
              ) : dailyRate ? (
                <div>
                  <p className="text-lg font-bold text-blue-700 dark:text-blue-300">
                    {currencySymbol}{extensionCost.toFixed(2)}
                  </p>
                  {hasSurcharges ? (
                    <div className="space-y-0.5 mt-1">
                      {(() => {
                        const groups: Record<string, { count: number; rate: number; label: string }> = {};
                        dayBreakdown.forEach((d) => {
                          const key = `${d.type}-${d.effectiveRate}`;
                          if (!groups[key]) {
                            const label = d.type === 'holiday' ? (d.holidayName || 'Holiday') : d.type === 'weekend' ? 'Weekend' : 'Weekday';
                            groups[key] = { count: 0, rate: d.effectiveRate, label };
                          }
                          groups[key].count++;
                        });
                        return Object.values(groups).map((g, i) => (
                          <p key={i} className="text-xs text-blue-600 dark:text-blue-400">
                            {g.label} — {currencySymbol}{g.rate.toFixed(2)}/day x {g.count} day{g.count !== 1 ? 's' : ''}
                          </p>
                        ));
                      })()}
                    </div>
                  ) : (
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      {extensionDays} day{extensionDays !== 1 ? 's' : ''} x {currencySymbol}{dailyRate.toFixed(2)}/day
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {extensionDays} day{extensionDays !== 1 ? 's' : ''} (daily rate not available)
                </p>
              )}
            </div>
          )}

          {/* Mileage Impact */}
          {extensionDays > 0 && mileageImpact && mileageImpact.newAllowance !== null && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center gap-2 mb-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                  Mileage Allowance
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {mileageImpact.currentAllowance?.toLocaleString()} {tenant?.distance_unit || 'miles'}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="text-sm font-medium text-primary">
                  {mileageImpact.newAllowance?.toLocaleString()} {tenant?.distance_unit || 'miles'}
                </span>
                {mileageImpact.currentTier !== mileageImpact.newTier && (
                  <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                    {mileageImpact.currentTier} → {mileageImpact.newTier}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Installment Plan Warning */}
          {rental.has_installment_plan && extensionDays > 0 && (
            <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 dark:text-amber-400">
                This rental has an active installment plan. The extension charge will be separate from the installment schedule.
              </AlertDescription>
            </Alert>
          )}

          {/* Insurance Info */}
          {rental.bonzah_policy_id && extensionDays > 0 && (
            <Alert className="border-blue-300 bg-blue-50 dark:bg-blue-900/20">
              <Shield className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700 dark:text-blue-400">
                An extension insurance policy will be auto-created for the gap period using the same coverage as the original policy.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={isProcessing}
            className="flex-1 sm:flex-none"
          >
            {isRejecting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Rejecting...
              </>
            ) : (
              <>
                <X className="h-4 w-4 mr-2" />
                Reject
              </>
            )}
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isProcessing || !requestedEndDate}
            className="flex-1 sm:flex-none"
          >
            {isApproving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Approving...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Approve
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
