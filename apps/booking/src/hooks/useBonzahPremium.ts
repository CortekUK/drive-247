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
    description: 'Covers damage to the rental vehicle from collisions and accidents. Reduces or eliminates your financial responsibility.',
  },
  rcli: {
    name: 'Rental Car Liability Insurance',
    shortName: 'RCLI',
    description: 'Provides liability coverage for bodily injury and property damage you may cause to others while driving the rental car.',
  },
  sli: {
    name: 'Supplemental Liability Insurance',
    shortName: 'SLI',
    description: 'Additional liability protection beyond the basic RCLI coverage. Provides higher limits for third-party claims.',
    requiresRcli: true, // SLI requires RCLI to be selected
  },
  pai: {
    name: 'Personal Accident Insurance',
    shortName: 'PAI',
    description: 'Covers medical expenses for you and your passengers in case of an accident, regardless of fault.',
  },
} as const;
