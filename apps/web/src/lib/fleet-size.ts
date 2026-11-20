/**
 * "How many cars do you rent out?" on the signup's first page.
 *
 * One tap, three answers, and the answer picks the plan: 1–5 Starter,
 * 6–20 Growth, 21+ Scale. The visitor can still move with "Change plan" on the
 * card step.
 *
 * The server keeps the same three values in
 * `supabase/functions/_shared/signup-attribution.ts` (FLEET_SIZE_VALUES).
 */

import type { SignupPlan, SignupPlanId } from "./plans";

export const FLEET_SIZE_OPTIONS = [
  { value: "1-5", label: "1–5" },
  { value: "6-20", label: "6–20" },
  { value: "21+", label: "21+" },
] as const;

export type FleetSize = (typeof FLEET_SIZE_OPTIONS)[number]["value"];

export function isFleetSize(value: unknown): value is FleetSize {
  return FLEET_SIZE_OPTIONS.some((option) => option.value === value);
}

/** The plan each answer belongs on (the owner's mapping, 2026-11-20). */
export const FLEET_SIZE_PLAN: Record<FleetSize, "starter" | "growth" | "scale"> = {
  "1-5": "starter",
  "6-20": "growth",
  "21+": "scale",
};

const TIER_RANK: Record<"starter" | "growth" | "scale", number> = { starter: 0, growth: 1, scale: 2 };

/**
 * The live catalogue's plan for an answer, or null when it has none.
 *
 * The live rows are not keyed by the built-in ids: a super admin creates them,
 * and on 2026-11-20 they were `starter_2` / `growth_2` / `scale_2`, named
 * Starter / Growth / Scale. So, in order: the built-in id, then the plan's
 * name, then an id that starts with the tier ("starter_2"). If none of those
 * match and the grid sells exactly three plans, the answer takes the cheapest,
 * the middle or the dearest of them.
 */
export function fleetSizePlanId(fleetSize: FleetSize, catalogue: readonly SignupPlan[]): SignupPlanId | null {
  const tier = FLEET_SIZE_PLAN[fleetSize];
  const byId = catalogue.find((p) => p.id === tier);
  if (byId) return byId.id;
  const byName = catalogue.find((p) => p.name.trim().toLowerCase() === tier);
  if (byName) return byName.id;
  const byPrefix = catalogue.find((p) => p.id.startsWith(`${tier}_`));
  if (byPrefix) return byPrefix.id;
  if (catalogue.length === 3) {
    return [...catalogue].sort((a, b) => a.amountCents - b.amountCents)[TIER_RANK[tier]].id;
  }
  return null;
}

/**
 * The plan the signup should be on after this answer, or null to leave it.
 *
 * The answer only replaces a plan nobody chose: the one a "Start free trial"
 * button outside the pricing grid opens on. A plan the visitor pressed on the
 * pricing grid, or picked with "Change plan", is their decision and stays.
 *
 * Null too when the live catalogue has no plan for the answer (an admin hid
 * it): sending them to a plan the grid no longer sells would be worse than
 * leaving them where they are.
 */
export function planForFleetSize(
  fleetSize: FleetSize,
  opts: {
    currentPlanId: SignupPlanId | null;
    planChosenByVisitor: boolean;
    catalogue: readonly SignupPlan[];
  },
): SignupPlanId | null {
  if (opts.planChosenByVisitor) return null;
  const target = fleetSizePlanId(fleetSize, opts.catalogue);
  if (!target) return null;
  return target === opts.currentPlanId ? null : target;
}
