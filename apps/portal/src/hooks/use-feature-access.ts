/**
 * useFeatureAccess — gate components on subscription tier.
 *
 * Wraps `useTenantSubscription` and the feature-access matrix in
 * [feature-access.ts](../lib/feature-access.ts).
 *
 * Usage:
 *   const access = useFeatureAccess('finance_sync');
 *   if (access.isLoading) return <Skeleton />;
 *   if (!access.canAccess) return <Paywall requiredTier={access.requiredTierLabel} />;
 */
"use client";

import { useTenantSubscription } from "./use-tenant-subscription";
import {
  planNameHasFeature,
  resolveTier,
  minimumTierLabel,
  type GatedFeature,
  type Tier,
} from "@/lib/feature-access";

export interface FeatureAccessResult {
  canAccess: boolean;
  planName: string | null;
  currentTier: Tier;
  requiredTierLabel: string;
  isLoading: boolean;
}

export function useFeatureAccess(feature: GatedFeature): FeatureAccessResult {
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
