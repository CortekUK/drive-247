// Server-side plan catalogue — the ONLY source of the amount actually charged.
// The client sends a `planId` and nothing else; price never crosses the wire
// inbound. Mirrors apps/web/src/lib/plans.ts (id/name/amountCents/currency/interval).
//
// If you change an amount here you MUST also change apps/web/src/lib/plans.ts,
// and you MUST bump the `lookupKey` suffix — Stripe Prices are immutable, so a
// stale lookup_key would keep resolving the OLD price and quietly bill the old
// amount forever.
export type SignupPlanId = "starter" | "growth" | "scale";

export const SIGNUP_PLAN_IDS: SignupPlanId[] = ["starter", "growth", "scale"];

export interface SignupPlanServer {
  id: SignupPlanId;
  name: string;
  amountCents: number;
  currency: "usd";
  interval: "month";
  /** Written to subscription_plans.description. */
  tagline: string;
  /** Written to subscription_plans.features (jsonb array). */
  features: string[];
  /** Stable Stripe Price lookup_key. Bump the suffix if a price ever changes. */
  lookupKey: string;
}

export const SIGNUP_PLANS: Record<SignupPlanId, SignupPlanServer> = {
  starter: {
    id: "starter",
    name: "Starter",
    amountCents: 9900,
    currency: "usd",
    interval: "month",
    tagline: "Get off the marketplace and take your first direct bookings.",
    features: [
      "Sized for fleets of 1–4 vehicles",
      "Unlimited bookings and customer records",
      "Unlimited staff logins with role-based access",
      "The full platform — nothing is held back",
    ],
    lookupKey: "d247_signup_starter_usd_9900_v1",
  },
  growth: {
    id: "growth",
    name: "Growth",
    amountCents: 19900,
    currency: "usd",
    interval: "month",
    tagline: "For operators running a real book of business every week.",
    features: [
      "Sized for fleets of 5–15 vehicles",
      "Unlimited bookings and customer records",
      "Unlimited staff logins with role-based access",
      "The full platform — nothing is held back",
    ],
    lookupKey: "d247_signup_growth_usd_19900_v1",
  },
  scale: {
    id: "scale",
    name: "Scale",
    amountCents: 29900,
    currency: "usd",
    interval: "month",
    tagline: "For multi-location fleets with a team behind the counter.",
    features: [
      "Sized for fleets of 16–40 vehicles",
      "Unlimited bookings and customer records",
      "Unlimited staff logins with role-based access",
      "The full platform — nothing is held back",
    ],
    lookupKey: "d247_signup_scale_usd_29900_v1",
  },
};

/** Null (never a throw, never a default) for anything that is not a known plan id. */
export function getSignupPlan(id: unknown): SignupPlanServer | null {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(SIGNUP_PLANS, id)
    ? SIGNUP_PLANS[id as SignupPlanId]
    : null;
}
