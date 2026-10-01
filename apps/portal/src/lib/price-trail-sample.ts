import type { ReferralsData } from "@/hooks/use-referrals";
import type { PremiumIntegration, RetentionOffer } from "@/lib/price-trail";

/**
 * Sample sources for the canary's SAMPLE account (billing preview) only, so
 * the "Price breakdown" can be reviewed with every kind of step on it: a promo
 * code joined with (now ended), two premium integrations, and the loyalty
 * discount. Each is used only where the account has no real one of its own,
 * and never on a real account — the real referral data is kept as it is.
 */

export const SAMPLE_JOINED: NonNullable<ReferralsData["joinedWith"]> = {
  code: "LAUNCH20",
  referrerName: null,
  discountText: "20% off",
  durationText: "for your first 3 months",
  endsAt: "2026-08-19T00:00:00.000Z",
  active: false,
  billsLeft: null,
};

export const SAMPLE_INTEGRATIONS: PremiumIntegration[] = [
  { key: "inshur", monthlyCents: 2900, since: "2026-07-24T10:00:00.000Z" },
  { key: "turo_sync", monthlyCents: 1900, since: "2026-09-04T10:00:00.000Z" },
];

export const SAMPLE_RETENTION: RetentionOffer = {
  percent: 10,
  bills: 3,
  acceptedAt: "2026-09-28T10:00:00.000Z",
};
