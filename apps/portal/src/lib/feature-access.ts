/**
 * Feature access matrix — maps subscription plan_name to Revenue Optimiser features.
 *
 * Spec §16: Pro tier = Insights only (read), Growth tier = Recommendations + Autopilot.
 *
 * Plan name is matched case-insensitively against substrings, so admin can name
 * plans whatever they like ("Drive247 Pro", "Premium", "Growth — Q1 2026") and
 * the matrix still works.
 *
 * Centralised so the sidebar gate, the welcome screen CTA, and the Autopilot tab
 * all read from the same source of truth.
 */

export type RevenueOptimiserFeature =
  | "revenue_optimiser_insights"
  | "revenue_optimiser_recommendations"
  | "revenue_optimiser_autopilot"
  | "finance_sync";  // Xero / Zoho Books integration (Growth+)

export type Tier = "basic" | "pro" | "growth";

/**
 * Resolve a plan_name string into a tier. Returns 'basic' if no plan or
 * the plan name doesn't match any known tier keyword.
 */
export function resolveTier(planName: string | null | undefined): Tier {
  if (!planName) return "basic";
  const n = planName.toLowerCase();
  if (/growth/.test(n)) return "growth";
  if (/pro|premium/.test(n)) return "pro";
  return "basic";
}

/**
 * Feature → minimum tier table. Anything at or above the minimum tier can
 * access the feature.
 */
const FEATURE_MIN_TIER: Record<RevenueOptimiserFeature, Tier> = {
  revenue_optimiser_insights: "pro",
  revenue_optimiser_recommendations: "growth",
  revenue_optimiser_autopilot: "growth",
  finance_sync: "growth",
};

const TIER_RANK: Record<Tier, number> = { basic: 0, pro: 1, growth: 2 };

export function tierMeetsRequirement(currentTier: Tier, requiredTier: Tier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[requiredTier];
}

export function planNameHasFeature(
  planName: string | null | undefined,
  feature: RevenueOptimiserFeature,
): boolean {
  return tierMeetsRequirement(resolveTier(planName), FEATURE_MIN_TIER[feature]);
}

/** Human-readable label for the minimum tier — used in upgrade CTAs. */
export function minimumTierLabel(feature: RevenueOptimiserFeature): string {
  return FEATURE_MIN_TIER[feature] === "growth" ? "Growth" : "Pro";
}
