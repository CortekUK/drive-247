'use client';

import { useState, useRef } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, CalendarPlus, Check, X, AlertCircle, AlertTriangle, Calendar, CreditCard, Shield, ShieldCheck, Upload, Gauge, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useExtensionConflicts } from '@/hooks/use-extension-conflicts';
import { useExtensionPricing } from '@/hooks/use-extension-pricing';
import { useRentalSettings } from '@/hooks/use-rental-settings';
import { format } from 'date-fns';
import { getCurrencySymbol } from '@/lib/format-utils';
import { parseLocalDate } from '@/lib/date-utils';
import { useQuery } from '@tanstack/react-query';
import { calculateTotalMileageAllowance, getMileageTier, isUnlimitedMileage } from '@/lib/mileage-utils';
import { type CoverageOptions } from '@/hooks/use-bonzah-premium';
import BonzahInsuranceSelector from '@/components/rentals/bonzah-insurance-selector';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ExtensionRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    start_date: string;
    end_date: string;
    previous_end_date: string | null;
    original_end_date?: string | null;
    has_installment_plan?: boolean;
    bonzah_policy_id?: string | null;
    rental_period_type?: string;
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
  const [extensionInsuranceType, setExtensionInsuranceType] = useState<'bonzah' | 'own'>(
    rental.bonzah_policy_id ? 'bonzah' : 'own'
  );
  const [extensionCoverage, setExtensionCoverage] = useState<CoverageOptions>({ cdw: false, rcli: false, sli: false, pai: false });
  const [bonzahPremiumAmount, setBonzahPremiumAmount] = useState(0);
  const [ownInsuranceFile, setOwnInsuranceFile] = useState<File | null>(null);

  // Fetch original Bonzah policy
  const { data: originalPolicy } = useQuery({
    queryKey: ['original-bonzah-policy', rental.bonzah_policy_id],
    queryFn: async () => {
      if (!rental.bonzah_policy_id) return null;
      const { data } = await supabase
        .from('bonzah_insurance_policies')
        .select('coverage_types, pickup_state, renter_details, status')
        .eq('id', rental.bonzah_policy_id)
        .single();
      return data;
    },
    enabled: !!rental.bonzah_policy_id,
  });

  // Pre-fill coverage from original policy
  const [coverageInitialized, setCoverageInitialized] = useState(false);
  if (originalPolicy?.coverage_types && !coverageInitialized) {
    const ct = originalPolicy.coverage_types as any;
    setExtensionCoverage({ cdw: !!ct.cdw, rcli: !!ct.rcli, sli: !!ct.sli, pai: !!ct.pai });
    setCoverageInitialized(true);
  }

  // Fetch full customer details for Bonzah
  const customerId = rental.customer_id || rental.customers?.id;
  const { data: fullCustomer } = useQuery({
    queryKey: ['customer-bonzah-details', customerId],
    queryFn: async () => {
      if (!customerId) return null;
      const { data } = await supabase
        .from('customers')
        .select('id, name, email, phone, date_of_birth, address_street, address_city, address_state, address_zip, license_number, license_state')
        .eq('id', customerId)
        .single();
      return data;
    },
    enabled: !!customerId,
  });

  const hasBonzahCoverage = extensionInsuranceType === 'bonzah' && (extensionCoverage.cdw || extensionCoverage.rcli || extensionCoverage.sli || extensionCoverage.pai);
  const insurancePremium = extensionInsuranceType === 'bonzah' ? bonzahPremiumAmount : 0;

  // Snapshot dates when dialog opens so they don't flip mid-approval when React Query refetches
  const [snapshotEndDate, setSnapshotEndDate] = useState(rental.end_date);
  const [snapshotRequestedDate, setSnapshotRequestedDate] = useState(rental.previous_end_date);
  const prevOpenRef = useRef(false);
  if (open && !prevOpenRef.current) {
    if (snapshotEndDate !== rental.end_date) setSnapshotEndDate(rental.end_date);
    if (snapshotRequestedDate !== rental.previous_end_date) setSnapshotRequestedDate(rental.previous_end_date);
  }
  prevOpenRef.current = open;

  const currentEndDate = parseLocalDate(snapshotEndDate);
  const requestedEndDate = snapshotRequestedDate
    ? parseLocalDate(snapshotRequestedDate)
    : null;

  // Detect stale request: the requested date is on or before the current end date
  // (happens when admin extended the rental via "Extend Rental" after customer requested)
  const isStaleRequest = requestedEndDate != null && requestedEndDate <= currentEndDate;

  const { extensionCost, extensionDays, dailyRate, dayBreakdown, hasSurcharges, isLoading: loadingRate } = useExtensionPricing({
    vehicleId: rental.vehicle_id || rental.vehicles?.id,
    currentEndDate: snapshotEndDate,
    newEndDate: isStaleRequest ? undefined : (snapshotRequestedDate || undefined),
    rentalPeriodType: rental.rental_period_type,
  });

  const currencySymbol = getCurrencySymbol(tenant?.currency_code || 'USD');
  const { settings: rentalSettings } = useRentalSettings();

  // Compute tax and service fee for the extension
  const extensionTaxAmount = rentalSettings?.tax_enabled && rentalSettings?.tax_percentage
    ? Math.round(extensionCost * (rentalSettings.tax_percentage / 100) * 100) / 100
    : 0;
  const extensionServiceFee = (() => {
    if (!rentalSettings?.service_fee_enabled) return 0;
    if (rentalSettings.service_fee_type === 'percentage' && rentalSettings.service_fee_value) {
      return Math.round(extensionCost * (rentalSettings.service_fee_value / 100) * 100) / 100;
    }
    return rentalSettings.service_fee_value || rentalSettings.service_fee_amount || 0;
  })();
  const extensionTotalAmount = extensionCost + extensionTaxAmount + extensionServiceFee + insurancePremium;

  const extensionStartForInsurance = (() => {
    const d = snapshotEndDate.split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    return d < today ? today : d;
  })();

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
    const currentDays = Math.max(1, Math.ceil((parseLocalDate(rental.end_date).getTime() - parseLocalDate(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    const _mtd = tenant?.monthly_tier_days ?? 30;
    const currentAllowance = calculateTotalMileageAllowance(vehicleMileage, currentDays, _mtd);
    if (!rental.previous_end_date) return { currentAllowance, newAllowance: null, currentTier: getMileageTier(currentDays, _mtd), newTier: null };
    const newDays = Math.max(1, Math.ceil((parseLocalDate(rental.previous_end_date).getTime() - parseLocalDate(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    const newAllowance = calculateTotalMileageAllowance(vehicleMileage, newDays, _mtd);
    return { currentAllowance, newAllowance, currentTier: getMileageTier(currentDays, _mtd), newTier: getMileageTier(newDays, _mtd) };
  })();

  // Count existing extensions to determine the next extension number
  const { data: existingExtensionCount } = useQuery({
    queryKey: ['extension-count', rental.id, tenant?.id],
    queryFn: async () => {
      // Count both legacy 'Extension' and new 'Extension Rental' categories
      const { count: legacyCount } = await supabase
        .from('ledger_entries')
        .select('id', { count: 'exact', head: true })
        .eq('rental_id', rental.id)
        .eq('type', 'Charge')
        .eq('category', 'Extension');
      const { count: newCount } = await supabase
        .from('ledger_entries')
        .select('id', { count: 'exact', head: true })
        .eq('rental_id', rental.id)
        .eq('type', 'Charge')
        .eq('category', 'Extension Rental');
      return (legacyCount || 0) + (newCount || 0);
    },
    enabled: !!rental.id && !!tenant?.id,
  });

  const { rentalConflicts, hasConflicts, isChecking: isCheckingConflicts } = useExtensionConflicts({
    vehicleId: rental.vehicle_id || rental.vehicles?.id,
    currentEndDate: rental.end_date,
    newEndDate: rental.previous_end_date || undefined,
    excludeRentalId: rental.id,
  });

  const handleApprove = async () => {
    if (!requestedEndDate || !tenant?.id || isStaleRequest) return;

    setIsApproving(true);
    try {
      // Server-side conflict re-check before update (catches race conditions)
      const vehicleId = rental.vehicle_id || rental.vehicles?.id;
      const extensionEndDate = rental.previous_end_date;
      if (vehicleId && extensionEndDate) {
        const { data: overlapping } = await supabase
          .from('rentals')
          .select('id, start_date, end_date, status, customers(name)')
          .eq('vehicle_id', vehicleId)
          .eq('tenant_id', tenant.id)
          .in('status', ['Pending', 'Active'])
          .lte('start_date', extensionEndDate)
          .or(`end_date.gte.${rental.end_date},end_date.is.null`)
          .neq('id', rental.id);

        if (overlapping && overlapping.length > 0) {
          const names = overlapping.map((r: any) => r.customers?.name || 'Unknown').join(', ');
          throw new Error(`Cannot approve extension: vehicle is booked by ${names} during the extension period. Please resolve the conflict first.`);
        }
      }

      // Swap dates: end_date ↔ previous_end_date (set original_end_date only on first extension)
      const isFirstExtension = !rental.original_end_date && (existingExtensionCount || 0) === 0;
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          end_date: rental.previous_end_date,
          previous_end_date: rental.end_date,
          is_extended: false,
          ...(isFirstExtension ? { original_end_date: rental.end_date } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', rental.id)
        .eq('tenant_id', tenant.id);

      if (updateError) {
        // Catch DB exclusion constraint violation with a friendly message
        if (updateError.message?.includes('no_overlapping_vehicle_rentals')) {
          throw new Error('Cannot approve extension: another rental overlaps with the new dates on this vehicle. Please resolve the scheduling conflict first.');
        }
        throw new Error(`Failed to approve extension: ${updateError.message}`);
      }

      // Create Stripe checkout FIRST — the edge function (service role) creates
      // the rental_extensions row and returns the extensionId + sequenceNumber.
      // RLS blocks client-side inserts into rental_extensions, so we mirror
      // AdminExtendRentalDialog's flow here to get an authoritative row before
      // stamping ledger charges with extension_id.
      let checkoutUrl: string | undefined;
      let createdExtensionId: string | undefined;
      let createdSequenceNumber: number | undefined;
      if (extensionTotalAmount > 0) {
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
                extensionAmount: extensionTotalAmount,
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
            createdExtensionId = result.extensionId;
            createdSequenceNumber = result.sequenceNumber;

            // Save checkout URL to rental for customer portal visibility
            if (checkoutUrl) {
              await supabase
                .from('rentals')
                .update({ extension_checkout_url: checkoutUrl, extension_amount: extensionTotalAmount })
                .eq('id', rental.id);
            }
          } else {
            console.error('Failed to create extension checkout:', await res.text());
          }
        } catch (err) {
          console.error('Error creating extension checkout:', err);
        }
      }

      // Insert ledger charges for extension (rental fee + tax + service fee)
      // with the authoritative extension_id + sequence_number so the
      // rental_extension_totals view and the customer-portal PaymentBreakdown
      // can group charges by extension. Without extension_id stamped, the
      // customer UI falls back to "all Extension Rental charges" and bleeds
      // older paid extensions into Ext #N's status row.
      const extNum = createdSequenceNumber ?? ((existingExtensionCount || 0) + 1);
      if (extensionCost > 0) {
        const extRef = `Extension #${extNum}: ${extensionDays} day${extensionDays !== 1 ? 's' : ''} (${format(currentEndDate, 'MMM dd')} → ${format(requestedEndDate, 'MMM dd, yyyy')})`;
        const baseLedger = {
          rental_id: rental.id,
          customer_id: rental.customer_id || rental.customers?.id,
          vehicle_id: rental.vehicle_id || rental.vehicles?.id,
          tenant_id: tenant.id,
          type: 'Charge' as const,
          entry_date: new Date().toISOString().split('T')[0],
          due_date: (rental.previous_end_date || new Date().toISOString()).split('T')[0],
          ...(createdExtensionId ? { extension_id: createdExtensionId } : {}),
        };
        const ledgerEntries: any[] = [
          { ...baseLedger, category: 'Extension Rental', reference: extRef, amount: extensionCost, remaining_amount: extensionCost },
        ];
        if (extensionTaxAmount > 0) {
          ledgerEntries.push({ ...baseLedger, category: 'Extension Tax', reference: `Extension #${extNum}: Tax`, amount: extensionTaxAmount, remaining_amount: extensionTaxAmount });
        }
        if (extensionServiceFee > 0) {
          ledgerEntries.push({ ...baseLedger, category: 'Extension Service Fee', reference: `Extension #${extNum}: Service Fee`, amount: extensionServiceFee, remaining_amount: extensionServiceFee });
        }
        const { error: ledgerError } = await supabase
          .from('ledger_entries')
          .insert(ledgerEntries);
        if (ledgerError) console.error('Failed to create ledger entries:', ledgerError);
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
              extensionAmount: extensionTotalAmount,
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
            message: `Your extension request for ${rental.vehicles?.make} ${rental.vehicles?.model} has been approved. New end date: ${format(requestedEndDate, 'MMM dd, yyyy')}.${extensionTotalAmount > 0 ? ` Extension total: ${currencySymbol}${extensionTotalAmount.toFixed(2)}. A payment link has been sent to your email.` : ''}${mileageImpact?.newAllowance ? ` Your new mileage allowance is ${mileageImpact.newAllowance.toLocaleString()} ${tenant?.distance_unit || 'miles'}.` : ''}`,
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
            extensionNumber: extNum,
          }),
        }).then(res => {
          if (!res.ok) console.error('Extension agreement send failed:', res.status);
          else console.log('Extension agreement sent successfully');
        }).catch(err => console.error('Extension agreement send error:', err));
      } catch (e) {
        console.error('Failed to trigger extension agreement:', e);
      }

      // Auto-create extension insurance — only if Bonzah selected with coverage
      if (extensionInsuranceType === 'bonzah' && hasBonzahCoverage && originalPolicy && rental.previous_end_date) {
        try {
          const { data: quoteResult } = await supabase.functions.invoke('bonzah-create-quote', {
            body: {
              rental_id: rental.id,
              customer_id: rental.customer_id || rental.customers?.id,
              tenant_id: tenant.id,
              trip_dates: {
                start: extensionStartForInsurance,
                end: rental.previous_end_date.split('T')[0],
              },
              pickup_state: originalPolicy.pickup_state,
              coverage: extensionCoverage,
              renter: originalPolicy.renter_details,
              policy_type: 'extension',
              extension_id: createdExtensionId ?? undefined,
            },
          });

          // Use the authoritative premium returned by the quote. UI state can
          // be 0 if the admin clicks Approve before BonzahInsuranceSelector
          // finishes calculating — that's what was causing the "admin has no
          // Bonzah, customer does" split (policy created, ledger charge missing).
          const actualPremium = Number(quoteResult?.total_premium ?? insurancePremium ?? 0);

          // Confirm the Bonzah policy now so it issues immediately, matching
          // the original-rental flow (admin buys from tenant balance at
          // approval). Stamp the id + premium onto rental_extensions so the
          // rental_extension_totals view picks up the right amount.
          if (quoteResult?.policy_record_id) {
            await supabase.functions.invoke('bonzah-confirm-payment', {
              body: {
                policy_record_id: quoteResult.policy_record_id,
                stripe_payment_intent_id: `portal-extension-${rental.id}-${createdExtensionId ?? Date.now()}`,
              },
            });
            if (createdExtensionId) {
              await supabase
                .from('rental_extensions')
                .update({
                  bonzah_policy_id: quoteResult.policy_record_id,
                  bonzah_confirmed_at: new Date().toISOString(),
                  insurance_amount: actualPremium,
                })
                .eq('id', createdExtensionId);
            }
          }

          // Create Extension Insurance ledger charge so the admin breakdown
          // and customer PaymentBreakdown both see it. Use actualPremium so
          // this doesn't skip on a stale UI value.
          if (actualPremium > 0) {
            await supabase.from('ledger_entries').insert({
              customer_id: rental.customer_id || rental.customers?.id,
              rental_id: rental.id,
              vehicle_id: rental.vehicle_id || rental.vehicles?.id,
              entry_date: rental.previous_end_date.split('T')[0],
              type: 'Charge',
              category: 'Extension Insurance',
              reference: `Extension #${extNum}: Insurance`,
              amount: actualPremium,
              remaining_amount: actualPremium,
              due_date: rental.previous_end_date.split('T')[0],
              tenant_id: tenant.id,
              ...(createdExtensionId ? { extension_id: createdExtensionId } : {}),
            });
          }

          queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rental.id] });
          queryClient.invalidateQueries({ queryKey: ['bonzah-balance'] });
        } catch (insuranceErr) {
          console.error('Extension insurance auto-create failed (non-blocking):', insuranceErr);
        }
      }

      toast({
        title: 'Extension Approved',
        description: `Rental extended to ${format(requestedEndDate, 'MMMM dd, yyyy')}.${extensionTotalAmount > 0 ? ` Extension charge of ${currencySymbol}${extensionTotalAmount.toFixed(2)} created with payment link sent to customer.` : ' Customer has been notified.'} An extension agreement has been sent for signing.`,
      });

      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
      queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
      queryClient.invalidateQueries({ queryKey: ['rental-extension-totals'] });
      queryClient.invalidateQueries({ queryKey: ['extension-count', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-agreements', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rental.id] });

      logAction({
        action: "rental_extension_approved",
        entityType: "rental",
        entityId: rental.id,
        details: { newEndDate: rental.previous_end_date, previousEndDate: rental.end_date, extensionDays, extensionCost, extensionTaxAmount, extensionServiceFee, extensionTotalAmount },
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
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-amber-600" />
            Extension Request
          </DialogTitle>
          <DialogDescription>
            {rental.customers?.name} has requested to extend their rental.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
        <div className="space-y-4 px-6 py-4">
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

          {/* Stale Request Warning */}
          {isStaleRequest && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This request is outdated — the rental has already been extended past the requested date ({requestedEndDate ? format(requestedEndDate, 'MMM dd, yyyy') : ''}). Please reject this request.
              </AlertDescription>
            </Alert>
          )}

          {/* Extension Duration */}
          {requestedEndDate && extensionDays > 0 && !isStaleRequest && (
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
                <p className="font-medium">Resolve these conflicts before approving:</p>
                {rentalConflicts.map((c) => (
                  <a
                    key={c.id}
                    href={`/rentals/${c.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline inline-flex items-center gap-1"
                  >
                    Rental for {c.customerName} ({format(parseLocalDate(c.start_date), 'MMM dd')} – {format(parseLocalDate(c.end_date), 'MMM dd')}) <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
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
                <div className="space-y-1">
                  {/* Rental Fee */}
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-600 dark:text-blue-400">Rental Fee</span>
                    <span className="font-medium text-blue-700 dark:text-blue-300">{currencySymbol}{extensionCost.toFixed(2)}</span>
                  </div>
                  {hasSurcharges ? (
                    <div className="space-y-0.5 pl-2 mb-1">
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
                          <p key={i} className="text-xs text-blue-500 dark:text-blue-400">
                            {g.label} — {currencySymbol}{g.rate.toFixed(2)}/day x {g.count} day{g.count !== 1 ? 's' : ''}
                          </p>
                        ));
                      })()}
                    </div>
                  ) : (
                    <p className="text-xs text-blue-500 dark:text-blue-400 pl-2 mb-1">
                      {extensionDays} day{extensionDays !== 1 ? 's' : ''} x {currencySymbol}{dailyRate.toFixed(2)}/day
                    </p>
                  )}
                  {/* Tax */}
                  {extensionTaxAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-blue-600 dark:text-blue-400">Tax ({rentalSettings?.tax_percentage}%)</span>
                      <span className="font-medium text-blue-700 dark:text-blue-300">{currencySymbol}{extensionTaxAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {/* Service Fee */}
                  {extensionServiceFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-blue-600 dark:text-blue-400">
                        Service Fee{rentalSettings?.service_fee_type === 'percentage' ? ` (${rentalSettings?.service_fee_value}%)` : ''}
                      </span>
                      <span className="font-medium text-blue-700 dark:text-blue-300">{currencySymbol}{extensionServiceFee.toFixed(2)}</span>
                    </div>
                  )}
                  {/* Insurance line item */}
                  {insurancePremium > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-blue-600 dark:text-blue-400">Bonzah Insurance</span>
                      <span className="font-medium text-blue-700 dark:text-blue-300">{currencySymbol}{insurancePremium.toFixed(2)}</span>
                    </div>
                  )}
                  {/* Total */}
                  <div className="flex justify-between text-sm pt-1 border-t border-blue-200 dark:border-blue-700 mt-1">
                    <span className="font-semibold text-blue-700 dark:text-blue-300">Total</span>
                    <span className="font-bold text-blue-700 dark:text-blue-300">{currencySymbol}{extensionTotalAmount.toFixed(2)}</span>
                  </div>
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

          {/* Extension Insurance */}
          {extensionDays > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                  Extension Insurance
                </span>
              </div>
              <RadioGroup
                value={extensionInsuranceType}
                onValueChange={(v) => {
                  setExtensionInsuranceType(v as 'bonzah' | 'own');
                  if (v === 'own') {
                    setOwnInsuranceFile(null);
                    setExtensionCoverage({ cdw: false, rcli: false, sli: false, pai: false });
                    setBonzahPremiumAmount(0);
                  }
                }}
                className="space-y-2"
              >
                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  extensionInsuranceType === 'bonzah' ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-900/10' : 'border-border hover:bg-muted/20'
                }`}>
                  <RadioGroupItem value="bonzah" />
                  <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
                  <span className="text-sm font-medium flex-1">Bonzah Insurance</span>
                  {insurancePremium > 0 && (
                    <span className="text-sm font-semibold text-blue-600">{currencySymbol}{insurancePremium.toFixed(2)}</span>
                  )}
                </label>

                {extensionInsuranceType === 'bonzah' && (
                  <div className="pl-2">
                    {originalPolicy ? (
                      <BonzahInsuranceSelector
                        tripStartDate={extensionStartForInsurance}
                        tripEndDate={rental.previous_end_date?.split('T')[0] || null}
                        pickupState={(originalPolicy.pickup_state as string) || 'FL'}
                        onCoverageChange={(coverage, premium) => {
                          setExtensionCoverage(coverage);
                          setBonzahPremiumAmount(premium);
                        }}
                        onSkipInsurance={() => {
                          setExtensionCoverage({ cdw: false, rcli: false, sli: false, pai: false });
                          setBonzahPremiumAmount(0);
                        }}
                        initialCoverage={extensionCoverage}
                        customerDetails={fullCustomer || undefined}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground p-3 border rounded-lg bg-muted/20">
                        No original Bonzah policy found. You can add insurance from the rental page after approving.
                      </p>
                    )}
                  </div>
                )}

                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  extensionInsuranceType === 'own' ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-900/10' : 'border-border hover:bg-muted/20'
                }`}>
                  <RadioGroupItem value="own" />
                  <Upload className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="text-sm font-medium">Customer's Own Insurance</span>
                </label>

                {extensionInsuranceType === 'own' && (
                  <div className="pl-2">
                    <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                      ownInsuranceFile ? 'border-emerald-400 bg-emerald-50/30 dark:bg-emerald-900/10' : 'border-muted-foreground/20 hover:border-muted-foreground/40'
                    }`}>
                      {ownInsuranceFile ? (
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                            <ShieldCheck className="h-5 w-5 text-emerald-600" />
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-sm font-medium truncate">{ownInsuranceFile.name}</p>
                            <p className="text-xs text-muted-foreground">{(ownInsuranceFile.size / 1024).toFixed(0)} KB</p>
                          </div>
                          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => setOwnInsuranceFile(null)}>
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <label className="cursor-pointer block">
                          <Upload className="h-7 w-7 text-muted-foreground/40 mx-auto mb-1.5" />
                          <p className="text-sm text-muted-foreground">
                            <span className="text-primary font-medium hover:underline">Click to upload</span> insurance document
                          </p>
                          <p className="text-xs text-muted-foreground/60 mt-0.5">PDF, JPG, PNG up to 10MB</p>
                          <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const file = e.target.files?.[0]; if (file) setOwnInsuranceFile(file); }} />
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </RadioGroup>
            </div>
          )}
        </div>
        </ScrollArea>

        <DialogFooter className="px-6 pb-6 pt-3 border-t flex gap-2 sm:gap-2">
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
            disabled={isProcessing || !requestedEndDate || hasConflicts || isStaleRequest}
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
