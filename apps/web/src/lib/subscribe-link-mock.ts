/**
 * DEVELOPMENT-ONLY canned answers for the pay-by-link pages
 * (`/subscribe/[token]` and `/subscribe/[token]/done`).
 *
 * Any token starting with `mock-` is answered here instead of by the
 * `subscription-link(-v2)` edge functions, so every screen of the link flow can
 * be opened, reviewed and recorded on localhost with no backend, no Stripe
 * Checkout and no link row. Asked for by the boss (2026-11-12): mock every UI
 * state so the whole flow can be walked and filmed.
 *
 * `IS_MOCK_ENABLED` folds to `false` in every build (`NODE_ENV` is inlined), so
 * production never reads a canned answer — a `mock-` token there goes to the
 * real server like any other token and comes back `invalid`.
 *
 * Nothing here can start a payment: the page swaps its POST to Stripe for a
 * plain GET to its own `/done` page when the token is a mock.
 */

const IS_MOCK_ENABLED = process.env.NODE_ENV === "development";

export function isMockLinkToken(token: string | undefined | null): boolean {
  return IS_MOCK_ENABLED && typeof token === "string" && token.startsWith("mock-");
}

/** Every link state the page renders, by mock token. Listed for the dev index. */
export const MOCK_LINK_TOKENS = [
  "mock-active",
  "mock-trial",
  "mock-charge-today",
  "mock-promo",
  "mock-referral",
  "mock-promo-error",
  "mock-cancelled",
  "mock-declined",
  "mock-error",
  "mock-invoice",
  "mock-used",
  "mock-expired",
  "mock-rate-limited",
  "mock-suspended",
  "mock-out-of-date",
  "mock-invalid",
] as const;

/** Done-page outcomes, by mock token: `/subscribe/<token>/done?session_id=mock`. */
export const MOCK_DONE_TOKENS = ["mock-active", "mock-declined", "mock-invalid"] as const;

interface MockPromo {
  kind: "campaign" | "referral";
  displayCode: string;
  discountText: string;
  durationText: string;
  referrerName: string | null;
  preApplied: boolean;
  discountedAmount: number;
  duration: "once" | "repeating" | "forever";
  durationMonths: number | null;
}

export interface MockLinkAnswer {
  info: {
    state: string;
    companyName?: string;
    planName?: string;
    amount?: number;
    currency?: string;
    interval?: string;
    trialDays?: number;
    chargeToday?: boolean;
    expiresAt?: string;
    portalUrl?: string;
    linkMode?: string;
    declined?: boolean;
    error?: string;
    promo?: MockPromo | null;
    promoError?: string | null;
  };
  /** Forces the "No charge was made" return banner (Stripe's cancel URL). */
  cancelled?: boolean;
  /** Forces the code the visitor "typed", so a rejection message has a code to belong to. */
  typedCode?: string;
}

const BASE = {
  state: "ready",
  companyName: "Northwind Car Rentals",
  planName: "The Lot · Growth",
  amount: 22900,
  currency: "usd",
  interval: "month",
  trialDays: 0,
  chargeToday: true,
  linkMode: "subscription",
} as const;

const CAMPAIGN: MockPromo = {
  kind: "campaign",
  displayCode: "SPRING20",
  discountText: "20% off",
  durationText: "for your first 3 months",
  referrerName: null,
  preApplied: true,
  discountedAmount: 18320,
  duration: "repeating",
  durationMonths: 3,
};

/**
 * The canned answer for a mock token, or null when the token is not a mock.
 * `promoParam` is the upper-cased `?promo=` value — on a mock link, SAVE20 applies and any
 * other code is refused as "not found", so the promo field can be demoed live.
 */
export function mockLinkAnswer(token: string, promoParam: string): MockLinkAnswer | null {
  if (!isMockLinkToken(token)) return null;
  // "?promo=none" is the visitor pressing Remove on a code they carried in.
  const removed = promoParam === "NONE";
  const typed = removed ? "" : promoParam;
  // Expiry is always ~23h out so the footer reads like a fresh link.
  const expiresAt = new Date(Date.now() + 23 * 3_600_000 + 12 * 60_000).toISOString();
  const ready = { ...BASE, expiresAt };

  // A code typed into the field on any ready mock link.
  const typedPromo = (): MockLinkAnswer["info"] =>
    typed === "SAVE20"
      ? { ...ready, promo: { ...CAMPAIGN, displayCode: "SAVE20", preApplied: false } }
      : { ...ready, promoError: "not_found" };

  switch (token) {
    case "mock-active":
    case "mock-charge-today":
      return { info: typed ? typedPromo() : ready };
    case "mock-trial":
      return { info: { ...(typed ? typedPromo() : ready), trialDays: 14, chargeToday: false } };
    case "mock-promo":
      return { info: { ...ready, promo: CAMPAIGN } };
    case "mock-referral":
      if (removed) return { info: ready };
      return {
        info: {
          ...ready,
          promo: {
            ...CAMPAIGN,
            kind: "referral",
            displayCode: "SUNSET-4821",
            referrerName: "Sunset Rentals",
            preApplied: false,
            discountText: "$50 off",
            durationText: "on your first bill",
            discountedAmount: 17900,
            duration: "once",
            durationMonths: null,
          },
        },
      };
    case "mock-promo-error":
      return { info: { ...ready, promoError: "expired" }, typedCode: typed || "WINTER10" };
    case "mock-cancelled":
      return { info: ready, cancelled: true };
    case "mock-declined":
      return { info: { ...ready, declined: true } };
    case "mock-error":
      return { info: { ...ready, error: "We couldn't reach the payment provider just now. Please try again in a minute." } };
    case "mock-invoice":
      return { info: { ...ready, linkMode: "invoice" } };
    case "mock-used":
      return { info: { state: "paid", companyName: BASE.companyName, portalUrl: "#" } };
    case "mock-expired":
      return { info: { state: "expired" } };
    case "mock-rate-limited":
      return { info: { state: "rate_limited" } };
    case "mock-suspended":
      return { info: { state: "tenant_suspended" } };
    case "mock-out-of-date":
      return { info: { state: "price_changed" } };
    default:
      return { info: { state: "invalid" } };
  }
}

/** The done page's state for a mock token (Stripe's return leg, faked). */
export function mockDoneAnswer(token: string): { state: string; companyName?: string; portalUrl?: string } | null {
  if (!isMockLinkToken(token)) return null;
  if (token === "mock-declined") return { state: "ready" };
  if (token === "mock-invalid") return { state: "invalid" };
  return { state: "paid", companyName: BASE.companyName, portalUrl: "#" };
}
