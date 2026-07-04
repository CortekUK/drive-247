'use client';

import { useState, useEffect } from 'react';
import { Loader2, Shield, ShieldCheck, ArrowLeft, ArrowRight, AlertTriangle, ExternalLink, Info } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { type CoverageOptions } from '@/hooks/use-bonzah-premium';
import { useBonzahVehicleEligibility } from '@/hooks/use-bonzah-vehicle-eligibility';
import { formatCurrency } from '@/lib/format-utils';
import { getActiveCoverageLabels } from '@/lib/coverage-labels';
import BonzahInsuranceSelector from '@/components/rentals/bonzah-insurance-selector';
import { useBonzahBalance } from '@/hooks/use-bonzah-balance';
import { clampToBonzahStart, getPacificToday } from '@/lib/bonzah-dates';
import BonzahAvailabilityNotice from '@/components/rentals/bonzah-availability-notice';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
import { useAuditLogOnOpen } from '@/hooks/use-audit-log-on-open';

interface BuyInsuranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    start_date: string;
    end_date: string | null;
    customer_id?: string;
    customers: { id: string; name: string; email?: string; phone?: string | null };
    vehicles: { id: string; reg: string; make: string; model: string };
  };
  onPurchaseComplete: (premium: number) => void;
  /** When set to 'extension', uses extensionDates for trip period and creates Extension Insurance ledger entries */
  mode?: 'original' | 'extension';
  /** The extension period dates — required when mode is 'extension' */
  extensionDates?: { start: string; end: string };
  /** When set, stamps extension_id on the created bonzah policy + ledger entry (Phase 5 per-extension isolation). */
  extensionId?: string | null;
  /** Offered in the availability notice when the window has no insurable days. */
  onUploadOwnPolicy?: () => void;
}

const DEFAULT_COVERAGE: CoverageOptions = {
  cdw: false,
  rcli: false,
  sli: false,
  pai: false,
};

export function BuyInsuranceDialog({
  open,
  onOpenChange,
  rental,
  onPurchaseComplete,
  mode = 'original',
  extensionDates,
  extensionId,
  onUploadOwnPolicy,
}: BuyInsuranceDialogProps) {
  const isExtension = mode === 'extension';
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useAuditLogOnOpen({
    open,
    action: "buy_insurance_dialog_shown",
    entityType: "insurance",
    entityId: rental.id,
  });
  const { balanceNumber: bonzahCdBalance, portalUrl: bonzahPortalUrl } = useBonzahBalance();
  const {
    isEligible: isBonzahEligible,
    isLoading: isBonzahEligibilityLoading,
  } = useBonzahVehicleEligibility({
    vehicleMake: rental.vehicles.make,
    vehicleModel: rental.vehicles.model,
    enabled: open,
  });

  const [step, setStep] = useState<1 | 2>(1);
  const [coverage, setCoverage] = useState<CoverageOptions>(DEFAULT_COVERAGE);
  const [premium, setPremium] = useState(0);
  const [purchasing, setPurchasing] = useState(false);
  const [customerState, setCustomerState] = useState('FL');
  // Holds the backend's duplicate-policy message when an active policy already
  // covers these dates. Surfacing it as an explicit confirm prevents accidental
  // double-issuance (which charges the Bonzah balance twice).
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  // Load customer's state when dialog opens (for accurate premium calculation)
  useEffect(() => {
    if (!open || !rental.customers?.id) return;
    supabase
      .from('customers')
      .select('address_state')
      .eq('id', rental.customers.id)
      .single()
      .then(({ data }) => {
        if (data?.address_state) setCustomerState(data.address_state);
      });
  }, [open, rental.customers?.id]);

  // Compute trip dates once — used by both the selector and the purchase handler.
  // Starts in the past clamp to Pacific-TOMORROW (not local today): Bonzah can't
  // start a policy today, and bonzah-create-quote clamps the same way — so the
  // preview prices exactly the window the purchase will actually cover.
  // PAYG rentals have a null end_date (open-ended); fall back to start+30d so this
  // dialog can still render without crashing even if it ever opens for a PAYG row.
  // (PAYG should not surface this dialog at all — guarded at the call site too.)
  const tripDates = (() => {
    if (isExtension && extensionDates) {
      return { start: clampToBonzahStart(extensionDates.start.split('T')[0]), end: extensionDates.end.split('T')[0] };
    }
    const rentalStart = rental.start_date?.split('T')[0] || getPacificToday();
    let rentalEnd = rental.end_date?.split('T')[0];
    if (!rentalEnd) {
      const fallback = new Date(`${rentalStart}T00:00:00Z`);
      fallback.setUTCDate(fallback.getUTCDate() + 30);
      rentalEnd = fallback.toISOString().split('T')[0];
    }
    return { start: clampToBonzahStart(rentalStart), end: rentalEnd };
  })();

  // After the clamp the window can be EMPTY (start >= end) — e.g. a same-day
  // 1-day extension. bonzah-calculate-premium would still quote 1 day for it
  // (Math.max(days, 1)), so gate here rather than show a phantom premium the
  // purchase step will always refuse.
  const hasInsurableWindow = tripDates.start < tripDates.end;

  const hasCoverage = coverage.cdw || coverage.rcli || coverage.sli || coverage.pai;

  const handleCoverageChange = (newCoverage: CoverageOptions, newPremium: number) => {
    setCoverage(newCoverage);
    setPremium(newPremium);
  };

  const handleSkipInsurance = () => {
    setCoverage(DEFAULT_COVERAGE);
    setPremium(0);
  };

  const handleClose = () => {
    setStep(1);
    setCoverage(DEFAULT_COVERAGE);
    setPremium(0);
    onOpenChange(false);
  };

  const handlePurchase = async (forceDuplicate = false) => {
    if (!tenant?.id || !rental.customers?.id) return;
    if (!hasInsurableWindow) return; // zero-night window — nothing Bonzah can sell

    setPurchasing(true);
    try {
      // 1. Fetch customer details (including address fields)
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('id, name, email, phone, license_number, license_state, date_of_birth, address_street, address_city, address_state, address_zip')
        .eq('id', rental.customers.id)
        .single();

      if (customerError || !customer) {
        throw new Error('Failed to fetch customer details');
      }

      // 2. Fetch identity verification data
      const { data: verification } = await supabase
        .from('identity_verifications')
        .select('first_name, last_name, date_of_birth, address')
        .eq('customer_id', rental.customers.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // 3. Resolve renter details
      const nameParts = (customer.name || 'N/A').split(' ');
      const firstName = verification?.first_name || nameParts[0] || 'N/A';
      const lastName = verification?.last_name || nameParts.slice(1).join(' ') || 'N/A';
      const dob = verification?.date_of_birth || customer.date_of_birth;

      if (!dob) {
        toast({
          title: 'Missing Information',
          description: 'Customer must have a date of birth on file before purchasing insurance. Complete identity verification first.',
          variant: 'destructive',
        });
        setPurchasing(false);
        return;
      }

      // Resolve address: use customer profile fields, fall back to verification address string
      const verificationAddress = verification?.address as string | null;
      let street = customer.address_street || '';
      let city = customer.address_city || '';
      let state = customer.address_state || '';
      let zip = customer.address_zip || '';

      // If customer profile address is empty, try to parse from verification address
      if (!street && verificationAddress) {
        street = verificationAddress;
        const zipMatch = verificationAddress.match(/\b(\d{5})\b/);
        if (zipMatch) zip = zipMatch[1];
      }

      const licenseNumber = customer.license_number || '';
      const licenseStateVal = customer.license_state || state || '';
      const pickupState = state || 'FL';

      // 4. Call bonzah-create-quote
      const { data: quoteResult, error: quoteError } = await supabase.functions.invoke('bonzah-create-quote', {
        body: {
          rental_id: rental.id,
          customer_id: rental.customers.id,
          tenant_id: tenant.id,
          trip_dates: tripDates,
          ...(isExtension && { policy_type: 'extension' }),
          ...(isExtension && extensionId ? { extension_id: extensionId } : {}),
          ...(forceDuplicate ? { force_duplicate: true } : {}),
          pickup_state: pickupState,
          coverage,
          renter: {
            first_name: firstName,
            last_name: lastName,
            dob: dob,
            email: customer.email || '',
            phone: customer.phone || '',
            address: {
              street,
              city,
              state: pickupState,
              zip,
            },
            license: {
              number: licenseNumber,
              state: licenseStateVal || pickupState,
            },
          },
        },
      });

      if (quoteError) {
        // Extract the actual error message + status from the edge function
        // response body. quoteError.context is a Response object — read .status
        // first (non-consuming), then .json() for the body.
        let bodyError: string | null = null;
        let status: number | null = null;
        try {
          if (quoteError.context instanceof Response) {
            status = quoteError.context.status;
            const parsed = await quoteError.context.json();
            bodyError = parsed?.error ?? null;
          } else if (quoteError.context && typeof quoteError.context === 'object') {
            bodyError = (quoteError.context as any)?.error ?? null;
          }
        } catch { /* ignore parse errors */ }

        // 409 = duplicate-policy guard. Don't error out — ask the operator to
        // explicitly confirm, then retry with force_duplicate.
        if (status === 409) {
          setDuplicateWarning(bodyError || 'This rental already has an active insurance policy covering these dates.');
          setPurchasing(false);
          return;
        }

        throw new Error(bodyError || quoteError.message || 'Failed to create Bonzah quote');
      }

      // 5. Confirm payment with Bonzah to issue the policy
      const policyRecordId = quoteResult?.policy_record_id;
      let policyActive = false;

      // Phase 5: stamp extension_id onto the bonzah policy so it's linked
      // to the specific rental_extensions row.
      if (policyRecordId && isExtension && extensionId) {
        await supabase
          .from('bonzah_insurance_policies')
          .update({ extension_id: extensionId })
          .eq('id', policyRecordId);
      }

      if (policyRecordId) {
        const { data: confirmResult, error: confirmError } = await supabase.functions.invoke('bonzah-confirm-payment', {
          body: {
            policy_record_id: policyRecordId,
            stripe_payment_intent_id: `portal-admin-${rental.id}`,
          },
        });

        if (confirmError) {
          console.error('Bonzah confirm payment error:', confirmError);
          // Parse the error body to check for insufficient_balance
          // confirmError.context is a Response object — must call .json() to get parsed body
          let errorBody: any = null;
          try {
            if (confirmError.context instanceof Response) {
              errorBody = await confirmError.context.json();
            } else if (confirmError.context && typeof confirmError.context === 'object') {
              errorBody = confirmError.context;
            }
          } catch { /* ignore parse errors */ }

          const isInsufficientBalance = errorBody?.error === 'insufficient_balance'
            || confirmError.message?.toLowerCase().includes('insufficient')
            || confirmError.message?.toLowerCase().includes('balance');

          if (isInsufficientBalance) {
            const mode = errorBody?.bonzah_mode || tenant?.bonzah_mode || 'test';
            const guidance = mode === 'live'
              ? 'Your Bonzah available balance is too low. Top up your Bonzah account and retry from the rental page.'
              : 'Your Bonzah allocated balance is too low. Allocate funds in the Bonzah portal and retry from the rental page.';
            toast({
              title: 'Insurance Quoted — Pending Balance',
              description: guidance,
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Insurance Quoted',
              description: 'Quote created but policy could not be activated. You can retry from the rental page.',
              variant: 'destructive',
            });
          }
        } else {
          policyActive = confirmResult?.policy_issued === true;
          console.log('Bonzah confirm result:', confirmResult);
        }
      }

      // 6. Insert ledger entry ONLY when the policy was actually issued.
      // If Bonzah confirm fails (e.g. insufficient balance), we must not
      // charge the customer — otherwise the ledger carries a charge with no
      // active policy, and retrying from the UI hits the unique index on
      // the orphan charge and silently fails.
      const actualPremium = quoteResult?.total_premium ?? premium;

      if (policyActive) {
        const { error: ledgerError } = await supabase
          .from('ledger_entries')
          .insert({
            type: 'Charge',
            category: isExtension ? 'Extension Insurance' : 'Insurance',
            amount: actualPremium,
            remaining_amount: actualPremium,
            reference: `BONZAH-${quoteResult?.policy_record_id || 'POLICY'}`,
            rental_id: rental.id,
            ...(isExtension && extensionId ? { extension_id: extensionId } : {}),
            customer_id: rental.customers.id,
            vehicle_id: rental.vehicles?.id,
            tenant_id: tenant.id,
            entry_date: new Date().toISOString().split('T')[0],
            due_date: isExtension && extensionDates ? extensionDates.end.split('T')[0] : new Date().toISOString().split('T')[0],
          });

        if (ledgerError) {
          console.error('Ledger entry error:', ledgerError);
          toast({
            title: 'Warning',
            description: 'Insurance purchased but failed to create charge entry. Add it manually.',
            variant: 'destructive',
          });
        }
      }

      // 7. Invalidate queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rental-bonzah-policy', rental.id] }),
        queryClient.invalidateQueries({ queryKey: ['rental-insurance-policies'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-charges'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-totals'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-refund-breakdown'] }),
        queryClient.invalidateQueries({ queryKey: ['rental-extension-totals'] }),
        queryClient.invalidateQueries({ queryKey: ['rental', rental.id] }),
        queryClient.invalidateQueries({ queryKey: ['ledger-entries'] }),
        queryClient.invalidateQueries({ queryKey: ['bonzah-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['bonzah-insufficient-balance-count'] }),
        queryClient.invalidateQueries({ queryKey: ['bonzah-pending-policies'] }),
      ]);

      if (policyActive) {
        toast({
          title: 'Insurance Active',
          description: `Bonzah policy issued and active. Premium: ${formatCurrency(actualPremium, tenant?.currency_code || 'USD')}`,
        });
      } else if (!policyRecordId) {
        // Quote was created but no policy_record_id — unusual
        toast({
          title: 'Insurance Quoted',
          description: 'Quote created. You may need to complete the purchase from the rental page.',
        });
      }
      // If insufficient_balance or other confirm error, toast was already shown above

      // 8. Close dialog. Only trigger the payment flow when the policy is
      // actually active — if Bonzah confirm failed (insufficient balance etc)
      // there's no charge on the ledger to collect against, so opening the
      // payment dialog would create an orphan payment with nothing to apply.
      handleClose();
      if (policyActive) {
        onPurchaseComplete(actualPremium);
      }
    } catch (error: any) {
      console.error('Buy insurance error:', error);
      // Clean up error message — strip "Bonzah API error:" prefix for user-friendly display
      let errorMsg = error.message || 'Failed to purchase insurance. Please try again.';
      errorMsg = errorMsg.replace(/^Bonzah API error:\s*/gi, '');
      toast({
        title: 'Insurance Error',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!purchasing) handleClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/bonzah-logo.svg" alt="Bonzah" className="h-6 w-auto dark:hidden" />
            <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-6 w-auto hidden dark:block" />
            {step === 1
              ? (isExtension ? 'Select Extension Insurance Coverage' : 'Select Insurance Coverage')
              : (isExtension ? 'Confirm Extension Insurance Purchase' : 'Confirm Insurance Purchase')}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? (isExtension
                ? `Choose Bonzah insurance coverage for the extension period.`
                : 'Choose Bonzah insurance coverage for this rental.')
              : (isExtension
                ? 'Review and confirm the extension insurance purchase.'
                : 'Review and confirm the insurance purchase.')}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            {isBonzahEligibilityLoading ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <Loader2 className="w-6 h-6 animate-spin text-[#CC004A]" />
                <p className="text-sm text-muted-foreground">Checking insurance eligibility...</p>
              </div>
            ) : !isBonzahEligible ? (
              <div className="rounded-lg border border-[#CC004A]/30 bg-[#CC004A]/5 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-0.5">
                    <img src="/bonzah-logo.svg" alt="Bonzah" className="h-5 w-auto dark:hidden" />
                    <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-5 w-auto hidden dark:block" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-medium text-[#CC004A]">
                      Vehicle Not Covered
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium">{rental.vehicles.make} {rental.vehicles.model}</span> is not eligible for Bonzah insurance. This vehicle type is excluded from their coverage program.
                    </p>
                    <a
                      href="https://bonzah.com/included-and-restricted-vehicle-types"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#CC004A]/70 hover:text-[#CC004A] underline inline-block pt-1"
                    >
                      View Bonzah vehicle restrictions
                    </a>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button variant="outline" onClick={handleClose}>Close</Button>
                </div>
              </div>
            ) : (
              <>
                {/* Premium bar at top */}
                <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">Insurance Premium</span>
                    {hasCoverage && (
                      <span className="text-xs text-muted-foreground">
                        ({getActiveCoverageLabels(coverage, { cdw: 'CDW', rcli: 'RCLI', sli: 'SLI', pai: 'PAI' }).map(c => c.label).join(', ')})
                      </span>
                    )}
                  </div>
                  <span className="text-lg font-bold text-primary">
                    {formatCurrency(premium, tenant?.currency_code || 'USD')}
                  </span>
                </div>

                {hasInsurableWindow ? (
                  <BonzahInsuranceSelector
                    tripStartDate={tripDates.start}
                    tripEndDate={tripDates.end}
                    pickupState={customerState}
                    onCoverageChange={handleCoverageChange}
                    onSkipInsurance={handleSkipInsurance}
                    hidePremiumSummary
                  />
                ) : (
                  <BonzahAvailabilityNotice
                    windowStart={(isExtension && extensionDates
                      ? extensionDates.start
                      : rental.start_date || getPacificToday()
                    ).split('T')[0]}
                    windowEnd={tripDates.end}
                    onUploadOwnPolicy={onUploadOwnPolicy}
                  />
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!hasInsurableWindow || !hasCoverage || premium <= 0}
                    onClick={() => setStep(2)}
                  >
                    Continue
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Premium Summary */}
            <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-green-600" />
                <h3 className="font-medium">Insurance Summary</h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Customer</p>
                  <p className="font-medium">{rental.customers?.name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Vehicle</p>
                  <p className="font-medium">{rental.vehicles?.make} {rental.vehicles?.model} ({rental.vehicles?.reg})</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Coverage Period{isExtension ? ' (Extension)' : ''}</p>
                  {(() => {
                    const effectiveStart = tripDates.start;
                    const rentalEnd = tripDates.end;
                    const rawStart = isExtension && extensionDates ? extensionDates.start.split('T')[0] : rental.start_date.split('T')[0];
                    const isClamped = rawStart < effectiveStart;
                    // Bonzah max 30 days per policy — auto-chains multiple policies
                    const totalDays = Math.ceil((new Date(rentalEnd + 'T00:00:00').getTime() - new Date(effectiveStart + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24));
                    const policyCount = Math.ceil(totalDays / 30);
                    const isChained = policyCount > 1;
                    return (
                      <>
                        <p className="font-medium">
                          {new Date(effectiveStart + 'T00:00:00').toLocaleDateString('en-US')} - {new Date(rentalEnd + 'T00:00:00').toLocaleDateString('en-US')}
                        </p>
                        {isClamped && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Rental started {new Date(rawStart + 'T00:00:00').toLocaleDateString('en-US')} — coverage begins tomorrow (Pacific time)
                          </p>
                        )}
                        {isChained && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 flex items-center gap-1">
                            <Info className="h-3 w-3" />
                            {policyCount} sequential policies will be created (Bonzah max 30 days per policy)
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div>
                  <p className="text-muted-foreground">Selected Coverage</p>
                  <p className="font-medium">
                    {getActiveCoverageLabels(coverage, { cdw: 'CDW', rcli: 'RCLI', sli: 'SLI', pai: 'PAI' }).map(c => c.label).join(', ')}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t flex items-center justify-between">
                <span className="font-medium">Total Premium</span>
                <span className="text-lg font-bold text-green-600">
                  {formatCurrency(premium, tenant?.currency_code || 'USD')}
                </span>
              </div>
            </div>

            {premium > 0 && (() => {
              const mode = tenant?.bonzah_mode || 'test';
              const balanceSufficient = bonzahCdBalance != null && bonzahCdBalance >= premium;
              return (
                <div className={`rounded-lg border p-3 space-y-2 ${
                  mode === 'live' && balanceSufficient
                    ? 'border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-800'
                    : 'border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800'
                }`}>
                  <div className="flex items-start gap-2">
                    <Info className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                      mode === 'live' && balanceSufficient ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'
                    }`} />
                    <p className="text-sm text-muted-foreground">
                      {bonzahCdBalance != null && <>{mode === 'live' ? 'Balance' : 'Allocated Balance'}: <span className="font-medium">${bonzahCdBalance.toFixed(2)}</span>. </>}
                      {mode === 'live' ? (
                        balanceSufficient
                          ? <>Your balance covers this premium. The policy will activate immediately.</>
                          : <>Your Bonzah balance is too low for this premium. Top up your account or the policy will be quoted for later activation.</>
                      ) : (
                        <>The policy will only activate if your Bonzah <strong>allocated balance</strong> is sufficient. If not, the policy will be quoted and you can retry after allocating more funds.</>
                      )}
                    </p>
                  </div>
                  {!(mode === 'live' && balanceSufficient) && (
                    <a
                      href={bonzahPortalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline ml-6"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {mode === 'live' ? 'Top Up Balance' : 'Check Allocated Balance'}
                    </a>
                  )}
                </div>
              );
            })()}

            <p className="text-xs text-muted-foreground">
              Purchasing will create a Bonzah insurance policy and add an insurance charge to the rental ledger.
              You will be prompted to collect payment after the purchase.
            </p>

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(1)} disabled={purchasing}>
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose} disabled={purchasing}>
                  Cancel
                </Button>
                <Button onClick={() => handlePurchase()} disabled={purchasing}>
                  {purchasing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                      Purchasing...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 mr-1.5" />
                      Purchase Insurance
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Duplicate-policy guard: the rental already has an active policy covering
        these dates. Force a deliberate confirmation before issuing a second one. */}
    <AlertDialog open={!!duplicateWarning} onOpenChange={(v) => { if (!v) setDuplicateWarning(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Already insured for these dates
          </AlertDialogTitle>
          <AlertDialogDescription>
            {duplicateWarning}
            {' '}Issuing another policy will charge your Bonzah balance a second time for the same period.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={purchasing}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={purchasing}
            className="bg-amber-600 hover:bg-amber-700"
            onClick={(e) => {
              e.preventDefault();
              setDuplicateWarning(null);
              handlePurchase(true);
            }}
          >
            Issue anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
