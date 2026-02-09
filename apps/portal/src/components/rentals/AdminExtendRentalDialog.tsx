'use client';

import { useState, useMemo, useEffect } from 'react';
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
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CalendarPlus, Calendar, AlertCircle, AlertTriangle, CreditCard, ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/use-audit-log';
import { format, differenceInDays } from 'date-fns';

interface AdminExtendRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
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
  const [dailyRate, setDailyRate] = useState<number | null>(null);
  const [loadingRate, setLoadingRate] = useState(false);

  const currentEndDate = new Date(rental.end_date);
  const minDate = format(
    new Date(currentEndDate.getTime() + 24 * 60 * 60 * 1000),
    'yyyy-MM-dd'
  );

  const extensionDays = useMemo(() => {
    if (!newEndDate) return 0;
    return differenceInDays(new Date(newEndDate), currentEndDate);
  }, [newEndDate, currentEndDate]);

  const extensionCost = useMemo(() => {
    if (!dailyRate || extensionDays <= 0) return 0;
    return Math.round(dailyRate * extensionDays * 100) / 100;
  }, [dailyRate, extensionDays]);

  // Fetch vehicle daily rate when dialog opens
  useEffect(() => {
    if (!open || !rental.vehicles?.id) return;
    setLoadingRate(true);
    supabase
      .from('vehicles')
      .select('daily_rent')
      .eq('id', rental.vehicles.id)
      .single()
      .then(({ data }) => {
        setDailyRate(data?.daily_rent ?? null);
      })
      .finally(() => setLoadingRate(false));
  }, [open, rental.vehicles?.id]);

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
            description: `Rental extension: ${extensionDays} day${extensionDays !== 1 ? 's' : ''} (${format(currentEndDate, 'MMM dd')} → ${format(new Date(newEndDate), 'MMM dd, yyyy')})`,
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
            message: `Your rental for ${rental.vehicles?.make} ${rental.vehicles?.model} has been extended to ${format(new Date(newEndDate), 'MMM dd, yyyy')}.${extensionCost > 0 ? ` Extension fee: ${tenant?.currency_code || '$'}${extensionCost.toFixed(2)}. A payment link has been sent to your email.` : ''}`,
            type: 'success',
            link: '/portal/bookings',
          });
        }
      }

      toast({
        title: 'Rental Extended',
        description: `Rental extended to ${format(new Date(newEndDate), 'MMMM dd, yyyy')}.${extensionCost > 0 ? ` Extension charge of ${tenant?.currency_code || '$'}${extensionCost.toFixed(2)} created with payment link sent to customer.` : ' Customer has been notified.'}`,
      });

      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });

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

  const currencySymbol = tenant?.currency_code === 'GBP' ? '£' : tenant?.currency_code === 'EUR' ? '€' : '$';

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
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        {extensionDays} day{extensionDays !== 1 ? 's' : ''} x {currencySymbol}{dailyRate.toFixed(2)}/day
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {extensionDays} day{extensionDays !== 1 ? 's' : ''} (daily rate not available)
                    </p>
                  )}
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

              {/* Insurance Warning */}
              {rental.bonzah_policy_id && extensionDays > 0 && (
                <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-700 dark:text-amber-400">
                    This rental has Bonzah insurance. The existing policy may not cover the extended period. Please advise the customer to review their coverage.
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
