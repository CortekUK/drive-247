'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useMemo, useState, useEffect } from 'react';

export interface CoverageOptions {
  cdw: boolean;
  rcli: boolean;
  sli: boolean;
  pai: boolean;
}

export interface PremiumBreakdown {
  cdw: number;
  rcli: number;
  sli: number;
  pai: number;
}

export interface BonzahPremiumResult {
  total_premium: number;
  breakdown: PremiumBreakdown;
}

interface UseBonzahPremiumParams {
  tripStartDate: string | null;  // YYYY-MM-DD
  tripEndDate: string | null;    // YYYY-MM-DD
  pickupState: string | null;    // US state code, e.g., "FL"
  coverage: CoverageOptions;
  enabled?: boolean;
}

/**
 * Hook to calculate Bonzah insurance premium based on trip details and coverage options.
 * Uses debouncing to avoid excessive API calls when coverage options change.
 */
export function useBonzahPremium({
  tripStartDate,
  tripEndDate,
  pickupState,
  coverage,
  enabled = true,
}: UseBonzahPremiumParams) {
  const { tenant } = useTenant();

  // Debounce coverage changes
  const [debouncedCoverage, setDebouncedCoverage] = useState(coverage);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCoverage(coverage);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [coverage.cdw, coverage.rcli, coverage.sli, coverage.pai]);

  // Check if we have all required parameters
  const hasRequiredParams = Boolean(
    tripStartDate &&
    tripEndDate &&
    pickupState
  );

  // Check if any coverage is selected
  const hasCoverage = debouncedCoverage.cdw || debouncedCoverage.rcli ||
                      debouncedCoverage.sli || debouncedCoverage.pai;

  const queryKey = useMemo(() => [
    'bonzah-premium',
    tenant?.id,
    tripStartDate,
    tripEndDate,
    pickupState,
    debouncedCoverage.cdw,
    debouncedCoverage.rcli,
    debouncedCoverage.sli,
    debouncedCoverage.pai,
  ], [
    tenant?.id,
    tripStartDate,
    tripEndDate,
    pickupState,
    debouncedCoverage,
  ]);

  const query = useQuery<BonzahPremiumResult>({
    queryKey,
    queryFn: async (): Promise<BonzahPremiumResult> => {
      // If no coverage selected, return zero without calling API
      if (!hasCoverage) {
        return {
          total_premium: 0,
          breakdown: { cdw: 0, rcli: 0, sli: 0, pai: 0 },
        };
      }

      const { data, error } = await supabase.functions.invoke('bonzah-calculate-premium', {
        body: {
          trip_start_date: tripStartDate,
          trip_end_date: tripEndDate,
          pickup_state: pickupState,
          cdw_cover: debouncedCoverage.cdw,
          rcli_cover: debouncedCoverage.rcli,
          sli_cover: debouncedCoverage.sli,
          pai_cover: debouncedCoverage.pai,
        },
      });

      if (error) {
        console.error('[useBonzahPremium] Error:', error);
        throw new Error(error.message || 'Failed to calculate premium');
      }

      return data as BonzahPremiumResult;
    },
    enabled: enabled && hasRequiredParams,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 2,
    refetchOnWindowFocus: false,
  });

  return {
    totalPremium: query.data?.total_premium ?? 0,
    breakdown: query.data?.breakdown ?? { cdw: 0, rcli: 0, sli: 0, pai: 0 },
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    isReady: hasRequiredParams,
  };
}

/**
 * Coverage descriptions and info for UI display.
 *
 * COMPLIANCE DATA - DO NOT REWORD. Every description, limit, deductible and
 * exclusion below is transcribed from Bonzah's "Embedded Insurance Compliance
 * Requirements" document (Brandon Rockow, 5-6 Aug 2026), which specifies what
 * must appear on a rental car company's website. Keep the insurer's own
 * phrasing and punctuation - including "PIM" in the CDW/RCLI exclusions and
 * "PIP" in SLI's, which is how the source document writes them.
 *
 * `name` says "Collision Damage Waiver" rather than the source document's
 * product heading "Collision Damage Warranty": the same document's operative
 * Insurance Disclosure paragraph calls it "Collision Damage Waiver (CDW/LDW)",
 * and that is the wording the renter agrees to.
 *
 * Duplicated byte-for-byte in apps/portal/src/hooks/use-bonzah-premium.ts.
 */
export const COVERAGE_INFO = {
  cdw: {
    name: 'Collision Damage Waiver',
    shortName: 'CDW',
    tagline: 'Affordable Rental Vehicle Damage Insurance',
    description: 'Covers physical damages to the rental vehicle when there is an accident with another vehicle.',
    deductible: '$1,000',
    deductibleLabel: '$1,000 Deductible',
    maxCoverage: '$35,000',
    features: [
      'Up to $35,000 Damage',
      '$1,000 Deductible',
      'Primary Insurance for accidents between vehicles',
    ],
    exclusions: [
      'Does not cover non-rental vehicle damage',
      'Excludes medical, PIM, UIM, UM and comprehensive coverage, such as mechanical issues caused by misuse, theft, vandalism, single car accident',
      'Not for commercial use. Not compatible with cars for hire and delivery services such as Uber, Lyft, DoorDash.',
    ],
  },
  rcli: {
    name: "Renter's Contingent Liability Insurance",
    shortName: 'RCLI',
    tagline: 'Primary State Minimum Liability Insurance',
    description: "Covers damage to 3rd parties' property and injury when renter is at fault in accident. Does not cover rental vehicle damage or occupants (where allowed by law).",
    deductible: 'None',
    deductibleLabel: 'No Deductible',
    maxCoverage: 'State minimum limits',
    features: [
      'Bodily Injury - Per Person - $25,000.00 (specific to your state)',
      'Bodily Injury - Aggregate - $50,000.00 (specific to your state)',
      'Property Damage - $25,000.00 (specific to your state)',
    ],
    exclusions: [
      'Does not cover rental vehicle damage',
      'Excludes medical, PIM, UIM, and UM where allowed by law',
      'Not for commercial use. Not compatible with cars for hire and delivery services such as Uber, Lyft, DoorDash.',
    ],
  },
  sli: {
    name: 'Supplemental Liability Insurance',
    shortName: 'SLI',
    tagline: 'Coverage is in Excess of Any Primary Liability Coverage',
    description: 'Supplements RCLI coverage to enhanced levels of coverage. Not a standalone or primary policy, must be purchased with RCLI.',
    requiresRcli: true,
    deductible: 'None',
    deductibleLabel: 'No Deductible',
    maxCoverage: '$500,000',
    features: [
      'Bodily Injury - Per Person - Up to $100,000 in total',
      'Bodily Injury - Aggregate - Up to $500,000 in total',
      'Property Damage - $10,000 additional coverage',
    ],
    exclusions: [
      'Does not cover rental vehicle damage',
      'Excludes medical, PIP, UIM, and UM where allowed by law',
      'Not for commercial use. Not compatible with cars for hire and delivery services such as Uber, Lyft, DoorDash.',
    ],
  },
  pai: {
    name: 'Personal Accident / Personal Effects Insurance',
    shortName: 'PAI',
    tagline: 'Accident, Medical & Personal Effects Insurance',
    description: 'Covers life, medical expenses, and lost or damaged items. Not rental vehicle coverage.',
    // PAI carries a real $25 deductible on personal effects. It previously read
    // 'None', which rendered a green "No Deductible" badge while the card's own
    // exclusion list said otherwise - understating a deductible to the renter.
    deductible: '$25',
    deductibleLabel: '$25 Personal Effects Deductible',
    maxCoverage: '$50,000',
    features: [
      'Renter Loss of Life - $50,000',
      'Passenger Loss of Life - $5,000',
      'Accidental Medical Expense - $1,000',
      'Personal Effects Coverage - $500 with up to $25 deductible will be applied',
    ],
    exclusions: [
      'Not rental vehicle coverage',
      'Does not cover non-accident related losses',
    ],
  },
} as const;
