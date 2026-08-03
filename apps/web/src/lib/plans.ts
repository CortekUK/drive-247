// Public marketing plan catalogue.
//
// This file is DISPLAY ONLY. The amount actually charged is resolved server-side
// from `planId` in supabase/functions/_shared/signup-plans.ts — the client can
// never influence the price. The two files must stay byte-identical in
// `id`/`name`/`amountCents`/`currency`/`interval`; everything else here is copy.
//
// Fleet bands are SIZING GUIDANCE, not an enforced cap: nothing in the platform
// limits vehicle counts per plan today. Copy must therefore say "sized for",
// never "limited to".
//
// `SIGNUP_PLANS` below is no longer the only source of what the page renders:
// the live catalogue is read from `public.signup_plans` at request time by
// `lib/plans-server.ts`, so a super admin can edit copy and pricing without a
// deploy. This module keeps the hardcoded three for two jobs it will always
// own:
//
//   1. **The fallback.** A DB outage, a missing env pair or a malformed row must
//      never produce an empty pricing page, and must never break `next build`.
//   2. **The type source.** `SignupPlan` and the `SignupPlanId` literal union are
//      the contract every consumer is written against; fetched rows are mapped
//      onto them, and a row whose `plan_key` is not in the union is dropped
//      rather than widening the type across the whole signup dialog.
//
// Every helper here therefore takes an optional `catalogue` argument. Omitting
// it keeps the old hardcoded behaviour, which is what makes the DB read a
// drop-in.

export type SignupPlanId = "starter" | "growth" | "scale";

export const SIGNUP_PLAN_IDS: readonly SignupPlanId[] = ["starter", "growth", "scale"] as const;

export interface SignupPlan {
  id: SignupPlanId;
  /** Display name. Also written to subscription_plans.name and Stripe metadata. */
  name: string;
  /** Whole US dollars per month — for the big number on the card. */
  priceUsd: number;
  /** The real charge, in cents. MUST match the edge-function catalogue. */
  amountCents: number;
  currency: "usd";
  interval: "month";
  /** e.g. "1–4 vehicles" (en dash, matching the existing lead-form bands). */
  fleetBand: string;
  /**
   * Hard upper bound on the fleet size this plan accepts at signup.
   *
   * Previously the bands were sizing guidance only, and the business form asked
   * for a band from a dropdown whose values (1-4 / 5-10 / 11-25 / 25+) did not
   * line up with the plan bands (1-4 / 5-15 / 16-40) — "5-10" matched no plan
   * boundary and "11-25" straddled two, so no coherent check was possible.
   * A single number per plan makes the rule checkable on both sides.
   */
  maxVehicles: number;
  /** One-line positioning sentence under the plan name. */
  tagline: string;
  /** Card bullets. Entry 0 is the fleet-scoped line and is the only one that differs. */
  bullets: readonly string[];
  /** Exactly one plan sets this true (growth). */
  highlighted: boolean;
}

export const SIGNUP_PLANS: readonly SignupPlan[] = [
  {
    id: "starter",
    name: "Starter",
    priceUsd: 99,
    amountCents: 9900,
    currency: "usd",
    interval: "month",
    fleetBand: "1–4 vehicles",
    maxVehicles: 4,
    tagline: "Get off the marketplace and take your first direct bookings.",
    bullets: [
      "Sized for fleets of 1–4 vehicles",
      "Unlimited bookings and customer records",
      "Unlimited staff logins with role-based access",
      "The full platform — nothing is held back",
    ],
    highlighted: false,
  },
  {
    id: "growth",
    name: "Growth",
    priceUsd: 199,
    amountCents: 19900,
    currency: "usd",
    interval: "month",
    fleetBand: "5–15 vehicles",
    maxVehicles: 15,
    tagline: "For operators running a real book of business every week.",
    bullets: [
      "Sized for fleets of 5–15 vehicles",
      "Unlimited bookings and customer records",
      "Unlimited staff logins with role-based access",
      "The full platform — nothing is held back",
    ],
    highlighted: true,
  },
  {
    id: "scale",
    name: "Scale",
    priceUsd: 299,
    amountCents: 29900,
    currency: "usd",
    interval: "month",
    fleetBand: "16–40 vehicles",
    maxVehicles: 40,
    tagline: "For multi-location fleets with a team behind the counter.",
    bullets: [
      "Sized for fleets of 16–40 vehicles",
      "Unlimited bookings and customer records",
      "Unlimited staff logins with role-based access",
      "The full platform — nothing is held back",
    ],
    highlighted: false,
  },
] as const;

/** True for the three ids the dialog, the edge functions and Stripe all agree on. */
export function isSignupPlanId(value: unknown): value is SignupPlanId {
  return (
    typeof value === "string" &&
    (SIGNUP_PLAN_IDS as readonly string[]).includes(value)
  );
}

/**
 * Resolve a plan by id, preferring the live catalogue and falling back to the
 * hardcoded entry.
 *
 * The fallback is not defensive padding — it is the only thing that keeps a
 * mid-signup operator moving when an admin hides their plan. `signup_plans` is
 * read with the anon key, which RLS restricts to `is_visible = true`, so a plan
 * that was hidden five minutes ago simply is not in `catalogue`. Without the
 * second lookup `getSignupPlan` would return undefined, the provider's `plan`
 * would be null, and `onboarding-dialog.tsx` (`if (!plan) return null`) would
 * render nothing at all — stranding someone whose card is already charged.
 *
 * Showing them the last known copy for their plan is safe: this catalogue is
 * display only, and `signup-payment-intent` / `signup-provision` resolve the
 * real amount from `planId` server-side.
 */
export function getSignupPlan(
  id: string,
  catalogue: readonly SignupPlan[] = SIGNUP_PLANS,
): SignupPlan | undefined {
  return catalogue.find((p) => p.id === id) ?? SIGNUP_PLANS.find((p) => p.id === id);
}

/**
 * Rendered once, under the three cards. Every line describes a capability that
 * actually ships today (see CLAUDE.md + lib/constants.ts PLATFORM_FEATURES).
 * Nothing here is plan-gated, which is exactly why it is listed once.
 */
export const PLATFORM_INCLUDED: readonly string[] = [
  "Branded booking website on your own domain",
  "Full fleet management, availability and blackout controls",
  "Online bookings and payments via Stripe",
  "Deposits and pre-authorisations",
  "Customer verification and document checks",
  "E-signed rental agreements",
  "Automated invoicing and reminders",
  "Real-time customer chat",
  "Reports and P&L dashboard",
  "Weekend and holiday dynamic pricing",
  "Lockbox self-service key handover",
  "Bonzah insurance integration",
] as const;

/** Footnote under the grid. Every claim here must remain true. */
export const PRICING_FOOTNOTE =
  "Prices in USD, billed monthly. Manage your subscription any time from your portal.";

/**
 * The price a customer reads on the card, derived from `amountCents` — the one
 * number the server also charges. `priceUsd` stays in the contract because B2's
 * dialog header and B3's order summary read it, but nothing renders it directly:
 * deriving here means the money is written down exactly once, and a typo in
 * `priceUsd` can never quote a customer a figure Stripe will not honour.
 */
export function formatPlanPriceUsd(plan: SignupPlan): string {
  const dollars = plan.amountCents / 100;
  // Whole-dollar plans render as "$99", not "$99.00" — the card's big number.
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * The top of a fleet band ("5–15 vehicles" -> 15), or null when the string
 * carries no number at all (a band like "Any size" is copy, not a bound, and is
 * not something to complain about).
 */
function fleetBandTop(fleetBand: string): number | null {
  const numbers = fleetBand.match(/\d+/g);
  return numbers?.length ? Number(numbers[numbers.length - 1]) : null;
}

/**
 * Shout about a catalogue that contradicts itself, instead of rendering it.
 *
 * This began as a development-only block over the hardcoded three, on the
 * reasoning that a typo could only ever arrive through a commit. That reasoning
 * no longer holds: the live catalogue is edited in the admin app and lands in
 * production without a build, so the same three mistakes can now be made by
 * someone who will never see a dev console. Rows fetched from `signup_plans`
 * are therefore checked in every environment — the hardcoded pass stays
 * dev-only, because for that one a deploy is the only way in.
 *
 * Deliberately non-fatal. Each of these makes a card *wrong*, not unrenderable,
 * and blanking the highest-intent section of the marketing site over a bad
 * `sort_order` would be a far worse outcome than a slightly odd-looking grid.
 * Rows that genuinely cannot be rendered (unknown id, non-numeric price) are
 * dropped earlier, in `plans-server.ts`.
 */
export function reportPlanCatalogueProblems(
  plans: readonly SignupPlan[],
  source: string,
): void {
  for (const plan of plans) {
    // The catalogue carries the same amount twice (once in cents for Stripe,
    // once in dollars for the type contract) and nothing at build time would
    // catch them drifting apart, so we shout rather than ship a card that
    // advertises a price the subscription does not charge.
    if (plan.priceUsd * 100 !== plan.amountCents) {
      console.error(
        `[plans] (${source}) Plan "${plan.id}" is inconsistent: priceUsd=${plan.priceUsd} ` +
          `implies ${plan.priceUsd * 100} cents but amountCents=${plan.amountCents}. ` +
          `amountCents is authoritative and must also match ` +
          `supabase/functions/_shared/signup-plans.ts.`
      );
    }
    // The band is what the operator reads on the card; `maxVehicles` is what the
    // business step enforces after their card is charged. A band promising 15
    // against a cap of 10 sells someone a plan that then refuses their fleet.
    const bandTop = fleetBandTop(plan.fleetBand);
    if (bandTop !== null && plan.maxVehicles < bandTop) {
      console.error(
        `[plans] (${source}) Plan "${plan.id}" advertises "${plan.fleetBand}" but ` +
          `maxVehicles=${plan.maxVehicles}. The signup form would reject a fleet ` +
          `size the card promised to cover.`
      );
    }
  }

  const highlighted = plans.filter((p) => p.highlighted).length;
  if (highlighted !== 1) {
    console.error(
      `[plans] (${source}) Exactly one plan must set \`highlighted: true\` — the ` +
        `pricing grid elevates a single recommended tier, but ${highlighted} are marked.`
    );
  }
}

if (process.env.NODE_ENV !== "production") {
  reportPlanCatalogueProblems(SIGNUP_PLANS, "hardcoded");
}

/**
 * The smallest plan that can carry `count` vehicles, or null when the fleet is
 * bigger than anything self-serve covers (those operators need a call).
 *
 * `catalogue` must be the SAME list the card quoted from. An admin who raises
 * Scale's cap changes the answer to "which plan do you need instead?", and
 * answering it from the hardcoded copy would send an operator to a strategy
 * call for a fleet the live Scale plan now accepts.
 */
export function smallestPlanFor(
  count: number,
  catalogue: readonly SignupPlan[] = SIGNUP_PLANS,
): SignupPlan | null {
  // Not assumed to arrive sorted: `sort_order` is display order, and an admin is
  // free to make it disagree with price.
  return (
    [...catalogue]
      .sort((a, b) => a.maxVehicles - b.maxVehicles)
      .find((p) => count <= p.maxVehicles) ?? null
  );
}

/** The largest fleet the hardcoded catalogue accepts. */
export const MAX_SELF_SERVE_VEHICLES = Math.max(
  ...SIGNUP_PLANS.map((p) => p.maxVehicles),
);

/** The largest fleet any self-serve plan in `catalogue` accepts. */
export function maxSelfServeVehicles(
  catalogue: readonly SignupPlan[] = SIGNUP_PLANS,
): number {
  // `catalogue` is never empty in practice — every path falls back to
  // SIGNUP_PLANS — but `Math.max()` of nothing is -Infinity, which would tell
  // every operator their fleet is too big for the platform.
  return catalogue.length
    ? Math.max(...catalogue.map((p) => p.maxVehicles))
    : MAX_SELF_SERVE_VEHICLES;
}
