'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
} from '@drive247/ui';
import type {
  CalculatePremiumResponse,
  CoverageSelection,
  EligibilityCheckResponse,
  RenterDetails,
  RentalDetail,
} from '@drive247/shared-types';
import { bonzahApi } from '@/lib/api';
import { CoverageTiles } from './coverage-tiles';
import { PremiumBreakdown } from './premium-breakdown';
import { RenterDetailsForm } from './renter-details-form';

interface Props {
  rental: RentalDetail;
  defaultRenter: RenterDetails;
  onClose: () => void;
  onQuoted: () => void;
}

const DEFAULT_COVERAGE: CoverageSelection = {
  cdw: true,
  rcli: true,
  sli: false,
  pai: false,
};

export function InsuranceSelectorDialog({
  rental,
  defaultRenter,
  onClose,
  onQuoted,
}: Props) {
  const [coverage, setCoverage] = useState<CoverageSelection>(DEFAULT_COVERAGE);
  const [pickupState, setPickupState] = useState('NY');
  const [renter, setRenter] = useState<RenterDetails>(defaultRenter);
  const [eligibility, setEligibility] =
    useState<EligibilityCheckResponse | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(true);
  const [premium, setPremium] = useState<CalculatePremiumResponse | null>(null);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const atLeastOneSelected = useMemo(
    () => coverage.cdw || coverage.rcli || coverage.sli || coverage.pai,
    [coverage],
  );

  // Run vehicle eligibility check on mount
  useEffect(() => {
    (async () => {
      try {
        const { data: res } = await bonzahApi.checkEligibility({
          vehicleId: rental.vehicle.id,
        });
        if (res.success) setEligibility(res.data);
      } catch (err: any) {
        toast.error(
          err.response?.data?.message || 'Eligibility check failed',
        );
      } finally {
        setEligibilityLoading(false);
      }
    })();
  }, [rental.vehicle.id]);

  // Debounced premium calc whenever coverage, state, or dates change
  useEffect(() => {
    if (!atLeastOneSelected || !pickupState || pickupState.length !== 2) {
      setPremium(null);
      return;
    }
    setPremiumLoading(true);
    const t = setTimeout(async () => {
      try {
        const { data: res } = await bonzahApi.calculatePremium({
          tripStartDate: rental.startDate,
          tripEndDate: rental.endDate,
          pickupState,
          coverage,
        });
        if (res.success) setPremium(res.data);
      } catch {
        setPremium(null);
      } finally {
        setPremiumLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [coverage, pickupState, rental.startDate, rental.endDate, atLeastOneSelected]);

  const handleSubmit = async () => {
    if (!atLeastOneSelected) {
      toast.error('Select at least one coverage');
      return;
    }
    if (eligibility && !eligibility.eligible) {
      toast.error('Vehicle is not eligible for Bonzah coverage');
      return;
    }

    // Explicit field-level guards so the user sees a specific error, not a
    // generic "Validation failed" from the backend. (Backend DTO still
    // validates — this is belt-and-braces.)
    const missing = findMissingRenterField(renter);
    if (missing) {
      toast.error(`Please fill in: ${missing}`);
      return;
    }
    if (!/^\d{11}$/.test(renter.phone)) {
      toast.error('Phone must be 11 digits (country code + mobile, no "+")');
      return;
    }
    if (pickupState.length !== 2) {
      toast.error('Pickup state must be a 2-letter code (e.g. NY)');
      return;
    }

    setSubmitting(true);
    try {
      await bonzahApi.createQuote({
        rentalId: rental.id,
        coverage,
        pickupState,
        renter,
      });
      toast.success('Quote created — confirm payment to issue the policy');
      onQuoted();
    } catch (err: any) {
      const resp = err.response?.data;
      // Surface the first Zod field error when present
      if (Array.isArray(resp?.errors) && resp.errors.length > 0) {
        const first = resp.errors[0];
        toast.error(`${first.path}: ${first.message}`);
      } else {
        toast.error(resp?.message || 'Quote failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Add Bonzah Insurance</DialogTitle>
        <DialogDescription>
          {rental.vehicle.reg} · {rental.vehicle.make} {rental.vehicle.model} · {rental.startDate} → {rental.endDate}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 py-2">
        {eligibilityLoading && (
          <div className="rounded-md border bg-[#f8fafc] p-3 text-sm text-muted-foreground">
            Checking vehicle eligibility...
          </div>
        )}
        {eligibility && !eligibility.eligible && (
          <div className="rounded-md border border-[#dc2626] bg-[#fef2f2] p-3 text-sm text-[#dc2626]">
            <div className="font-medium">Vehicle not eligible</div>
            <div className="mt-1 text-xs">
              {eligibility.reason ?? 'Bonzah restricts this vehicle.'}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-medium mb-2">Coverage</h3>
          <CoverageTiles value={coverage} onChange={setCoverage} />
        </div>

        <div className="space-y-2 max-w-xs">
          <Label htmlFor="pickup-state">Pickup state (2-letter)</Label>
          <Input
            id="pickup-state"
            value={pickupState}
            maxLength={2}
            onChange={(e) => setPickupState(e.target.value.toUpperCase())}
            className="bg-white"
          />
        </div>

        <PremiumBreakdown premium={premium} loading={premiumLoading} />

        <Separator />

        <div>
          <h3 className="text-sm font-medium mb-2">Renter Details</h3>
          <RenterDetailsForm value={renter} onChange={setRenter} />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={
            submitting ||
            eligibilityLoading ||
            (eligibility !== null && !eligibility.eligible) ||
            !atLeastOneSelected
          }
        >
          {submitting ? 'Creating quote...' : 'Create quote'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/**
 * Returns the first missing required-field label, or null if complete.
 * Human-readable so the toast message is actionable.
 */
function findMissingRenterField(r: RenterDetails): string | null {
  if (!r.firstName.trim()) return 'First name';
  if (!r.lastName.trim()) return 'Last name';
  if (!r.dob) return 'Date of birth';
  if (!r.email.trim()) return 'Email';
  if (!r.phone.trim()) return 'Phone';
  if (!r.license.number.trim()) return 'Driver license number';
  if (!r.license.state.trim()) return 'Driver license state';
  if (!r.address.street.trim()) return 'Address street';
  if (!r.address.city.trim()) return 'Address city';
  if (!r.address.state.trim()) return 'Address state';
  if (!r.address.zip.trim()) return 'Address ZIP';
  return null;
}
