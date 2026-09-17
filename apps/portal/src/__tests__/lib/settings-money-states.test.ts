/**
 * v2 Settings state rules for Installments, Pay As You Go, Auto-extend, Promo
 * Codes and Extras (`lib/settings-money-states.ts`). Every expectation below is
 * worked by hand from the rule, not read back from the function.
 */
import { describe, it, expect } from "vitest";
import {
  checkWholeNumber,
  getExtraFormIssues,
  installmentDraftFromConfig,
  isInstallmentDraftDirty,
  isPromoExpired,
  lowStockSentence,
  isDuplicatePromoCodeError,
  paymentProviderState,
  planMinimumDays,
  planOnlineMinimumDays,
  PROMO_CODE_TAKEN_COPY,
  promoSaveError,
  validatePromoDraft,
  validatePromoEdit,
  visiblePromoIssues,
} from "@/lib/settings-money-states";

describe("checkWholeNumber (auto-extend hours and retries)", () => {
  it("accepts whole numbers inside the range, including both ends", () => {
    expect(checkWholeNumber("48", 0, 720, "hours")).toEqual({ ok: true, value: 48 });
    expect(checkWholeNumber("0", 0, 720, "hours")).toEqual({ ok: true, value: 0 });
    expect(checkWholeNumber("720", 0, 720, "hours")).toEqual({ ok: true, value: 720 });
    expect(checkWholeNumber(" 12 ", 0, 168, "hours")).toEqual({ ok: true, value: 12 });
  });

  it("refuses empty, negative, decimal and out-of-range input instead of coercing it", () => {
    const refused = { ok: false, message: "Enter 0–720 hours" };
    expect(checkWholeNumber("", 0, 720, "hours")).toEqual(refused); // Number('') would have saved 0
    expect(checkWholeNumber("-5", 0, 720, "hours")).toEqual(refused);
    expect(checkWholeNumber("1.5", 0, 720, "hours")).toEqual(refused);
    expect(checkWholeNumber("721", 0, 720, "hours")).toEqual(refused);
    expect(checkWholeNumber("1e3", 0, 720, "hours")).toEqual(refused);
    expect(checkWholeNumber("21", 0, 20, "retries")).toEqual({ ok: false, message: "Enter 0–20 retries" });
  });
});

describe("paymentProviderState", () => {
  it("is unknown without a row and for a non-Stripe provider", () => {
    expect(paymentProviderState(null)).toBe("unknown");
    expect(paymentProviderState({ payment_provider: "square" })).toBe("unknown");
  });

  it("follows the Stripe Connect rule: own account, or onboarding complete and active", () => {
    expect(paymentProviderState({})).toBe("missing");
    expect(paymentProviderState({ stripe_onboarding_complete: true, stripe_account_status: "restricted" })).toBe("missing");
    expect(paymentProviderState({ stripe_onboarding_complete: true, stripe_account_status: "active" })).toBe("connected");
    expect(paymentProviderState({ own_stripe_test_account_id: "acct_1" })).toBe("connected");
    expect(paymentProviderState({ payment_provider: "stripe", own_stripe_account_id: "acct_2" })).toBe("connected");
  });
});

describe("installment plan draft", () => {
  const defaults = { weekly_enabled: false, weekly_payments_per_unit: 1, monthly_enabled: false, monthly_payments_per_unit: 1 };

  it("reads the four plan fields with the section's defaults", () => {
    expect(installmentDraftFromConfig(null)).toEqual(defaults);
    expect(installmentDraftFromConfig({ weekly_enabled: true, monthly_payments_per_unit: 4 })).toEqual({
      ...defaults,
      weekly_enabled: true,
      monthly_payments_per_unit: 4,
    });
  });

  it("is dirty only when a plan field differs from what is saved", () => {
    expect(isInstallmentDraftDirty(installmentDraftFromConfig(null), null)).toBe(false);
    // Unrelated keys (minimums, retry policy) never make the draft dirty.
    expect(isInstallmentDraftDirty({ ...defaults } as never, { minimum_days_weekly: 14, grace_period_days: 3 })).toBe(false);
    expect(isInstallmentDraftDirty({ ...defaults, weekly_enabled: true } as never, { weekly_enabled: false })).toBe(true);
    expect(isInstallmentDraftDirty({ ...defaults, monthly_payments_per_unit: 2 } as never, { monthly_payments_per_unit: 1 })).toBe(true);
  });

  it("reads the saved minimum days only for the older count-cap shape, falling back to old keys and then 7 / 30", () => {
    expect(planMinimumDays({ minimum_days_weekly: 14 }, "weekly")).toBe(14);
    expect(planMinimumDays({ min_days_for_monthly: 45 }, "monthly")).toBe(45);
    expect(planMinimumDays(null, "weekly")).toBe(7);
    expect(planMinimumDays(null, "monthly")).toBe(30);
    expect(planMinimumDays({ minimum_days_weekly: -1 }, "weekly")).toBe(7);
  });

  it("uses New Rental's and checkout's fixed 7 / 30 days for the cadence shape this section saves", () => {
    // rental-create-v2 and InstallmentSelector hard-code these once any cadence key is present.
    expect(planMinimumDays({ weekly_enabled: false, minimum_days_weekly: 14 }, "weekly")).toBe(7);
    expect(planMinimumDays({ monthly_payments_per_unit: 2, minimum_days_monthly: 45 }, "monthly")).toBe(30);
    expect(planMinimumDays({ weekly_enabled: true, minimum_days_weekly: 9999999 }, "weekly")).toBe(7);
  });

  it("raises the online minimum to checkout's section gate, the smaller of the two saved minimums", () => {
    const cadence = { weekly_enabled: true, minimum_days_weekly: 14, minimum_days_monthly: 45 };
    // gate = min(14, 45) = 14: weekly max(7, 14) = 14; monthly max(30, 14) = 30 (45 never applies).
    expect(planOnlineMinimumDays(cadence, "weekly")).toBe(14);
    expect(planOnlineMinimumDays(cadence, "monthly")).toBe(30);
    // gate = min(40, 60) = 40: both plans wait for 40 days online.
    expect(planOnlineMinimumDays({ weekly_enabled: true, minimum_days_weekly: 40, minimum_days_monthly: 60 }, "weekly")).toBe(40);
    expect(planOnlineMinimumDays({ weekly_enabled: true, minimum_days_weekly: 40, minimum_days_monthly: 60 }, "monthly")).toBe(40);
    // gate = min(9999999, 0) = 0: nothing is raised.
    expect(planOnlineMinimumDays({ weekly_enabled: true, minimum_days_weekly: 9999999, min_days_for_monthly: 0 }, "weekly")).toBe(7);
    expect(planOnlineMinimumDays({ weekly_enabled: true, minimum_days_weekly: 9999999, min_days_for_monthly: 0 }, "monthly")).toBe(30);
    // No minimums saved: gate = min(7, 30) = 7.
    expect(planOnlineMinimumDays({ weekly_enabled: true }, "weekly")).toBe(7);
    expect(planOnlineMinimumDays({ weekly_enabled: true }, "monthly")).toBe(30);
    // Older shape: per-plan 14 and 45, gate 14, so 14 and 45.
    expect(planOnlineMinimumDays({ minimum_days_weekly: 14, minimum_days_monthly: 45 }, "weekly")).toBe(14);
    expect(planOnlineMinimumDays({ minimum_days_weekly: 14, minimum_days_monthly: 45 }, "monthly")).toBe(45);
    expect(planOnlineMinimumDays(null, "monthly")).toBe(30);
  });
});

describe("validatePromoDraft", () => {
  const today = new Date(2026, 8, 15); // 15 Sep 2026, local
  const valid = {
    name: "Winter",
    type: "percentage",
    value: "10",
    created_at: new Date(2026, 8, 15),
    expires_at: new Date(2026, 9, 15),
    max_users: "100",
  };

  it("passes a complete, sensible code", () => {
    expect(validatePromoDraft(valid, today)).toEqual({});
    expect(validatePromoDraft({ ...valid, value: ".5" }, today)).toEqual({});
    // A money discount has no 100 cap.
    expect(validatePromoDraft({ ...valid, type: "value", value: "150" }, today)).toEqual({});
    // Expiring today is still live today.
    expect(validatePromoDraft({ ...valid, expires_at: new Date(2026, 8, 15, 23, 0) }, today)).toEqual({});
  });

  it("marks blank required fields as missing", () => {
    const issues = validatePromoDraft({ ...valid, name: "  ", value: "", max_users: "" }, today);
    expect(issues.name).toEqual({ kind: "missing", message: "Enter a name" });
    expect(issues.value).toEqual({ kind: "missing", message: "Enter a discount" });
    expect(issues.max_users).toEqual({ kind: "missing", message: "Enter how many times this code can be used" });
  });

  it("refuses values that used to save as nonsense", () => {
    expect(validatePromoDraft({ ...valid, value: "150" }, today).value?.message).toBe("A percentage discount can't exceed 100%");
    expect(validatePromoDraft({ ...valid, value: "1.2.3" }, today).value?.message).toBe("Enter a number, like 10 or 12.50");
    expect(validatePromoDraft({ ...valid, value: "." }, today).value?.message).toBe("Enter a number, like 10 or 12.50");
    expect(validatePromoDraft({ ...valid, value: "0" }, today).value?.message).toBe("The discount must be more than 0");
    expect(validatePromoDraft({ ...valid, max_users: "0" }, today).max_users?.message).toBe("Enter at least 1");
  });

  it("checks the dates against each other and against today", () => {
    expect(
      validatePromoDraft({ ...valid, created_at: new Date(2026, 9, 1), expires_at: new Date(2026, 8, 20) }, today).expires_at?.message,
    ).toBe("Expiry must be on or after the start date");
    expect(
      validatePromoDraft({ ...valid, created_at: new Date(2026, 8, 1), expires_at: new Date(2026, 8, 10) }, today).expires_at?.message,
    ).toBe("This code would already be expired");
  });

  it("shows invalid issues at once and missing ones only after a submit", () => {
    const issues = validatePromoDraft({ ...valid, name: "", value: "150" }, today);
    expect(visiblePromoIssues(issues, false)).toEqual({ value: "A percentage discount can't exceed 100%" });
    expect(visiblePromoIssues(issues, true)).toEqual({
      name: "Enter a name",
      value: "A percentage discount can't exceed 100%",
    });
  });
});

describe("validatePromoEdit (the Edit dialog)", () => {
  const today = new Date(2026, 8, 15); // 15 Sep 2026, local
  const row = {
    name: "Winter",
    type: "percentage",
    value: 15, // numbers, as the saved row holds them
    max_users: 100,
    created_at: "2026-09-01",
    expires_at: new Date(2026, 11, 31),
  };

  it("passes a valid saved row whose numbers are numbers, not strings", () => {
    expect(validatePromoEdit(row, { expires_at: "2026-12-31" }, today)).toEqual({});
  });

  it("refuses a percentage over 100, no uses left and an empty discount", () => {
    expect(validatePromoEdit({ ...row, value: "150" }, null, today).value).toEqual({
      kind: "invalid",
      message: "A percentage discount can't exceed 100%",
    });
    expect(validatePromoEdit({ ...row, max_users: 0 }, null, today).max_users?.message).toBe("Enter at least 1");
    expect(validatePromoEdit({ ...row, value: "" }, null, today).value).toEqual({ kind: "missing", message: "Enter a discount" });
  });

  it("does not re-judge an expiry left as saved, but refuses a new one in the past", () => {
    const expired = { ...row, created_at: "2025-06-01", expires_at: new Date(2025, 7, 31) };
    expect(validatePromoEdit(expired, { expires_at: "2025-08-31" }, today)).toEqual({});
    expect(validatePromoEdit({ ...row, expires_at: new Date(2026, 8, 14) }, { expires_at: "2026-12-31" }, today).expires_at?.message).toBe(
      "This code would already be expired",
    );
  });

  it("refuses an expiry before the saved start date, and ignores a start date that does not parse", () => {
    expect(
      validatePromoEdit({ ...row, created_at: "2026-10-01", expires_at: new Date(2026, 8, 30) }, { expires_at: "2026-12-31" }, today)
        .expires_at?.message,
    ).toBe("Expiry must be on or after the start date");
    expect(validatePromoEdit({ ...row, created_at: "not-a-date" }, { expires_at: "2026-12-31" }, today)).toEqual({});
  });
});

describe("promo duplicate-code errors", () => {
  const codeKey = { code: "23505", message: 'duplicate key value violates unique constraint "promocodes_code_tenant_key"' };

  it("recognises a taken code by its constraint or its key", () => {
    expect(isDuplicatePromoCodeError(codeKey)).toBe(true);
    expect(
      isDuplicatePromoCodeError({ code: "23505", message: 'duplicate key value violates unique constraint "x"', details: "Key (code, tenant_id)=(A1, t) already exists." }),
    ).toBe(true);
  });

  it("leaves other duplicates and other errors alone", () => {
    expect(
      isDuplicatePromoCodeError({ code: "23505", message: 'duplicate key value violates unique constraint "promocodes_name_key"', details: "Key (name)=(x) already exists." }),
    ).toBe(false);
    expect(isDuplicatePromoCodeError({ code: "42501", message: "promocodes_code_tenant_key" })).toBe(false);
    expect(isDuplicatePromoCodeError(null)).toBe(false);
  });

  it("swaps in the code copy only for a taken code", () => {
    expect(promoSaveError(codeKey)).toEqual({ message: PROMO_CODE_TAKEN_COPY });
    const other = new Error("Failed to fetch");
    expect(promoSaveError(other)).toBe(other);
  });
});

describe("isPromoExpired", () => {
  const today = new Date(2026, 8, 15);
  it("reads yyyy-MM-dd as the local calendar day", () => {
    expect(isPromoExpired("2026-09-14", today)).toBe(true);
    expect(isPromoExpired("2026-09-15", today)).toBe(false);
    expect(isPromoExpired("2026-09-16", today)).toBe(false);
  });
  it("never calls an unparseable or missing date expired", () => {
    expect(isPromoExpired("not-a-date", today)).toBe(false);
    expect(isPromoExpired(null, today)).toBe(false);
  });
});

describe("getExtraFormIssues", () => {
  const base = {
    name: "GPS",
    price: "12.50",
    pricing_type: "global" as const,
    vehicle_pricing: [],
    image_urls: ["https://x/a.png"],
    is_quantity_based: false,
    max_quantity: "10",
  };

  it("passes a complete extra, including a free one", () => {
    expect(getExtraFormIssues(base)).toEqual({});
    expect(getExtraFormIssues({ ...base, price: "0" })).toEqual({});
  });

  it("lists every problem at once, one per field", () => {
    expect(getExtraFormIssues({ ...base, name: " ", price: "-1", image_urls: [] })).toEqual({
      name: "Enter a name",
      price: "Enter a price of 0 or more",
      images: "Add at least one image. Customers see it when they book.",
    });
    expect(getExtraFormIssues({ ...base, price: "abc" }).price).toBe("Enter a price of 0 or more");
  });

  it("checks per-vehicle prices instead of the global price", () => {
    expect(getExtraFormIssues({ ...base, pricing_type: "per_vehicle", price: "" })).toEqual({
      vehicle_pricing: "Add at least one vehicle and its price",
    });
    expect(
      getExtraFormIssues({ ...base, pricing_type: "per_vehicle", vehicle_pricing: [{ price: "5" }, { price: "" }] }).vehicle_pricing,
    ).toBe("Every vehicle needs a price of 0 or more");
  });

  it("needs a whole stock of at least 1 for a quantity-based extra", () => {
    expect(getExtraFormIssues({ ...base, is_quantity_based: true, max_quantity: "0" }).max_quantity).toBe("Enter a stock of at least 1");
    expect(getExtraFormIssues({ ...base, is_quantity_based: true, max_quantity: "2.5" }).max_quantity).toBe("Enter a stock of at least 1");
    expect(getExtraFormIssues({ ...base, is_quantity_based: true, max_quantity: "3" })).toEqual({});
  });
});

describe("lowStockSentence", () => {
  it("names up to two extras and counts the rest", () => {
    expect(lowStockSentence([])).toBe("");
    expect(lowStockSentence(["Baby seat"])).toBe("Baby seat is below 20% stock.");
    expect(lowStockSentence(["Baby seat", "GPS"])).toBe("Baby seat and GPS are below 20% stock.");
    expect(lowStockSentence(["Baby seat", "GPS", "Cooler", "Chains"])).toBe("Baby seat, GPS and 2 more are below 20% stock.");
  });
});
