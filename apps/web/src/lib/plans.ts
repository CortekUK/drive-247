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

export function getSignupPlan(id: string): SignupPlan | undefined {
  return SIGNUP_PLANS.find((p) => p.id === id);
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

// Development-only invariant. The catalogue carries the same amount twice (once
// in cents for Stripe, once in dollars for the type contract) and there is no
// build step that would catch them drifting apart, so we shout during dev rather
// than ship a card that advertises a price the subscription does not charge.
if (process.env.NODE_ENV !== "production") {
  for (const plan of SIGNUP_PLANS) {
    if (plan.priceUsd * 100 !== plan.amountCents) {
      console.error(
        `[plans] Plan "${plan.id}" is inconsistent: priceUsd=${plan.priceUsd} ` +
          `implies ${plan.priceUsd * 100} cents but amountCents=${plan.amountCents}. ` +
          `amountCents is authoritative and must also match ` +
          `supabase/functions/_shared/signup-plans.ts.`
      );
    }
  }
  if (SIGNUP_PLANS.filter((p) => p.highlighted).length !== 1) {
    console.error(
      "[plans] Exactly one plan must set `highlighted: true` — the pricing grid " +
        "elevates a single recommended tier."
    );
  }
}

/**
 * The smallest plan that can carry `count` vehicles, or null when the fleet is
 * bigger than anything self-serve covers (those operators need a call).
 */
export function smallestPlanFor(count: number): SignupPlan | null {
  return SIGNUP_PLANS.find((p) => count <= p.maxVehicles) ?? null;
}

/** The largest fleet any self-serve plan accepts. */
export const MAX_SELF_SERVE_VEHICLES = Math.max(
  ...SIGNUP_PLANS.map((p) => p.maxVehicles),
);
