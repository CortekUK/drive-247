import type { StripePaymentElementOptions } from "@stripe/stripe-js";

import type { SignupPlan } from "@/lib/plans";
import type { PromoOffer } from "@/lib/promo-offer";

/**
 * What the Apple Pay sheet says at the signup payment step.
 *
 * Saving a card for a free trial has no amount to show, so without this the
 * sheet reads "Amount Pending", which sounds like an unknown charge. Describing
 * the subscription makes it show the free period and the monthly price, and
 * asks Apple for a merchant token, so renewals survive a change of iPhone.
 */
export type ApplePayTerms = NonNullable<StripePaymentElementOptions["applePay"]>;

const DAY_MS = 86_400_000;
/** Room for the form to sit open before the customer taps Apple Pay. */
const MIN_FUTURE_MS = 3_600_000;

/** Stripe's own trial end when we have it, else today plus the trial length. */
export function resolveTrialEnd(
  trialEndsAt: string | null,
  trialDays: number,
  now: Date = new Date(),
): Date | null {
  const stated = trialEndsAt ? new Date(trialEndsAt) : null;
  if (stated && !Number.isNaN(stated.getTime())) return stated;
  return trialDays > 0 ? new Date(now.getTime() + trialDays * DAY_MS) : null;
}

/** The day the card is first charged, as "1 December". */
export function formatFirstPayment(when: Date, now: Date = new Date()): string {
  return when.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function discountedCents(amountCents: number, promo: PromoOffer): number {
  const off =
    promo.discountType === "percent"
      ? (amountCents * promo.discountValue) / 100
      : promo.discountValue * 100;
  return Math.max(0, Math.round(amountCents - off));
}

/** The page in the customer's portal where the subscription is managed. */
function managementUrl(slug: string): string {
  return /^[a-z0-9-]+$/.test(slug)
    ? `https://${slug}.portal.drive-247.com/subscription`
    : "https://www.drive-247.com";
}

/**
 * Returns undefined when there is no honest recurring price to show. The sheet
 * then falls back to Stripe's default instead of risking a refused request.
 */
export function buildApplePayTerms({
  plan,
  promo,
  isTrial,
  trialDays,
  trialEndsAt,
  slug,
  now = new Date(),
}: {
  plan: Pick<SignupPlan, "name" | "amountCents">;
  promo: PromoOffer | null;
  isTrial: boolean;
  trialDays: number;
  trialEndsAt: string | null;
  slug: string;
  now?: Date;
}): ApplePayTerms | undefined {
  // Apple has one regular price, so a code that runs out shows the price the
  // customer settles on and names the discount in the agreement line. Showing
  // the discounted figure there would understate what they go on to pay.
  const monthlyCents =
    promo?.duration === "forever" ? discountedCents(plan.amountCents, promo) : plan.amountCents;
  if (!Number.isInteger(monthlyCents) || monthlyCents <= 0) return undefined;

  // Stripe.js throws on any billing date that is not in the future, and that
  // throw takes the whole card form down. So a trial that has already ended is
  // not described at all, and "starts today" is left unsaid below.
  const trialEnd = isTrial ? resolveTrialEnd(trialEndsAt, trialDays, now) : null;
  if (isTrial && (!trialEnd || trialDays <= 0)) return undefined;
  if (trialEnd && trialEnd.getTime() - now.getTime() < MIN_FUTURE_MS) return undefined;

  const price = `${money(monthlyCents)}/month`;
  const codeNote =
    promo && promo.duration !== "forever"
      ? ` ${promo.displayCode}: ${promo.discountText} ${promo.durationText}.`
      : "";
  const billingAgreement = trialEnd
    ? `Free for ${trialDays} days, then ${price}.${codeNote} Cancel before ${formatFirstPayment(trialEnd, now)} and you won't be charged.`
    : `${price} until you cancel.${codeNote}`;

  return {
    recurringPaymentRequest: {
      paymentDescription: `Drive247 ${plan.name} subscription`,
      managementURL: managementUrl(slug),
      billingAgreement,
      ...(trialEnd
        ? {
            trialBilling: {
              amount: 0,
              label: `${trialDays}-day free trial`,
              recurringPaymentEndDate: trialEnd,
              recurringPaymentIntervalUnit: "day" as const,
              recurringPaymentIntervalCount: trialDays,
            },
          }
        : {}),
      regularBilling: {
        amount: monthlyCents,
        label: `${plan.name} plan`,
        ...(trialEnd ? { recurringPaymentStartDate: trialEnd } : {}),
        recurringPaymentIntervalUnit: "month",
        recurringPaymentIntervalCount: 1,
      },
    },
  };
}
