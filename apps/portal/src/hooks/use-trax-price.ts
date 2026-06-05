/**
 * Trax Pricing hooks.
 *
 *   useTraxPrice(vehicleId, tier)  — the math suggestion (cross-tenant comps +
 *                                    utilisation) via the trax_price_suggest RPC.
 *   useTraxWhy()                   — lazily fetches the Trax-voiced "Why?" narrative
 *                                    (LLM) for an already-computed suggestion.
 *
 * The number comes from the DB (never hallucinated). The narrative is only
 * requested when the operator opens the "Why?" dialog.
 */
"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
// RPC isn't in generated types yet — use the untyped client for it.
import { supabase, supabaseUntyped } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";

export type TraxTier = "daily" | "weekly" | "monthly";
export type TraxConfidence = "high" | "medium" | "low" | "none";
export type TraxDirection = "up" | "down" | "hold" | "set";

export interface TraxSuggestion {
  vehicle_id: string;
  tier: TraxTier;
  make?: string;
  model?: string;
  year?: number;
  current_price: number;
  suggested_price?: number;
  direction?: TraxDirection;
  delta_pct?: number | null;
  confidence: TraxConfidence;
  tier_used?: "make_model_year" | "make_model" | "make" | "none";
  comps?: {
    count: number;
    p10: number;
    p25: number;
    median: number;
    p75: number;
    p90: number;
  };
  utilization?: {
    booked_days_90d: number;
    ratio: number;
    level: "high" | "low" | "normal" | "unknown";
  };
  comp_count?: number; // present when confidence === 'none'
  error?: string;
}

export interface TraxPriceArgs {
  /** Existing vehicle — reads make/model/year + utilisation from the row. */
  vehicleId?: string;
  tier?: TraxTier;
  /** Draft mode (add-vehicle) — pass the typed make/model/year instead of an id. */
  make?: string;
  model?: string;
  year?: number;
  enabled?: boolean;
}

/**
 * Math suggestion for a vehicle + rate tier. Two modes:
 *   - existing vehicle: pass `vehicleId`
 *   - draft (add-vehicle): pass `make` + `model` (+ optional `year`)
 * Cached briefly; comps move slowly.
 */
export function useTraxPrice(args: TraxPriceArgs) {
  const { tenant } = useTenant();
  const { vehicleId, tier = "daily", make, model, year, enabled = true } = args;
  const canRun = !!vehicleId || (!!make?.trim() && !!model?.trim());

  return useQuery({
    queryKey: [
      "trax-price",
      tenant?.id,
      vehicleId ?? `draft:${make ?? ""}|${model ?? ""}|${year ?? ""}`,
      tier,
    ],
    enabled: enabled && canRun,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TraxSuggestion | null> => {
      const { data, error } = await supabaseUntyped.rpc("trax_price_suggest", {
        p_vehicle_id: vehicleId ?? null,
        p_tier: tier,
        p_make: make ?? null,
        p_model: model ?? null,
        p_year: year ?? null,
      });
      if (error) throw error;
      return (data as TraxSuggestion) ?? null;
    },
  });
}

/** Lazily fetch the Trax-voiced explanation for a computed suggestion. */
export function useTraxWhy() {
  return useMutation({
    mutationFn: async (args: {
      breakdown: TraxSuggestion;
      userName?: string;
      vehicleLabel?: string;
    }): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("trax-price-why", {
        body: args,
      });
      if (error) throw error;
      return (data as { reasoning: string })?.reasoning ?? "";
    },
  });
}
