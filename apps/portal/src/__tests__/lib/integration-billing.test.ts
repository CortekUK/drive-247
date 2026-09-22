/**
 * Integration billing — the portal's pure pieces (docs/integration-billing).
 *
 * Every expected string and amount below is written by hand from the
 * transcript's own example ($200 software, $20 Inshur), never produced by the
 * code under test.
 */
import { describe, expect, it } from "vitest";
import {
  INTEGRATION_KEYS,
  catalogFromRows,
  confirmSentence,
  formatMoney,
  formatSignedMoney,
  isPreviewOnly,
  keyForBoardName,
  onYourBillSentence,
  premiumPitch,
  subscribedSentence,
} from "@/lib/integration-billing/catalog";
import { creditsRetiredForSend, isIntegrationBillingTenant } from "@/lib/integration-billing/gate";
import { PLAN_STATE_COPY, nextBillAt, planStateOf } from "@/lib/integration-billing/plan";
import { wasOnABill } from "@/lib/integration-billing/hooks";

describe("who has integration billing", () => {
  it("is northwind, and nobody else — not even another v2 tenant", () => {
    expect(isIntegrationBillingTenant("northwind")).toBe(true);
    expect(isIntegrationBillingTenant("goniko")).toBe(false);
    expect(isIntegrationBillingTenant("")).toBe(false);
    expect(isIntegrationBillingTenant(null)).toBe(false);
    expect(isIntegrationBillingTenant(undefined)).toBe(false);
  });

  it("skips credits on a send only for the tenant that owns the rental", () => {
    expect(creditsRetiredForSend({ requestTenantId: "nw", rentalTenantId: "nw", tenantSlug: "northwind" })).toBe(true);
    expect(creditsRetiredForSend({ requestTenantId: "nw", rentalTenantId: "x", tenantSlug: "northwind" })).toBe(false);
    expect(creditsRetiredForSend({ requestTenantId: null, rentalTenantId: "nw", tenantSlug: "northwind" })).toBe(false);
    expect(creditsRetiredForSend({ requestTenantId: "g", rentalTenantId: "g", tenantSlug: "goniko" })).toBe(false);
  });
});

describe("the catalog", () => {
  it("with no rows: Inshur, Turo Sync and CheckMyDriver wear the crown, unpriced; the rest are free and visible", () => {
    const catalog = catalogFromRows(null);
    expect(Object.keys(catalog)).toEqual(INTEGRATION_KEYS.map((i) => i.key));
    const premium = Object.values(catalog).filter((e) => e.isPremium).map((e) => e.key);
    expect(premium).toEqual(["turo_sync", "inshur", "checkmydriver"]);
    for (const entry of Object.values(catalog)) {
      expect(entry).toMatchObject({ monthlyPriceCents: null, isHidden: false, isBeta: false, isUnavailable: false });
    }
  });

  it("a saved row wins over the default, either way", () => {
    const catalog = catalogFromRows([
      { integration_key: "inshur", is_premium: false },
      { integration_key: "square", is_premium: true, monthly_price_cents: 2000 },
    ]);
    expect(catalog.inshur.isPremium).toBe(false);
    expect(catalog.square).toMatchObject({ isPremium: true, monthlyPriceCents: 2000 });
  });

  it("reads a premium row, and every flag", () => {
    const catalog = catalogFromRows([
      { integration_key: "inshur", is_premium: true, monthly_price_cents: 2000, first_month_free: true, is_beta: true },
      { integration_key: "zoho", is_hidden: true },
      { integration_key: "tesla", is_unavailable: true },
    ]);
    expect(catalog.inshur).toMatchObject({ isPremium: true, monthlyPriceCents: 2000, firstMonthFree: true, isBeta: true });
    expect(catalog.zoho.isHidden).toBe(true);
    expect(catalog.tesla.isUnavailable).toBe(true);
  });

  it("keeps premium with no price as premium, unpriced, and ignores unknown keys", () => {
    const catalog = catalogFromRows([
      { integration_key: "square", is_premium: true, monthly_price_cents: null, first_month_free: true },
      { integration_key: "made_up", is_premium: true, monthly_price_cents: 100 },
    ]);
    expect(catalog.square).toMatchObject({ isPremium: true, monthlyPriceCents: null, firstMonthFree: true });
    expect("made_up" in catalog).toBe(false);
  });

  it("maps board names to keys", () => {
    expect(keyForBoardName("Inshur")).toBe("inshur");
    expect(keyForBoardName("Turo Sync")).toBe("turo_sync");
    expect(keyForBoardName("Nope")).toBeNull();
  });
});

describe("the words", () => {
  it("formats money, with a real minus for a credit", () => {
    expect(formatMoney(2000)).toBe("$20.00");
    expect(formatMoney(2020)).toBe("$20.20");
    expect(formatMoney(125000)).toBe("$1,250.00");
    expect(formatSignedMoney(-2000)).toBe("−$20.00");
  });

  it("pitches the price before subscribing", () => {
    expect(premiumPitch({ monthlyPriceCents: 2000, currency: "usd", firstMonthFree: false })).toBe(
      "$20.00 a month, added to your Drive247 bill.",
    );
    expect(premiumPitch({ monthlyPriceCents: 2000, currency: "usd", firstMonthFree: true })).toBe(
      "First month free. Then $20.00 a month, added to your Drive247 bill.",
    );
  });

  it("says “$20 will be added to your next bill”, and nothing is charged today", () => {
    expect(
      confirmSentence({ monthlyPriceCents: 2000, currency: "usd", firstMonthFree: false, nextBillAt: "2026-10-15T12:00:00.000Z" }),
    ).toBe("Nothing is charged today. $20.00 will be added to your next bill on Oct 15, 2026, and to every bill after that.");
  });

  it("explains the free month as a charge and a credit on the next bill", () => {
    expect(
      confirmSentence({ monthlyPriceCents: 2000, currency: "usd", firstMonthFree: true, nextBillAt: "2026-10-15T12:00:00.000Z" }),
    ).toBe(
      "Nothing is charged today. Your first month is free: your next bill on Oct 15, 2026 shows $20.00 and a $20.00 credit. From the bill after that, $20.00 will be added every month.",
    );
  });

  it("confirms after subscribing", () => {
    expect(
      subscribedSentence({ name: "Inshur", monthlyPriceCents: 2000, currency: "usd", firstMonthFree: false, firstBillAt: "2026-10-15T12:00:00.000Z" }),
    ).toBe("You're subscribed to Inshur. $20.00 will be added to your next bill on Oct 15, 2026.");
  });
});

describe("the plan it rides on", () => {
  const plan = { status: "active", interval: "month", current_period_end: "2026-10-15T00:00:00Z", trial_end: null, cancel_at: null, canceled_at: null };

  it("answers the same preconditions the edge function enforces", () => {
    expect(planStateOf(null, true)).toBe("loading");
    expect(planStateOf(null, false)).toBe("none");
    expect(planStateOf({ ...plan, status: "canceled" }, false)).toBe("none");
    expect(planStateOf({ ...plan, status: "past_due" }, false)).toBe("past_due");
    expect(planStateOf({ ...plan, cancel_at: "2026-10-15T00:00:00Z" }, false)).toBe("ending");
    expect(planStateOf({ ...plan, interval: "year" }, false)).toBe("not_monthly");
    expect(planStateOf(plan, false)).toBe("ok");
    expect(PLAN_STATE_COPY.none).toMatch(/start your plan in Billing first/);
  });

  it("bills next at the trial's end while trialing, else the period's end", () => {
    expect(nextBillAt(plan)).toBe("2026-10-15T00:00:00Z");
    expect(nextBillAt({ ...plan, status: "trialing", trial_end: "2026-10-08T00:00:00Z" })).toBe("2026-10-08T00:00:00Z");
    expect(nextBillAt(null)).toBeNull();
  });
});

describe("after the reviews", () => {
  it("marks the three coming-soon previews as not for sale", () => {
    expect(isPreviewOnly("inshur")).toBe(true);
    expect(isPreviewOnly("turo_sync")).toBe(true);
    expect(isPreviewOnly("checkmydriver")).toBe(true);
    expect(isPreviewOnly("square")).toBe(false);
    expect(isPreviewOnly("boldsign")).toBe(false);
  });

  it("refuses a plan in another currency up front, as the edge function does", () => {
    const plan = { status: "active", interval: "month", currency: "gbp", current_period_end: null, cancel_at: null, canceled_at: null };
    expect(planStateOf(plan, false, "usd")).toBe("currency");
    expect(planStateOf({ ...plan, currency: "USD" }, false, "usd")).toBe("ok");
  });

  it("dates an existing subscription from its first bill, not the day it was taken", () => {
    const now = new Date("2026-09-22T12:00:00.000Z");
    expect(onYourBillSentence({ firstBillAt: "2026-10-15T12:00:00.000Z", now })).toBe(
      "First on your Drive247 bill on Oct 15, 2026, then every month after, as its own line on each invoice.",
    );
    expect(onYourBillSentence({ firstBillAt: "2026-08-15T12:00:00.000Z", now })).toBe(
      "On your Drive247 bill every month since Aug 15, 2026, as its own line on each invoice.",
    );
  });

  it("uses up the free month only by actually reaching a bill", () => {
    expect(wasOnABill({ first_bill_at: "2026-08-15T00:00:00Z", canceled_at: "2026-09-01T00:00:00Z" })).toBe(true);
    expect(wasOnABill({ first_bill_at: "2026-10-15T00:00:00Z", canceled_at: "2026-09-20T00:00:00Z" })).toBe(false);
    expect(wasOnABill({ first_bill_at: null, canceled_at: "2026-09-20T00:00:00Z" })).toBe(false);
  });
});
