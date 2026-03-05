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
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CalendarPlus, Calendar, AlertCircle, AlertTriangle, CreditCard, ArrowLeft, Shield, Gauge } from 'lucide-react';
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

interface AdminExtendRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    start_date: string;
    end_date: string;
    has_installment_plan?: boolean;
    bonzah_policy_id?: string | null;
    customer_id?: string;
    vehicle_id?: string;
    customers?: { id: string; name: string; email?: string };
    vehicles?: { id: string; reg: string; make: string; model: string };
  };
}

export function AdminExtendRentalDialog({
  open,
  onOpenChange,
  rental,
}: AdminExtendRentalDialogProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();

  const [newEndDate, setNewEndDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const currentEndDate = new Date(rental.end_date);
  const minDate = format(
    new Date(currentEndDate.getTime() + 24 * 60 * 60 * 1000),
    'yyyy-MM-dd'
  );

  const { extensionCost, extensionDays, dailyRate, dayBreakdown, hasSurcharges, isLoading: loadingRate } = useExtensionPricing({
    vehicleId: rental.vehicles?.id,
    currentEndDate: rental.end_date,
    newEndDate: newEndDate || undefined,
  });

  // Fetch vehicle mileage data for mileage impact display
  const vehicleId = rental.vehicles?.id || rental.vehicle_id;
  const { data: vehicleMileage } = useQuery({
    queryKey: ['vehicle-mileage-fields', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;
      const { data } = await supabase
        .from('vehicles')
        .select('daily_mileage, weekly_mileage, monthly_mileage')
        .eq('id', vehicleId)
        .single();
      return data;
    },
    enabled: !!vehicleId,
  });

  // Compute mileage impact
  const mileageImpact = (() => {
    if (!vehicleMileage || isUnlimitedMileage(vehicleMileage)) return null;
    const currentDays = Math.max(1, Math.ceil((new Date(rental.end_date).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    const currentAllowance = calculateTotalMileageAllowance(vehicleMileage, currentDays);
    if (!newEndDate) return { currentAllowance, newAllowance: null, currentTier: getMileageTier(currentDays), newTier: null };
    const newDays = Math.max(1, Math.ceil((new Date(newEndDate).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    const newAllowance = calculateTotalMileageAllowance(vehicleMileage, newDays);
    return { currentAllowance, newAllowance, currentTier: getMileageTier(currentDays), newTier: getMileageTier(newDays) };
  })();

  const { rentalConflicts, blockedDateConflicts, hasConflicts, isChecking: isCheckingConflicts } = useExtensionConflicts({
    vehicleId: rental.vehicles?.id,
    currentEndDate: rental.end_date,
    newEndDate: newEndDate || undefined,
    excludeRentalId: rental.id,
  });

  const handleNextStep = () => {
    if (!newEndDate || extensionDays <= 0) return;
    setStep(2);
  };

  const handleBack = () => {
    setStep(1);
  };

  const handleExtend = async () => {
    if (!newEndDate || !tenant?.id) return;

    setIsSubmitting(true);
    try {
      // 1. Update rental dates
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          end_date: newEndDate,
          previous_end_date: rental.end_date,
          is_extended: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rental.id)
        .eq('tenant_id', tenant.id);

      if (updateError) {
        throw new Error(`Failed to extend rental: ${updateError.message}`);
      }

      // 2. Insert ledger charge for extension
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
            reference: `Rental extension: ${extensionDays} day${extensionDays !== 1 ? 's' : ''} (${format(currentEndDate, 'MMM dd')} → ${format(new Date(newEndDate), 'MMM dd, yyyy')})`,
            amount: extensionCost,
            remaining_amount: extensionCost,
            entry_date: new Date().toISOString().split('T')[0],
            due_date: new Date().toISOString().split('T')[0],
          });
        if (ledgerError) console.error('Failed to create ledger entry:', ledgerError);
      }

      // 3. Create Stripe checkout for extension payment
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
                newEndDate,
                previousEndDate: rental.end_date,
                tenantId: tenant.id,
              }),
            }
          );
          if (res.ok) {
            const result = await res.json();
            checkoutUrl = result.checkoutUrl;
            console.log('Extension checkout created:', result.sessionId);

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

      // 4. Send notification email
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
              newEndDate: format(new Date(newEndDate), 'MMM dd, yyyy'),
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

      // 5. Create admin notification
      await supabase.from('notifications').insert({
        tenant_id: tenant.id,
        type: 'booking',
        title: 'Rental Extended',
        message: `${rental.vehicles?.make} ${rental.vehicles?.model} (${rental.vehicles?.reg}) extended by ${extensionDays} days for ${rental.customers?.name}. Extension cost: ${tenant?.currency_code || '$'}${extensionCost.toFixed(2)}`,
        link: `/rentals/${rental.id}`,
      });

      // 6. Create in-app notification for customer
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
            title: 'Rental Extended',
            message: `Your rental for ${rental.vehicles?.make} ${rental.vehicles?.model} has been extended to ${format(new Date(newEndDate), 'MMM dd, yyyy')}.${extensionCost > 0 ? ` Extension fee: ${tenant?.currency_code || '$'}${extensionCost.toFixed(2)}. A payment link has been sent to your email.` : ''}${mileageImpact?.newAllowance ? ` Your new mileage allowance is ${mileageImpact.newAllowance.toLocaleString()} ${tenant?.distance_unit || 'miles'}.` : ''}`,
            type: 'success',
            link: '/portal/bookings',
          });
        }
      }

      // 7. Auto-send extension agreement (fire-and-forget)
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
            extensionNewEndDate: newEndDate,
          }),
        }).then(res => {
          if (!res.ok) console.error('Extension agreement send failed:', res.status);
          else console.log('Extension agreement sent successfully');
        }).catch(err => console.error('Extension agreement send error:', err));
      } catch (e) {
        console.error('Failed to trigger extension agreement:', e);
      }

      // 8. Auto-create extension insurance (fire-and-forget)
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

            if (hasCoverage) {
              // Create extension quote
              const { data: quoteResult } = await supabase.functions.invoke('bonzah-create-quote', {
                body: {
                  rental_id: rental.id,
                  customer_id: rental.customer_id || rental.customers?.id,
                  tenant_id: tenant.id,
                  trip_dates: {
                    start: (() => {
                      const d = rental.end_date.split('T')[0];
                      const today = new Date().toISOString().split('T')[0];
                      return d < today ? today : d;
                    })(),
                    end: newEndDate.split('T')[0],
                  },
                  pickup_state: originalPolicy.pickup_state,
                  coverage: { cdw: !!ct.cdw, rcli: !!ct.rcli, sli: !!ct.sli, pai: !!ct.pai },
                  renter: originalPolicy.renter_details,
                  policy_type: 'extension',
                },
              });

              // Confirm payment (deduct from Bonzah balance)
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
        title: 'Rental Extended',
        description: `Rental extended to ${format(new Date(newEndDate), 'MMMM dd, yyyy')}.${extensionCost > 0 ? ` Extension charge of ${tenant?.currency_code || '$'}${extensionCost.toFixed(2)} created with payment link sent to customer.` : ' Customer has been notified.'} An extension agreement has been sent for signing.`,
      });

      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['rental-agreements', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rental.id] });

      logAction({
        action: "rental_extended",
        entityType: "rental",
        entityId: rental.id,
        details: { newEndDate, previousEndDate: rental.end_date, extensionDays, extensionCost },
      });

      setNewEndDate('');
      setStep(1);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Admin extend rental error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to extend rental',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) {
          setNewEndDate('');
          setStep(1);
        }
        onOpenChange(val);
      }}
    >
      <DialogContent className="max-w-md">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarPlus className="h-5 w-5 text-primary" />
                Extend Rental
              </DialogTitle>
              <DialogDescription>
                Set a new end date for this rental. A payment link will be generated and sent to the customer.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Current End Date */}
              <div className="border rounded-lg p-3 bg-muted/30">
                <div className="flex items-center gap-2 mb-1">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">
                    Current End Date
                  </span>
                </div>
                <p className="font-medium">
                  {format(currentEndDate, 'MMM dd, yyyy')}
                </p>
              </div>

              {/* New End Date Picker */}
              <div className="space-y-2">
                <Label htmlFor="new-end-date">New End Date</Label>
                <Input
                  id="new-end-date"
                  type="date"
                  min={minDate}
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                />
              </div>

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
                    This rental has an active installment plan. The extension charge will be added as a separate ledger entry and will not be included in the installment schedule.
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

              {/* Availability Conflict Warning */}
              {extensionDays > 0 && isCheckingConflicts && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking vehicle availability...
                </div>
              )}
              {extensionDays > 0 && hasConflicts && !isCheckingConflicts && (
                <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-700 dark:text-amber-400 space-y-1">
                    <p className="font-medium">Vehicle has scheduling conflicts during this period:</p>
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
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleNextStep}
                disabled={!newEndDate || extensionDays <= 0}
              >
                Review & Confirm
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                Confirm Extension
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Summary */}
              <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Vehicle</span>
                  <span className="font-medium">{rental.vehicles?.make} {rental.vehicles?.model}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Customer</span>
                  <span className="font-medium">{rental.customers?.name}</span>
                </div>
                <div className="border-t pt-3 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Current End Date</span>
                  <span className="font-medium">{format(currentEndDate, 'MMM dd, yyyy')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">New End Date</span>
                  <span className="font-medium text-primary">{format(new Date(newEndDate), 'MMM dd, yyyy')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Extension</span>
                  <span className="font-bold text-amber-600">+{extensionDays} day{extensionDays !== 1 ? 's' : ''}</span>
                </div>
                {extensionCost > 0 && (
                  <div className="border-t pt-3 flex justify-between items-center">
                    <span className="text-sm font-medium">Extension Cost</span>
                    <span className="font-bold text-lg">{currencySymbol}{extensionCost.toFixed(2)}</span>
                  </div>
                )}
                {mileageImpact && mileageImpact.newAllowance !== null && (
                  <div className="border-t pt-3 flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Mileage Allowance</span>
                    <span className="font-medium">
                      {mileageImpact.currentAllowance?.toLocaleString()} → {mileageImpact.newAllowance?.toLocaleString()} {tenant?.distance_unit || 'miles'}
                    </span>
                  </div>
                )}
                {hasConflicts && (
                  <div className="border-t pt-3 flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span className="text-sm font-medium">
                      {rentalConflicts.length + blockedDateConflicts.length} scheduling conflict{rentalConflicts.length + blockedDateConflicts.length !== 1 ? 's' : ''} detected
                    </span>
                  </div>
                )}
              </div>

              <p className="text-sm text-muted-foreground text-center">
                This will extend the rental, create a ledger charge{extensionCost > 0 ? ', generate a payment link,' : ''} and notify the customer via email and in-app notification.
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isSubmitting}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleExtend}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Extending...
                  </>
                ) : (
                  <>
                    <CalendarPlus className="h-4 w-4 mr-2" />
                    Confirm Extension
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
