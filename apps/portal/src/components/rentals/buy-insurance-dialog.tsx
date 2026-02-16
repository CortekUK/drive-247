'use client';

import { useState, useEffect } from 'react';
import { Loader2, Shield, ShieldCheck, ArrowLeft, ArrowRight, AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/hooks/use-toast';
import { type CoverageOptions } from '@/hooks/use-bonzah-premium';
import { formatCurrency } from '@/lib/format-utils';
import BonzahInsuranceSelector from '@/components/rentals/bonzah-insurance-selector';
import { useBonzahBalance } from '@/hooks/use-bonzah-balance';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface BuyInsuranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rental: {
    id: string;
    start_date: string;
    end_date: string;
    customer_id?: string;
    customers: { id: string; name: string; email?: string; phone?: string | null };
    vehicles: { id: string; reg: string; make: string; model: string };
  };
  onPurchaseComplete: (premium: number) => void;
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
}: BuyInsuranceDialogProps) {
  const { tenant } = useTenant();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { balanceNumber: bonzahCdBalance } = useBonzahBalance();

  const [step, setStep] = useState<1 | 2>(1);
  const [coverage, setCoverage] = useState<CoverageOptions>(DEFAULT_COVERAGE);
  const [premium, setPremium] = useState(0);
  const [purchasing, setPurchasing] = useState(false);
  const [customerState, setCustomerState] = useState('FL');

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

  const handlePurchase = async () => {
    if (!tenant?.id || !rental.customers?.id) return;

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
          trip_dates: {
            start: rental.start_date.split('T')[0],
            end: rental.end_date.split('T')[0],
          },
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
        // Extract actual error message from edge function response body
        const contextError = typeof quoteError.context === 'object' && quoteError.context?.error;
        throw new Error(contextError || quoteError.message || 'Failed to create Bonzah quote');
      }

      // 5. Confirm payment with Bonzah to issue the policy
      const policyRecordId = quoteResult?.policy_record_id;
      if (policyRecordId) {
        const { data: confirmResult, error: confirmError } = await supabase.functions.invoke('bonzah-confirm-payment', {
          body: {
            policy_record_id: policyRecordId,
            stripe_payment_intent_id: `portal-admin-${rental.id}`,
          },
        });

        if (confirmError) {
          console.error('Bonzah confirm payment error:', confirmError);
          toast({
            title: 'Warning',
            description: 'Insurance quote created but policy issuance failed. You may need to retry.',
            variant: 'destructive',
          });
        } else {
          console.log('Bonzah policy issued:', confirmResult);
        }
      }

      // 6. Insert ledger entry for insurance charge

      const { error: ledgerError } = await supabase
        .from('ledger_entries')
        .insert({
          type: 'Charge',
          category: 'Insurance',
          amount: premium,
          remaining_amount: premium,
          reference: `BONZAH-${quoteResult?.policy_record_id || 'POLICY'}`,
          rental_id: rental.id,
          customer_id: rental.customers.id,
          vehicle_id: rental.vehicles?.id,
          tenant_id: tenant.id,
          entry_date: new Date().toISOString().split('T')[0],
          due_date: new Date().toISOString().split('T')[0],
        });

      if (ledgerError) {
        console.error('Ledger entry error:', ledgerError);
        // Non-fatal — policy was created, just the charge failed
        toast({
          title: 'Warning',
          description: 'Insurance purchased but failed to create charge entry. Add it manually.',
          variant: 'destructive',
        });
      }

      // 7. Invalidate queries
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rental-bonzah-policy', rental.id] }),
        queryClient.invalidateQueries({ queryKey: ['rental-charges', rental.id] }),
        queryClient.invalidateQueries({ queryKey: ['rental-totals', rental.id] }),
        queryClient.invalidateQueries({ queryKey: ['rental-payment-breakdown', rental.id] }),
        queryClient.invalidateQueries({ queryKey: ['rental', rental.id] }),
        queryClient.invalidateQueries({ queryKey: ['ledger-entries'] }),
      ]);

      toast({
        title: 'Insurance Purchased',
        description: `Bonzah insurance policy created. Premium: ${formatCurrency(premium, tenant?.currency_code || 'USD')}`,
      });

      // 8. Close dialog and trigger payment flow
      handleClose();
      onPurchaseComplete(premium);
    } catch (error: any) {
      console.error('Buy insurance error:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to purchase insurance. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!purchasing) handleClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="/bonzah-logo.svg" alt="Bonzah" className="h-6 w-auto dark:hidden" />
            <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="h-6 w-auto hidden dark:block" />
            {step === 1 ? 'Select Insurance Coverage' : 'Confirm Insurance Purchase'}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Choose Bonzah insurance coverage for this rental.'
              : 'Review and confirm the insurance purchase.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            {/* Premium bar at top */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Insurance Premium</span>
                {hasCoverage && (
                  <span className="text-xs text-muted-foreground">
                    ({[
                      coverage.cdw && 'CDW',
                      coverage.rcli && 'RCLI',
                      coverage.sli && 'SLI',
                      coverage.pai && 'PAI',
                    ].filter(Boolean).join(', ')})
                  </span>
                )}
              </div>
              <span className="text-lg font-bold text-primary">
                {formatCurrency(premium, tenant?.currency_code || 'USD')}
              </span>
            </div>

            <BonzahInsuranceSelector
              tripStartDate={rental.start_date}
              tripEndDate={rental.end_date}
              pickupState={customerState}
              onCoverageChange={handleCoverageChange}
              onSkipInsurance={handleSkipInsurance}
              hidePremiumSummary
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                disabled={!hasCoverage || premium <= 0}
                onClick={() => setStep(2)}
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
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
                  <p className="text-muted-foreground">Coverage Period</p>
                  <p className="font-medium">
                    {new Date(rental.start_date).toLocaleDateString()} - {new Date(rental.end_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Selected Coverage</p>
                  <p className="font-medium">
                    {[
                      coverage.cdw && 'CDW',
                      coverage.rcli && 'RCLI',
                      coverage.sli && 'SLI',
                      coverage.pai && 'PAI',
                    ].filter(Boolean).join(', ')}
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

            {bonzahCdBalance != null && premium > bonzahCdBalance && (
              <div className="rounded-lg border border-[#CC004A]/30 bg-[#CC004A]/5 p-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-[#CC004A] mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Insurance premium (<span className="font-medium text-[#CC004A]">${premium.toFixed(2)}</span>) exceeds your current Bonzah balance (<span className="font-medium">${bonzahCdBalance.toFixed(2)}</span>). The policy will be created but won't activate until you top up.
                </p>
              </div>
            )}

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
                <Button onClick={handlePurchase} disabled={purchasing}>
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
  );
}
