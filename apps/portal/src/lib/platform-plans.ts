/**
 * Drive247's own subscription plans, as the marketing site sells them
 * (apps/web/src/lib/plans.ts — SIGNUP_PLANS). Used by v2 Billing's plan picker
 * when a tenant has no per-tenant plans set up, so the operator sees the same
 * three plans, prices and words as drive-247.com.
 *
 * Display only: the server resolves every real charge from the plan itself.
 * Keep in step with apps/web/src/lib/plans.ts.
 */

export interface PlatformPlan {
  id: string;
  name: string;
  /** The monthly charge, in cents. */
  amountCents: number;
  currency: string;
  interval: "month" | "year";
  /** e.g. "5–15 vehicles". Empty for a custom plan. */
  fleetBand: string;
  tagline: string;
  bullets: string[];
  /** The landing page's "Most popular". */
  highlighted: boolean;
}

export const PLATFORM_PLANS: PlatformPlan[] = [
  {
    id: "starter",
    name: "Starter",
    amountCents: 9900,
    currency: "usd",
    interval: "month",
    fleetBand: "1–4 vehicles",
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
    amountCents: 19900,
    currency: "usd",
    interval: "month",
    fleetBand: "5–15 vehicles",
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
    amountCents: 29900,
    currency: "usd",
    interval: "month",
    fleetBand: "16–40 vehicles",
    tagline: "For multi-location fleets with a team behind the counter.",
    bullets: [
      "Sized for fleets of 16–40 vehicles",
      "Unlimited bookings and customer records",
      "Unlimited staff logins with role-based access",
      "The full platform — nothing is held back",
    ],
    highlighted: false,
  },
];

/** On every plan (the site's PLATFORM_INCLUDED). Shown once, under the plans. */
export const PLATFORM_INCLUDED: string[] = [
  "Unlimited bookings and customer records",
  "Unlimited staff logins with role-based access",
  "Branded booking website on your own domain",
  "Online bookings and payments via Stripe",
  "Deposits and pre-authorisations",
  "Customer verification and document checks",
  "E-signed rental agreements",
  "Automated invoicing and reminders",
  "Real-time customer chat",
  "Reports and P&L dashboard",
  "Weekend and holiday dynamic pricing",
  "Lockbox self-service key handover",
];

export interface Proration {
  /** Days left in the current billing period, and the period's length. */
  daysLeft: number;
  periodDays: number;
  /** What the unused part of the current plan is worth (a credit). */
  creditCents: number;
  /** The new plan for the rest of the period. */
  chargeCents: number;
  /** charge − credit, never below zero. */
  dueNowCents: number;
  /** Moving to a cheaper plan: it starts at the next bill, nothing today. */
  downgrade: boolean;
}

const DAY = 86_400_000;

/**
 * Day-based proration, the way Stripe does it for a mid-period plan change:
 * credit the unused days of the old plan, charge the same days of the new
 * one, and bill the difference now. A move DOWN takes effect at the next bill
 * instead, so nothing is charged or credited today.
 */
export function prorate(
  oldCents: number,
  newCents: number,
  periodStart: string | null,
  periodEnd: string | null,
  now: number = Date.now(),
): Proration {
  const start = periodStart ? new Date(periodStart).getTime() : NaN;
  const end = periodEnd ? new Date(periodEnd).getTime() : NaN;
  const periodDays = Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / DAY) : 30;
  const daysLeft = Number.isFinite(end) ? Math.min(periodDays, Math.max(0, Math.ceil((end - now) / DAY))) : periodDays;
  const downgrade = newCents < oldCents;
  if (downgrade) return { daysLeft, periodDays, creditCents: 0, chargeCents: 0, dueNowCents: 0, downgrade };
  const creditCents = Math.round((oldCents * daysLeft) / periodDays);
  const chargeCents = Math.round((newCents * daysLeft) / periodDays);
  return { daysLeft, periodDays, creditCents, chargeCents, dueNowCents: Math.max(0, chargeCents - creditCents), downgrade };
}
