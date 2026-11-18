import { describe, expect, it } from "vitest";

import type { PromoOffer } from "@/lib/promo-offer";

import { buildApplePayTerms } from "./apple-pay-terms";

const now = new Date("2026-11-19T12:00:00Z");
const trialEndsAt = "2026-12-03T12:00:00Z";
const plan = { name: "Starter", amountCents: 12900 };

const promo = (over: Partial<PromoOffer>): PromoOffer => ({
  kind: "campaign",
  displayCode: "SAVE20",
  discountText: "20% off",
  durationText: "for your first 3 months",
  referrerName: null,
  duration: "repeating",
  durationMonths: 3,
  discountType: "percent",
  discountValue: 20,
  currency: "usd",
  ...over,
});

const trial = { plan, promo: null, isTrial: true, trialDays: 14, trialEndsAt, slug: "acme", now };

describe("buildApplePayTerms", () => {
  it("shows the free trial, then the monthly price from the day the trial ends", () => {
    const request = buildApplePayTerms(trial)?.recurringPaymentRequest;

    expect(request?.billingAgreement).toBe(
      "Free for 14 days, then $129.00/month. Cancel before 3 December and you won't be charged.",
    );
    expect(request?.trialBilling).toMatchObject({
      amount: 0,
      recurringPaymentEndDate: new Date(trialEndsAt),
    });
    expect(request?.regularBilling).toMatchObject({
      amount: 12900,
      recurringPaymentStartDate: new Date(trialEndsAt),
      recurringPaymentIntervalUnit: "month",
      recurringPaymentIntervalCount: 1,
    });
    expect(request?.managementURL).toBe("https://acme.portal.drive-247.com/subscription");
  });

  it("keeps the full price for a code that runs out, and names the discount", () => {
    const request = buildApplePayTerms({ ...trial, promo: promo({}) })?.recurringPaymentRequest;

    expect(request?.regularBilling.amount).toBe(12900);
    expect(request?.billingAgreement).toContain("SAVE20: 20% off for your first 3 months.");
  });

  it("uses the discounted price for a code that never ends", () => {
    const forever = promo({ duration: "forever", durationMonths: null });
    const request = buildApplePayTerms({ ...trial, promo: forever })?.recurringPaymentRequest;

    expect(request?.regularBilling.amount).toBe(10320);
    expect(request?.billingAgreement).toContain("then $103.20/month.");
  });

  it("treats a fixed discount as dollars", () => {
    const fixed = promo({ duration: "forever", discountType: "fixed", discountValue: 29 });

    expect(
      buildApplePayTerms({ ...trial, promo: fixed })?.recurringPaymentRequest?.regularBilling.amount,
    ).toBe(10000);
  });

  it("has no trial line when the plan is paid from today", () => {
    const request = buildApplePayTerms({
      ...trial,
      isTrial: false,
      trialDays: 0,
      trialEndsAt: null,
    })?.recurringPaymentRequest;

    expect(request?.trialBilling).toBeUndefined();
    expect(request?.billingAgreement).toBe("$129.00/month until you cancel.");
    expect(request?.regularBilling.recurringPaymentStartDate).toBeUndefined();
  });

  it("never sends a billing date Stripe would refuse for not being in the future", () => {
    const request = buildApplePayTerms(trial)?.recurringPaymentRequest;

    expect(request?.trialBilling?.recurringPaymentStartDate).toBeUndefined();
    expect(buildApplePayTerms({ ...trial, trialEndsAt: "2026-11-19T11:00:00Z" })).toBeUndefined();
    expect(buildApplePayTerms({ ...trial, trialEndsAt: "2026-11-19T12:30:00Z" })).toBeUndefined();
  });

  it("falls back to the main site before a portal address is chosen", () => {
    expect(
      buildApplePayTerms({ ...trial, slug: "" })?.recurringPaymentRequest?.managementURL,
    ).toBe("https://www.drive-247.com");
  });

  it("sends nothing when there is no price or trial length to describe", () => {
    const free = promo({ duration: "forever", discountValue: 100 });

    expect(buildApplePayTerms({ ...trial, promo: free })).toBeUndefined();
    expect(buildApplePayTerms({ ...trial, trialDays: 0 })).toBeUndefined();
  });
});
