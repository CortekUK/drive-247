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
 * Coverage descriptions and info for UI display
 */
export const COVERAGE_INFO = {
  cdw: {
    name: 'Collision Damage Waiver',
    shortName: 'CDW',
    description: 'Covers the cost of physical damage to the rental vehicle in the event of a collision with another vehicle.',
    deductible: '$1,000',
    maxCoverage: '$35,000',
    features: [
      'Up to $35,000 in rental car coverage',
      '$1,000 deductible',
      'Primary insurance for accidents between vehicles',
      'Covers physical damage to the rental vehicle',
    ],
    exclusions: [
      'Does not cover non-rental vehicle damage',
      'Comprehensive coverage (theft, vandalism, single car accidents)',
      'Mechanical issues caused by misuse',
      'No commercial driving during the rental period',
    ],
  },
  rcli: {
    name: "Renter's Contingent Liability Insurance",
    shortName: 'RCLI',
    description: 'Provides coverage for liability claims in case of bodily injury or property damage caused to third parties during the rental period.',
    deductible: 'None',
    maxCoverage: 'State minimum limits',
    features: [
      'Primary insurance for non-rental car damages when at fault',
      'Covers legal state minimum liability requirements',
      'Bodily injury claims up to state minimum per person',
      'Property damage up to state minimum',
    ],
    exclusions: [
      'Does not cover damage to the rental vehicle',
      "Does not cover renter's injuries",
      'Coverage limited to state minimum requirements',
      'Coverage amount varies based on state',
    ],
  },
  sli: {
    name: 'Supplemental Liability Insurance',
    shortName: 'SLI',
    description: 'Supplements RCLI coverage to enhanced levels. Coverage is in excess of any primary liability coverage.',
    requiresRcli: true,
    deductible: 'None',
    maxCoverage: '$500,000',
    features: [
      'Bodily injury up to $100,000 per person',
      'Bodily injury aggregate up to $500,000 total',
      'Excess property damage up to $10,000',
      'Coverage in excess of any primary liability',
    ],
    exclusions: [
      'Does not cover damage to the rental vehicle',
      'Not a standalone policy — requires RCLI',
      'Does not replace primary coverage',
      'Claims exceeding policy limits',
    ],
  },
  pai: {
    name: 'Personal Accident / Personal Effects Insurance',
    shortName: 'PAI',
    description: 'Covers life, medical expenses, and lost or damaged items. Not rental vehicle coverage.',
    deductible: 'None',
    maxCoverage: '$50,000',
    features: [
      'Renter loss of life — $50,000',
      'Passenger loss of life — $5,000',
      'Accidental medical expense — $1,000',
      'Personal effects coverage — $500',
    ],
    exclusions: [
      'Does not cover damages to the rental vehicle',
      'Not auto rental insurance',
      '$25 deductible on personal effects',
      'Does not cover non-accident related losses',
    ],
  },
} as const;
