/**
 * useMatchingEngine — Spec Section 6.5.
 * Calls run-matching-engine for a lead. Cached by leadId + last_activity_at.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Availability = "full" | "partial" | "unavailable";
export type BudgetFit = "under" | "within" | "over";

export interface MatchVehicle {
  vehicleId: string;
  name: string;
  class: string;
  photoUrl: string | null;
  startDate: string;
  endDate: string;
  weeklyRate: number;
  dailyRate: number;
  available: Availability;
}

export interface MatchOption {
  kind: "single" | "stitched" | "conditional";
  vehicles: MatchVehicle[];
  conditions?: string[];
  matchScore: number;
  reasoning?: string[];
  totalPrice: number;
  budgetFit: BudgetFit;
  insuranceEligible: boolean;
  aiScore?: number;
  acceptanceProbability?: number;
}

export interface MatchResult {
  generatedAt: string;
  options: MatchOption[];
}

export function useMatchingEngine(leadId: string | undefined, lastUpdated?: string) {
  return useQuery({
    queryKey: ["matching", leadId, lastUpdated],
    queryFn: async (): Promise<MatchResult> => {
      if (!leadId) return { generatedAt: new Date().toISOString(), options: [] };
      const { data, error } = await supabase.functions.invoke<MatchResult>("run-matching-engine", {
        body: { leadId },
      });
      if (error) throw error;
      return data ?? { generatedAt: new Date().toISOString(), options: [] };
    },
    enabled: !!leadId,
    staleTime: 5 * 60_000,
  });
}
