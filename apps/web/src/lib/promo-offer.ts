/**
 * A Drive247 promo / referral code's offer, as the public `promo-code-lookup`
 * function describes it. Display values only.
 */
export interface PromoOffer {
  kind: "campaign" | "referral";
  displayCode: string;
  discountText: string;
  durationText: string;
  referrerName: string | null;
  duration: "once" | "repeating" | "forever";
  durationMonths: number | null;
  discountType: "percent" | "fixed";
  discountValue: number;
  currency: string;
}

/** A plan price after the offer, in whole dollars (never below zero). */
export function discountedPrice(priceUsd: number, offer: Pick<PromoOffer, "discountType" | "discountValue">): number {
  const off = offer.discountType === "percent" ? (priceUsd * offer.discountValue) / 100 : offer.discountValue;
  return Math.max(0, Math.round((priceUsd - off) * 100) / 100);
}

/** The banner line: "Sunset Rentals invited you: 20% off for your first 3 months." */
export function offerHeadline(offer: PromoOffer): string {
  const terms = `${offer.discountText} ${offer.durationText}`;
  return offer.kind === "referral" && offer.referrerName
    ? `${offer.referrerName} invited you: ${terms}.`
    : `${offer.displayCode}: ${terms}.`;
}

/** Why a code was refused, in words — keyed by the server's `reason`. */
const PROMO_REJECTION_TEXT: Record<string, string> = {
  not_found: "We don't recognise that code.",
  expired: "That code has expired.",
  maxed_out: "That code has already been used as many times as it allows.",
  inactive: "That code is no longer active.",
  plan_not_eligible: "That code can't be used with this plan.",
  programme_disabled: "Referral codes aren't available right now.",
  owner_disabled: "That referral code isn't active right now.",
  self_referral: "You can't use your own referral code.",
  not_new_operator: "Promo codes are for new Drive247 subscriptions only.",
  already_referred: "Your account is already linked to a referral.",
  one_code_per_checkout: "Only one code can be used, and this link already has one.",
  rate_limited: "Too many tries. Please wait a few minutes and try again.",
  unavailable: "We couldn't check that code just now. Please try again.",
};

export function promoRejectionText(reason: string | null | undefined): string {
  return (reason && PROMO_REJECTION_TEXT[reason]) || "That code can't be used here.";
}
