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
  /**
   * Hard upper bound on fleet size at signup. MUST match `maxVehicles` in
   * apps/web/src/lib/plans.ts — the client checks it for a good error message,
   * this side is what actually enforces it.
   */
  maxVehicles: number;
  /**
   * The exact Stripe Price to bill, when a super admin has set one via the
   * admin Signup Plans page. Absent on the hardcoded entries, which still
   * resolve by `lookupKey`.
   */
  stripePriceId?: string | null;
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
    maxVehicles: 4,
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
    maxVehicles: 15,
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
    maxVehicles: 40,
  },
};

/** Null (never a throw, never a default) for anything that is not a known plan id. */
export function getSignupPlan(id: unknown): SignupPlanServer | null {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(SIGNUP_PLANS, id)
    ? SIGNUP_PLANS[id as SignupPlanId]
    : null;
}

/**
 * The plan AS THE SUPER ADMIN CURRENTLY HAS IT — the only version that may be
 * used to charge, to cap a fleet, or to word an error.
 *
 * WHY THIS EXISTS. `public.signup_plans` became the source of truth the moment
 * the admin Signup Plans page shipped, but this module stayed hardcoded, so the
 * two silently diverged:
 *
 *   - the marketing card advertised the DB price while `signup-payment-intent`
 *     resolved the Stripe Price from the HARDCODED `lookupKey` — i.e. an admin
 *     could raise the price and customers would keep being charged the old one;
 *   - `signup-provision` capped fleet size against the hardcoded `maxVehicles`,
 *     so raising Starter to 10 let the browser accept 8 vehicles and then had
 *     the server reject it AFTER the card was charged;
 *   - a renamed plan produced error copy naming a plan the customer never saw.
 *
 * FALLBACK IS DELIBERATE AND MUST STAY. A signup is worth more than a stale
 * price: if the table is unreachable, missing a row, or returns something
 * unusable, we serve the hardcoded entry rather than fail. The customer is then
 * charged exactly what the code has always charged, which is wrong-but-safe,
 * versus a dead signup, which is only wrong.
 *
 * NOT filtered by `is_visible`. Hiding a plan is a marketing decision; someone
 * who is mid-signup — or resuming after paying — must still resolve it, or they
 * are stranded on a plan they already own.
 */
export async function fetchSignupPlan(
  supabase: any,
  id: unknown,
): Promise<SignupPlanServer | null> {
  const base = getSignupPlan(id);
  if (!base) return null;

  try {
    const { data, error } = await supabase
      .from("signup_plans")
      .select(
        'plan_key, name, amount_cents, currency, "interval", max_vehicles, tagline, bullets, stripe_price_id, stripe_lookup_key',
      )
      .eq("plan_key", base.id)
      .maybeSingle();

    if (error) {
      console.warn(`[signup-plans] DB read failed for "${base.id}" — using hardcoded:`, error.message);
      return base;
    }
    if (!data) {
      console.warn(`[signup-plans] no signup_plans row for "${base.id}" — using hardcoded.`);
      return base;
    }

    // Field-by-field, so one unusable column cannot discard the whole row. An
    // amount outside Stripe's range is treated as absent rather than passed on
    // to `subscriptions.create`, which would 400 the entire signup.
    const amount = Number(data.amount_cents);
    const maxVehicles = Number(data.max_vehicles);
    const bullets = Array.isArray(data.bullets)
      ? data.bullets.filter((b: unknown) => typeof b === "string" && b.trim())
      : null;

    return {
      ...base,
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : base.name,
      amountCents:
        Number.isInteger(amount) && amount >= 50 && amount <= 99_999_999 ? amount : base.amountCents,
      currency: (typeof data.currency === "string" ? data.currency : base.currency) as "usd",
      interval: (typeof data.interval === "string" ? data.interval : base.interval) as "month",
      maxVehicles:
        Number.isInteger(maxVehicles) && maxVehicles > 0 ? maxVehicles : base.maxVehicles,
      tagline:
        typeof data.tagline === "string" && data.tagline.trim() ? data.tagline.trim() : base.tagline,
      features: bullets && bullets.length ? bullets : base.features,
      // The admin page rotates the lookup key on every price change (Stripe
      // Prices are immutable). Carrying the DB's key is what makes the NEW price
      // resolvable at all — the hardcoded one points at the superseded Price.
      lookupKey:
        typeof data.stripe_lookup_key === "string" && data.stripe_lookup_key.trim()
          ? data.stripe_lookup_key.trim()
          : base.lookupKey,
      // Set once a super admin has changed the price. When present it is used
      // DIRECTLY, skipping lookup-key resolution entirely — one fewer Stripe
      // round trip and no chance of resolving a stale key.
      stripePriceId:
        typeof data.stripe_price_id === "string" && data.stripe_price_id.trim()
          ? data.stripe_price_id.trim()
          : null,
    };
  } catch (e) {
    console.warn(`[signup-plans] DB read threw for "${base.id}" — using hardcoded:`, e);
    return base;
  }
}
