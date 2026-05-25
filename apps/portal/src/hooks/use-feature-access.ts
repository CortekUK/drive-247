/**
 * useFeatureAccess — gate components on subscription tier.
 *
 * Wraps `useTenantSubscription` and the feature-access matrix in [feature-access.ts](../lib/feature-access.ts).
 *
 * Usage:
 *   const { canAccess, planName, requiredTier } = useFeatureAccess('revenue_optimiser_insights');
 *   if (!canAccess) return <UpgradePrompt requiredTier={requiredTier} />;
 */
"use client";

import { useTenantSubscription } from "./use-tenant-subscription";
import {
  planNameHasFeature,
  resolveTier,
  minimumTierLabel,
  type RevenueOptimiserFeature,
  type Tier,
} from "@/lib/feature-access";

export interface FeatureAccessResult {
  canAccess: boolean;
  planName: string | null;
  currentTier: Tier;
  requiredTierLabel: string;
  isLoading: boolean;
}

export function useFeatureAccess(feature: RevenueOptimiserFeature): FeatureAccessResult {
  const { subscription, isLoading } = useTenantSubscription();
  const planName = subscription?.plan_name ?? null;
  return {
    canAccess: planNameHasFeature(planName, feature),
    planName,
    currentTier: resolveTier(planName),
    requiredTierLabel: minimumTierLabel(feature),
    isLoading,
  };
}
