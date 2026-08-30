/**
 * Feature access matrix — maps the tenant's subscription plan_name to gated features.
 *
 * Plan name is matched case-insensitively against substrings, so admin can name
 * plans whatever they like ("Drive247 Pro", "Premium", "Growth — Q1 2026") and
 * the matrix still works.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * History: this module previously also carried the Revenue Optimiser feature
 * keys. Revenue Optimiser was removed from the product in 1e447d08 and this
 * file went with it. It is reinstated here scoped to Finance Sync ONLY —
 * do not re-add the revenue_optimiser_* keys, that surface is intentionally gone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Features gated on subscription tier. */
export type GatedFeature = "finance_sync"; // accounting integration (Growth+)

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
const FEATURE_MIN_TIER: Record<GatedFeature, Tier> = {
  finance_sync: "growth",
};

const TIER_RANK: Record<Tier, number> = { basic: 0, pro: 1, growth: 2 };

export function tierMeetsRequirement(currentTier: Tier, requiredTier: Tier): boolean {
  return TIER_RANK[currentTier] >= TIER_RANK[requiredTier];
}

export function planNameHasFeature(
  planName: string | null | undefined,
  feature: GatedFeature,
): boolean {
  return tierMeetsRequirement(resolveTier(planName), FEATURE_MIN_TIER[feature]);
}

/** Human-readable label for the minimum tier — used in upgrade CTAs. */
export function minimumTierLabel(feature: GatedFeature): string {
  return FEATURE_MIN_TIER[feature] === "growth" ? "Growth" : "Pro";
}
