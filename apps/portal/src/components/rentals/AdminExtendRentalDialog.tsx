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
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, CalendarPlus, Calendar, AlertCircle, AlertTriangle, CreditCard, ArrowLeft, Shield, ShieldCheck, Upload, Gauge, ExternalLink, Tag, ChevronsUpDown, Check, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/use-audit-log';
import { useExtensionConflicts } from '@/hooks/use-extension-conflicts';
import { useExtensionPricing } from '@/hooks/use-extension-pricing';
import { useVehicleBookedDates } from '@/hooks/use-vehicle-booked-dates';
import { RentalDateRangePicker } from '@/components/shared/forms/rental-date-picker';
import { format } from 'date-fns';
import { formatCurrency, getCurrencySymbol } from '@/lib/format-utils';
import { useQuery } from '@tanstack/react-query';
import { calculateTotalMileageAllowance, getMileageTier, isUnlimitedMileage } from '@/lib/mileage-utils';
import { useRentalSettings } from '@/hooks/use-rental-settings';
import { type CoverageOptions } from '@/hooks/use-bonzah-premium';
import { Checkbox } from '@/components/ui/checkbox';
import BonzahInsuranceSelector from '@/components/rentals/bonzah-insurance-selector';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';

interface AdminExtendRentalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    start_date: string;
    end_date: string;
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

export function AdminExtendRentalDialog({
  open,
  onOpenChange,
  rental,
}: AdminExtendRentalDialogProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { logAction } = useAuditLog();
  const { settings: rentalSettings } = useRentalSettings();

  const [newEndDate, setNewEndDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStep, setSubmissionStep] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  // Capture the current end date when the dialog opens so it doesn't change during submission
  const [snapshotEndDate, setSnapshotEndDate] = useState(rental.end_date);

  // Re-sync snapshot whenever the dialog opens (handles back-to-back extensions
  // where the component stays mounted but rental.end_date has changed)
  const prevOpenRef = useRef(false);
  if (open && !prevOpenRef.current) {
    // Dialog just opened — capture the latest end_date
    if (snapshotEndDate !== rental.end_date) {
      setSnapshotEndDate(rental.end_date);
    }
  }
  prevOpenRef.current = open;
  const [extensionInsuranceType, setExtensionInsuranceType] = useState<'bonzah' | 'own'>(
    rental.bonzah_policy_id ? 'bonzah' : 'own'
  );
  const [extensionCoverage, setExtensionCoverage] = useState<CoverageOptions>({ cdw: false, rcli: false, sli: false, pai: false });
  const [bonzahPremiumAmount, setBonzahPremiumAmount] = useState(0);
  const [ownInsuranceFile, setOwnInsuranceFile] = useState<File | null>(null);

  // Promo code state — applied against the extension rental fee only.
  // Tax + service fee recompute on the discounted base, mirroring new-rental flow.
  const [promoCodeOpen, setPromoCodeOpen] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoDetails, setPromoDetails] = useState<{
    code: string;
    type: 'percentage' | 'fixed_amount';
    value: number;
    id: string;
  } | null>(null);

  const { data: promoCodes } = useQuery({
    queryKey: ['promo-codes', tenant?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('promocodes')
        .select('id, code, type, value, expires_at')
        .eq('tenant_id', tenant!.id)
        .order('code', { ascending: true });
      if (error) throw error;
      const now = new Date();
      return (data || []).filter((p: any) => !p.expires_at || new Date(p.expires_at) >= now);
    },
    enabled: !!tenant?.id,
  });

  const validatePromoCode = async (code: string) => {
    if (!code || !tenant?.id) return;
    setPromoLoading(true);
    setPromoError(null);
    setPromoDetails(null);
    try {
      const { data, error } = await (supabase as any)
        .from('promocodes')
        .select('*')
        .eq('code', code.trim())
        .eq('tenant_id', tenant.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        setPromoError('Invalid promo code');
        return;
      }
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        setPromoError('Promo code has expired');
        return;
      }
      setPromoDetails({
        code: data.code,
        type: data.type === 'value' ? 'fixed_amount' : 'percentage',
        value: data.value,
        id: data.id,
      });
    } catch (err) {
      console.error('Promo validation error:', err);
      setPromoError('Failed to validate promo code');
    } finally {
      setPromoLoading(false);
    }
  };

  const calculateExtensionDiscount = (rentalAmount: number): number => {
    if (!promoDetails) return 0;
    if (promoDetails.type === 'fixed_amount') {
      return rentalAmount > promoDetails.value ? promoDetails.value : 0;
    }
    return Math.round((rentalAmount * promoDetails.value) / 100 * 100) / 100;
  };

  // Fetch original Bonzah policy to pre-fill coverage options
  const { data: originalPolicy } = useQuery({
    queryKey: ['original-bonzah-policy', rental.bonzah_policy_id],
    queryFn: async () => {
      if (!rental.bonzah_policy_id) return null;
      const { data } = await supabase
        .from('bonzah_insurance_policies')
        .select('coverage_types, pickup_state, renter_details, status, premium_amount')
        .eq('id', rental.bonzah_policy_id)
        .single();
      return data;
    },
    enabled: !!rental.bonzah_policy_id,
  });

  // Fetch full customer details for Bonzah (address, license, DOB)
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

  // Pre-fill coverage from original policy when it loads
  const [coverageInitialized, setCoverageInitialized] = useState(false);
  if (originalPolicy?.coverage_types && !coverageInitialized) {
    const ct = originalPolicy.coverage_types as any;
    setExtensionCoverage({ cdw: !!ct.cdw, rcli: !!ct.rcli, sli: !!ct.sli, pai: !!ct.pai });
    setCoverageInitialized(true);
  }

  const currentEndDate = new Date(snapshotEndDate);
  const minDate = format(
    new Date(currentEndDate.getTime() + 24 * 60 * 60 * 1000),
    'yyyy-MM-dd'
  );

  const { extensionCost, extensionDays, dailyRate, dayBreakdown, hasSurcharges, isLoading: loadingRate } = useExtensionPricing({
    vehicleId: rental.vehicles?.id,
    currentEndDate: snapshotEndDate,
    newEndDate: newEndDate || undefined,
    rentalPeriodType: rental.rental_period_type,
  });

  const hasBonzahCoverage = extensionInsuranceType === 'bonzah' && (extensionCoverage.cdw || extensionCoverage.rcli || extensionCoverage.sli || extensionCoverage.pai);
  const extensionStartForInsurance = (() => {
    const d = (rental.end_date || new Date().toISOString()).split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    return d < today ? today : d;
  })();
  const insurancePremium = extensionInsuranceType === 'bonzah' ? bonzahPremiumAmount : 0;

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
    const _mtd = tenant?.monthly_tier_days ?? 30;
    const currentAllowance = calculateTotalMileageAllowance(vehicleMileage, currentDays, _mtd);
    if (!newEndDate) return { currentAllowance, newAllowance: null, currentTier: getMileageTier(currentDays, _mtd), newTier: null };
    const newDays = Math.max(1, Math.ceil((new Date(newEndDate).getTime() - new Date(rental.start_date).getTime()) / (1000 * 60 * 60 * 24)));
    const newAllowance = calculateTotalMileageAllowance(vehicleMileage, newDays, _mtd);
    return { currentAllowance, newAllowance, currentTier: getMileageTier(currentDays, _mtd), newTier: getMileageTier(newDays, _mtd) };
  })();

  // Count existing extensions to determine the next extension number
  // Count by 'Extension Rental' (new format) + 'Extension' (legacy single-entry format)
  const { data: existingExtensionCount } = useQuery({
    queryKey: ['extension-count', rental.id, tenant?.id],
    queryFn: async () => {
      const { count: newCount } = await supabase
        .from('ledger_entries')
        .select('id', { count: 'exact', head: true })
        .eq('rental_id', rental.id)
        .eq('type', 'Charge')
        .eq('category', 'Extension Rental');
      const { count: legacyCount } = await supabase
        .from('ledger_entries')
        .select('id', { count: 'exact', head: true })
        .eq('rental_id', rental.id)
        .eq('type', 'Charge')
        .eq('category', 'Extension');
      return (newCount || 0) + (legacyCount || 0);
    },
    enabled: !!rental.id && !!tenant?.id,
  });

  // Apply promo discount to the extension rental fee. Tax and service fee
  // recompute on the discounted base — matches the new-rental flow.
  const extensionDiscount = calculateExtensionDiscount(extensionCost);
  const discountedExtensionCost = Math.max(0, extensionCost - extensionDiscount);
  const extensionTaxAmount = rentalSettings?.tax_enabled && rentalSettings?.tax_percentage
    ? Math.round(discountedExtensionCost * (rentalSettings.tax_percentage / 100) * 100) / 100
    : 0;
  const extensionServiceFee = (() => {
    if (!rentalSettings?.service_fee_enabled) return 0;
    if (rentalSettings.service_fee_type === 'percentage' && rentalSettings.service_fee_value) {
      return Math.round(discountedExtensionCost * (rentalSettings.service_fee_value / 100) * 100) / 100;
    }
    return rentalSettings.service_fee_value || rentalSettings.service_fee_amount || 0;
  })();
  const extensionTotalAmount = discountedExtensionCost + extensionTaxAmount + extensionServiceFee + insurancePremium;

  // Fetch vehicle occupancy for the color-coded date picker (exclude current rental)
  const { occupancyMap, occupancyModifiers } = useVehicleBookedDates(vehicleId, rental.id);

  const { rentalConflicts, bufferConflicts, hasConflicts, isChecking: isCheckingConflicts } = useExtensionConflicts({
    vehicleId: rental.vehicles?.id,
    currentEndDate: snapshotEndDate,
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
    setSubmissionStep('Updating rental dates...');
    try {
      // 1. Update rental dates (set original_end_date only on first extension)
      const isFirstExtension = !rental.original_end_date && (existingExtensionCount || 0) === 0;
      const { error: updateError } = await supabase
        .from('rentals')
        .update({
          end_date: newEndDate,
          previous_end_date: snapshotEndDate,
          is_extended: false,
          ...(isFirstExtension ? { original_end_date: snapshotEndDate } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', rental.id)
        .eq('tenant_id', tenant.id);

      if (updateError) {
        throw new Error(`Failed to extend rental: ${updateError.message}`);
      }

      setSubmissionStep('Creating payment link...');
      // 2. Create Stripe checkout for extension payment (total includes tax + service fee).
      //    This also creates the rental_extensions row and returns its id +
      //    sequence_number — the authoritative "#N" we stamp on ledger rows.
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
                newEndDate,
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
            console.log('Extension checkout created:', result.sessionId);

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

      // 3. Insert ledger charges for extension breakdown. Runs AFTER checkout
      //    so we have the authoritative sequence_number + extension_id to
      //    stamp on every row — keeping numbering and grouping in sync.
      const extNum = createdSequenceNumber ?? ((existingExtensionCount || 0) + 1);
      const promoSuffix = extensionDiscount > 0 && promoDetails?.code ? ` — promo ${promoDetails.code}` : '';
      const extRef = `Extension #${extNum}: ${extensionDays} day${extensionDays !== 1 ? 's' : ''} (${format(currentEndDate, 'MMM dd')} → ${format(new Date(newEndDate), 'MMM dd, yyyy')})${promoSuffix}`;
      const today = new Date().toISOString().split('T')[0];
      const baseLedger = {
        rental_id: rental.id,
        customer_id: rental.customer_id || rental.customers?.id,
        vehicle_id: rental.vehicle_id || rental.vehicles?.id,
        tenant_id: tenant.id,
        type: 'Charge' as const,
        entry_date: today,
        due_date: newEndDate.split('T')[0],
        ...(createdExtensionId ? { extension_id: createdExtensionId } : {}),
      };

      if (discountedExtensionCost > 0) {
        const ledgerEntries: any[] = [
          { ...baseLedger, category: 'Extension Rental', reference: extRef, amount: discountedExtensionCost, remaining_amount: discountedExtensionCost },
        ];
        if (extensionTaxAmount > 0) {
          ledgerEntries.push({ ...baseLedger, category: 'Extension Tax', reference: `Extension #${extNum}: Tax`, amount: extensionTaxAmount, remaining_amount: extensionTaxAmount });
        }
        if (extensionServiceFee > 0) {
          ledgerEntries.push({ ...baseLedger, category: 'Extension Service Fee', reference: `Extension #${extNum}: Service Fee`, amount: extensionServiceFee, remaining_amount: extensionServiceFee });
        }
        const { error: ledgerError } = await supabase.from('ledger_entries').insert(ledgerEntries);
        if (ledgerError) console.error('Failed to create ledger entries:', ledgerError);
      }

      setSubmissionStep('Sending notifications...');
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

      // 5. Create admin notification
      await supabase.from('notifications').insert({
        tenant_id: tenant.id,
        type: 'booking',
        title: 'Rental Extended',
        message: `${rental.vehicles?.make} ${rental.vehicles?.model} (${rental.vehicles?.reg}) extended by ${extensionDays} days for ${rental.customers?.name}. Extension cost: ${tenant?.currency_code || '$'}${extensionTotalAmount.toFixed(2)}`,
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
            message: `Your rental for ${rental.vehicles?.make} ${rental.vehicles?.model} has been extended to ${format(new Date(newEndDate), 'MMM dd, yyyy')}.${extensionTotalAmount > 0 ? ` Extension fee: ${tenant?.currency_code || '$'}${extensionTotalAmount.toFixed(2)}. A payment link has been sent to your email.` : ''}${mileageImpact?.newAllowance ? ` Your new mileage allowance is ${mileageImpact.newAllowance.toLocaleString()} ${tenant?.distance_unit || 'miles'}.` : ''}`,
            type: 'success',
            link: '/portal/bookings',
          });
        }
      }

      // 7. Send extension agreement (awaited like original rental flow)
      setSubmissionStep('Sending extension agreement...');
      let agreementSent = false;
      try {
        const esignResponse = await fetch('/api/esign', {
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
            extensionNumber: extNum,
          }),
        });
        const esignData = await esignResponse.json();
        if (esignResponse.ok && esignData?.ok) {
          agreementSent = true;
          console.log('Extension agreement sent successfully');
        } else if (esignData?.error === 'insufficient_credits') {
          console.warn('Insufficient credits for extension agreement');
        } else {
          console.warn('Extension agreement send failed:', esignData);
        }
      } catch (e) {
        console.error('Failed to send extension agreement:', e);
      }

      setSubmissionStep('Finalising...');
      // 8. Auto-create extension insurance (fire-and-forget) — only if Bonzah selected with coverage
      if (extensionInsuranceType === 'bonzah' && hasBonzahCoverage && originalPolicy) {
        try {
          // Create extension quote with the user-selected coverage
          const { data: quoteResult } = await supabase.functions.invoke('bonzah-create-quote', {
            body: {
              rental_id: rental.id,
              customer_id: rental.customer_id || rental.customers?.id,
              tenant_id: tenant.id,
              trip_dates: {
                start: extensionStartForInsurance,
                end: newEndDate.split('T')[0],
              },
              pickup_state: originalPolicy.pickup_state,
              coverage: extensionCoverage,
              renter: originalPolicy.renter_details,
              policy_type: 'extension',
              extension_id: createdExtensionId ?? undefined,
            },
          });

          // Confirm payment (deduct from Bonzah balance) immediately so the
          // policy issues right away, matching the original-rental flow.
          // Use the actual premium returned by the quote API — UI state
          // (`insurancePremium`) can be 0 if the user submits before the
          // selector finishes calculating.
          const actualPremium = Number(quoteResult?.total_premium ?? insurancePremium ?? 0);
          if (quoteResult?.policy_record_id) {
            await supabase.functions.invoke('bonzah-confirm-payment', {
              body: {
                policy_record_id: quoteResult.policy_record_id,
                stripe_payment_intent_id: `portal-extension-${rental.id}`,
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

          // Create Extension Insurance ledger charge so payments can be allocated to it
          if (actualPremium > 0) {
            await supabase.from('ledger_entries').insert({
              customer_id: rental.customer_id || rental.customers?.id,
              rental_id: rental.id,
              vehicle_id: rental.vehicle_id || rental.vehicles?.id,
              entry_date: newEndDate.split('T')[0],
              type: 'Charge',
              category: 'Extension Insurance',
              amount: actualPremium,
              remaining_amount: actualPremium,
              due_date: newEndDate.split('T')[0],
              tenant_id: tenant.id,
              reference: `Extension #${extNum}: Insurance`,
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
        title: agreementSent ? 'Rental Extended — Agreement Sent' : 'Rental Extended — Agreement Pending',
        description: agreementSent
          ? `Rental extended to ${format(new Date(newEndDate), 'MMMM dd, yyyy')}.${extensionTotalAmount > 0 ? ` Extension charge of ${tenant?.currency_code || '$'}${extensionTotalAmount.toFixed(2)} created.` : ''} Agreement sent to customer for signing.`
          : `Rental extended to ${format(new Date(newEndDate), 'MMMM dd, yyyy')}.${extensionTotalAmount > 0 ? ` Extension charge of ${tenant?.currency_code || '$'}${extensionTotalAmount.toFixed(2)} created.` : ''} Agreement failed to send — you can retry from the rental details page.`,
        variant: agreementSent ? 'default' : 'default',
      });

      queryClient.invalidateQueries({ queryKey: ['rental', rental.id, tenant.id] });
      queryClient.invalidateQueries({ queryKey: ['rentals-list'] });
      queryClient.invalidateQueries({ queryKey: ['enhanced-rentals'] });
      queryClient.invalidateQueries({ queryKey: ['ledger-entries'] });
      queryClient.invalidateQueries({ queryKey: ['rental-charges'] });
      queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['rental-totals'] });
      queryClient.invalidateQueries({ queryKey: ['extension-count', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-agreements', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['rental-extension-totals'] });
      queryClient.invalidateQueries({ queryKey: ['rental-insurance-docs', rental.id] });
      queryClient.invalidateQueries({ queryKey: ['bonzah-balance'] });

      // 9. Upload customer's own insurance document if provided
      if (extensionInsuranceType === 'own' && ownInsuranceFile && tenant?.id) {
        try {
          const fileExt = ownInsuranceFile.name.split('.').pop();
          const filePath = `${tenant.id}/${rental.id}/extension-insurance-${Date.now()}.${fileExt}`;
          const { error: uploadError } = await supabase.storage
            .from('insurance-documents')
            .upload(filePath, ownInsuranceFile);

          if (!uploadError) {
            const { data: { publicUrl } } = supabase.storage.from('insurance-documents').getPublicUrl(filePath);
            await supabase.from('insurance_documents').insert({
              rental_id: rental.id,
              customer_id: rental.customer_id || rental.customers?.id,
              tenant_id: tenant.id,
              file_url: publicUrl,
              file_name: ownInsuranceFile.name,
              file_type: ownInsuranceFile.type,
              document_type: 'extension_insurance',
            });
            queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies', rental.id] });
          }
        } catch (uploadErr) {
          console.error('Insurance document upload failed (non-blocking):', uploadErr);
        }
      }

      logAction({
        action: "rental_extended",
        entityType: "rental",
        entityId: rental.id,
        details: { newEndDate, previousEndDate: rental.end_date, extensionDays, extensionCost, extensionTaxAmount, extensionServiceFee, extensionTotalAmount },
      });

      setNewEndDate('');
      setStep(1);
      setExtensionInsuranceType(rental.bonzah_policy_id ? 'bonzah' : 'own');
      setCoverageInitialized(false);
      setOwnInsuranceFile(null);
      setPromoDetails(null);
      setPromoError(null);
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
      setSubmissionStep('');
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
          setExtensionInsuranceType(rental.bonzah_policy_id ? 'bonzah' : 'own');
          setCoverageInitialized(false);
          setOwnInsuranceFile(null);
          setPromoDetails(null);
          setPromoError(null);
        }
        onOpenChange(val);
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden p-0">
        {step === 1 ? (
          <>
            <DialogHeader className="px-6 pt-6 pb-0">
              <DialogTitle className="flex items-center gap-2">
                <CalendarPlus className="h-5 w-5 text-primary" />
                Extend Rental
              </DialogTitle>
              <DialogDescription>
                Set a new end date for this rental. A payment link will be generated and sent to the customer.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="flex-1 overflow-y-auto">
            <div className="space-y-4 px-6 py-4">
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
                <Label>New End Date</Label>
                <RentalDateRangePicker
                  mode="end-only"
                  startDate={currentEndDate}
                  endDate={newEndDate ? new Date(newEndDate + 'T00:00:00') : undefined}
                  onEndDateChange={(date) => {
                    setNewEndDate(date ? format(date, 'yyyy-MM-dd') : '');
                  }}
                  disableDate={(date) => {
                    // Disable dates on or before the current end date
                    const minD = new Date(currentEndDate);
                    minD.setHours(0, 0, 0, 0);
                    date.setHours(0, 0, 0, 0);
                    return date <= minD;
                  }}
                  occupancyMap={occupancyMap}
                  occupancyModifiers={occupancyModifiers}
                  title="Select New End Date"
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
                        {currencySymbol}{extensionTotalAmount.toFixed(2)}
                      </p>
                      <div className="space-y-0.5 mt-1">
                        {hasSurcharges ? (
                          <>
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
                          </>
                        ) : (
                          <p className="text-xs text-blue-600 dark:text-blue-400">
                            Rental: {extensionDays} day{extensionDays !== 1 ? 's' : ''} x {currencySymbol}{dailyRate.toFixed(2)}/day = {currencySymbol}{extensionCost.toFixed(2)}
                          </p>
                        )}
                        {extensionDiscount > 0 && (
                          <p className="text-xs text-emerald-600 dark:text-emerald-400">
                            Discount ({promoDetails?.code}): -{currencySymbol}{extensionDiscount.toFixed(2)}
                          </p>
                        )}
                        {extensionTaxAmount > 0 && (
                          <p className="text-xs text-blue-600 dark:text-blue-400">
                            Tax ({rentalSettings?.tax_percentage}%): {currencySymbol}{extensionTaxAmount.toFixed(2)}
                          </p>
                        )}
                        {extensionServiceFee > 0 && (
                          <p className="text-xs text-blue-600 dark:text-blue-400">
                            Service Fee: {currencySymbol}{extensionServiceFee.toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {extensionDays} day{extensionDays !== 1 ? 's' : ''} (daily rate not available)
                    </p>
                  )}
                </div>
              )}

              {/* Promo Code */}
              {extensionDays > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Promo Code
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Popover open={promoCodeOpen} onOpenChange={setPromoCodeOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={promoCodeOpen}
                          className={cn(
                            'flex-1 justify-between font-normal',
                            !promoDetails?.code && 'text-muted-foreground',
                            promoError ? 'border-destructive' : promoDetails ? 'border-green-500' : ''
                          )}
                        >
                          {promoDetails?.code || 'Select promo code'}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search promo codes..." />
                          <CommandList>
                            <CommandEmpty>No promo codes found</CommandEmpty>
                            <CommandGroup>
                              {promoCodes?.map((promo: any) => (
                                <CommandItem
                                  key={promo.id}
                                  value={promo.code}
                                  onSelect={() => {
                                    setPromoCodeOpen(false);
                                    setPromoError(null);
                                    setPromoDetails(null);
                                    validatePromoCode(promo.code);
                                  }}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-medium">{promo.code}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {promo.type === 'percentage'
                                        ? `${promo.value}% off`
                                        : `${formatCurrency(promo.value, tenant?.currency_code || 'USD')} off`}
                                      {promo.expires_at && ` · Expires ${format(new Date(promo.expires_at), 'MMM d, yyyy')}`}
                                    </span>
                                  </div>
                                  <Check
                                    className={cn(
                                      'ml-auto h-4 w-4',
                                      promoDetails?.code === promo.code ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {promoDetails?.code && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          setPromoDetails(null);
                          setPromoError(null);
                        }}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  {promoLoading && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Validating...
                    </p>
                  )}
                  {promoError && <p className="text-xs text-destructive">{promoError}</p>}
                  {promoDetails && extensionDiscount > 0 && (
                    <p className="text-xs text-emerald-600 font-medium">
                      {promoDetails.type === 'percentage'
                        ? `${promoDetails.value}% off`
                        : `${currencySymbol}${promoDetails.value.toFixed(2)} off`}
                      {' '}— saving {currencySymbol}{extensionDiscount.toFixed(2)} on this extension
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
                    {/* Bonzah Option */}
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

                    {/* Bonzah Coverage Selector */}
                    {extensionInsuranceType === 'bonzah' && (
                      <div className="pl-2">
                        {originalPolicy ? (
                          <BonzahInsuranceSelector
                            tripStartDate={extensionStartForInsurance}
                            tripEndDate={newEndDate || null}
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
                            No original Bonzah policy found. You can add insurance from the rental page after extending.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Customer's Own Option */}
                    <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      extensionInsuranceType === 'own' ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-900/10' : 'border-border hover:bg-muted/20'
                    }`}>
                      <RadioGroupItem value="own" />
                      <Upload className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-sm font-medium">Customer's Own Insurance</span>
                    </label>

                    {/* Upload section */}
                    {extensionInsuranceType === 'own' && (
                      <div className="pl-2">
                        <div
                          className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                            ownInsuranceFile
                              ? 'border-emerald-400 bg-emerald-50/30 dark:bg-emerald-900/10'
                              : 'border-muted-foreground/20 hover:border-muted-foreground/40'
                          }`}
                        >
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

              {/* Availability Conflict Warning */}
              {extensionDays > 0 && isCheckingConflicts && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking vehicle availability...
                </div>
              )}
            </div>
            </ScrollArea>

            <DialogFooter className="px-6 pb-6 pt-3 border-t">
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
            <DialogHeader className="px-6 pt-6 pb-0">
              <DialogTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                Confirm Extension
              </DialogTitle>
            </DialogHeader>

            <ScrollArea className="flex-1 overflow-y-auto">
            <div className="space-y-4 px-6 py-4">
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
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Insurance</span>
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    {extensionInsuranceType === 'bonzah' ? (
                      <>
                        <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                        {hasBonzahCoverage
                          ? [extensionCoverage.cdw && 'CDW', extensionCoverage.rcli && 'RCLI', extensionCoverage.sli && 'SLI', extensionCoverage.pai && 'PAI'].filter(Boolean).join(', ')
                          : 'No coverage selected'}
                      </>
                    ) : (
                      <><Upload className="h-3.5 w-3.5 text-amber-600" /> Customer's Own</>
                    )}
                  </span>
                </div>
                {extensionTotalAmount > 0 && (
                  <div className="border-t pt-3 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Rental Fee</span>
                      <span className="text-sm font-medium">{currencySymbol}{extensionCost.toFixed(2)}</span>
                    </div>
                    {extensionDiscount > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-emerald-600">Discount ({promoDetails?.code})</span>
                        <span className="text-sm font-medium text-emerald-600">-{currencySymbol}{extensionDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {extensionTaxAmount > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Tax ({rentalSettings?.tax_percentage}%)</span>
                        <span className="text-sm font-medium">{currencySymbol}{extensionTaxAmount.toFixed(2)}</span>
                      </div>
                    )}
                    {extensionServiceFee > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Service Fee</span>
                        <span className="text-sm font-medium">{currencySymbol}{extensionServiceFee.toFixed(2)}</span>
                      </div>
                    )}
                    {insurancePremium > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Bonzah Insurance</span>
                        <span className="text-sm font-medium">{currencySymbol}{insurancePremium.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-1.5 border-t">
                      <span className="text-sm font-medium">Total</span>
                      <span className="font-bold text-lg">{currencySymbol}{extensionTotalAmount.toFixed(2)}</span>
                    </div>
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
              </div>

              <p className="text-sm text-muted-foreground text-center">
                This will extend the rental, create a ledger charge{extensionTotalAmount > 0 ? ', generate a payment link,' : ''} and notify the customer via email and in-app notification.
              </p>
            </div>
            </ScrollArea>

            <DialogFooter className="px-6 pb-6 pt-3 border-t">
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
                    {submissionStep || 'Extending...'}
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
