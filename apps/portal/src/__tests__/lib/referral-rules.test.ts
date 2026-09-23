import { describe, expect, it } from "vitest";
import { compile, liftDeclaration, readEdgeSource, readRepoSource } from "../helpers/edge-source";

/**
 * Drive247 platform promo codes + referral programme: the rules.
 *
 * Every function here is LIFTED from supabase/functions/_shared/platform-promo-rules.ts
 * and executed — the tests run the shipped code, not a copy of it.
 */
const SRC = readEdgeSource("_shared/platform-promo-rules.ts");
const lift = (...names: string[]) => names.map(n => liftDeclaration(SRC, n));

type Tier = { id?: string; min_active_referrals: number; discount_type: "percent" | "fixed"; discount_value: number };
type DiscountRef = { discountId: string; couponId: string | null };
type DiscountParam = { discount: string } | { coupon: string };

const resolveTier = compile<(tiers: Tier[], active: number) => Tier | null>(lift("resolveTier"), "resolveTier");
const nextTier = compile<(tiers: Tier[], active: number) => { tier: Tier; needed: number } | null>(lift("nextTier"), "nextTier");
const effectiveTiers = compile<(tenant: Tier[], defaults: Tier[]) => Tier[]>(lift("effectiveTiers"), "effectiveTiers");
const isLive = compile<(s: string | null | undefined) => boolean>(
  lift("LIVE_SUBSCRIPTION_STATUSES", "isLiveSubscriptionStatus"), "isLiveSubscriptionStatus");
const tierCouponId = compile<(t: "percent" | "fixed", v: number, product: string) => string>(
  lift("TIER_COUPON_PREFIX", "tierCouponId"), "tierCouponId");
const isTierCouponId = compile<(id: string | null) => boolean>(
  lift("TIER_COUPON_PREFIX", "isTierCouponId"), "isTierCouponId");
const planTierDiscounts = compile<(current: DiscountRef[], desired: string | null) => { changed: boolean; discounts: DiscountParam[] }>(
  lift("TIER_COUPON_PREFIX", "isTierCouponId", "planTierDiscounts"), "planTierDiscounts");
const deferredCouponMonths = compile<(m: number, trial: number) => number>(lift("deferredCouponMonths"), "deferredCouponMonths");
const promoVariant = compile<(trial: number) => string>(lift("promoVariant"), "promoVariant");
const normalizePromoCode = compile<(v: unknown) => string | null>(
  lift("PROMO_CODE_PATTERN", "normalizePromoCode"), "normalizePromoCode");
const discountText = compile<(t: "percent" | "fixed", v: number, c?: string) => string>(lift("discountText"), "discountText");
const durationText = compile<(d: "once" | "repeating" | "forever", m: number | null) => string>(lift("durationText"), "durationText");
const tierRewardText = compile<(t: Pick<Tier, "discount_type" | "discount_value">) => string>(
  lift("discountText", "tierRewardText"), "tierRewardText");

// The platform default tier table (brief §3.1).
const DEFAULTS: Tier[] = [
  { min_active_referrals: 1, discount_type: "percent", discount_value: 10 },
  { min_active_referrals: 3, discount_type: "percent", discount_value: 20 },
  { min_active_referrals: 5, discount_type: "percent", discount_value: 30 },
];
const pct = (t: Tier | null) => (t ? t.discount_value : null);

describe("referrer tiers are LEVELS, never summed (brief §3.1)", () => {
  it.each([
    [0, null], [1, 10], [2, 10], [3, 20], [4, 20], [5, 30], [6, 30], [7, 30], [50, 30],
  ])("%i subscribed referrals -> %s%% off", (active, expected) => {
    expect(pct(resolveTier(DEFAULTS, active))).toBe(expected);
  });

  it("a one-step-per-referral ladder still gives ONE discount, not the sum", () => {
    const ladder: Tier[] = [1, 2, 3, 4, 5].map(n => ({ min_active_referrals: n, discount_type: "percent", discount_value: n * 10 }));
    expect(pct(resolveTier(ladder, 2))).toBe(20);   // not 10 + 20
    expect(pct(resolveTier(ladder, 5))).toBe(50);   // not 150
  });

  it("row order in the table does not matter", () => {
    expect(pct(resolveTier([...DEFAULTS].reverse(), 4))).toBe(20);
  });

  it("the next tier and how many more referrals reach it", () => {
    expect(nextTier(DEFAULTS, 0)).toMatchObject({ needed: 1, tier: { discount_value: 10 } });
    expect(nextTier(DEFAULTS, 1)).toMatchObject({ needed: 2, tier: { discount_value: 20 } });
    expect(nextTier(DEFAULTS, 4)).toMatchObject({ needed: 1, tier: { discount_value: 30 } });
    expect(nextTier(DEFAULTS, 5)).toBeNull();
  });
});

describe("an operator's own tier table replaces the default entirely (D6)", () => {
  it("override rows only — never a mix with the defaults", () => {
    const custom: Tier[] = [{ min_active_referrals: 2, discount_type: "percent", discount_value: 15 }];
    const tiers = effectiveTiers(custom, DEFAULTS);
    expect(tiers).toHaveLength(1);
    expect(resolveTier(tiers, 1)).toBeNull();           // the default 1 -> 10% does NOT leak in
    expect(pct(resolveTier(tiers, 2))).toBe(15);
  });

  it("no override rows = the defaults ('reset to default' deletes the rows)", () => {
    expect(effectiveTiers([], DEFAULTS).map(t => t.min_active_referrals)).toEqual([1, 3, 5]);
  });

  it("fixed-amount tiers work the same way", () => {
    const fixed: Tier[] = [{ min_active_referrals: 1, discount_type: "fixed", discount_value: 25 }];
    expect(resolveTier(effectiveTiers(fixed, DEFAULTS), 3)).toMatchObject({ discount_type: "fixed", discount_value: 25 });
  });
});

describe("a referral counts only while the referee's subscription is live (R1)", () => {
  it.each(["active", "trialing", "past_due"])("%s counts", s => expect(isLive(s)).toBe(true));
  it.each(["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "", null, undefined])(
    "%s does not", s => expect(isLive(s as string | null | undefined)).toBe(false));
});

describe("the referrer's tier coupon on Stripe (§7.2)", () => {
  it("deterministic coupon ids per value and product, so creating one is idempotent", () => {
    expect(tierCouponId("percent", 10, "prod_A")).toBe("d247-ref-tier-pct-10-prod_A");
    expect(tierCouponId("percent", 30, "prod_A")).toBe("d247-ref-tier-pct-30-prod_A");
    expect(tierCouponId("fixed", 25, "prod_A")).toBe("d247-ref-tier-fixed-2500-prod_A");
    expect(tierCouponId("fixed", 12.5, "prod_A")).toBe("d247-ref-tier-fixed-1250-prod_A");
    expect(tierCouponId("percent", 12.5, "prod_A")).toBe("d247-ref-tier-pct-12p5-prod_A");
    // Same value, different plan product: a different coupon (applies_to differs).
    expect(tierCouponId("percent", 10, "prod_B")).not.toBe(tierCouponId("percent", 10, "prod_A"));
    expect(isTierCouponId(tierCouponId("fixed", 25, "prod_B"))).toBe(true);
  });

  it("only our tier coupons are recognised as tier coupons", () => {
    expect(isTierCouponId("d247-ref-tier-pct-10")).toBe(true);
    expect(isTierCouponId("admin-once-50")).toBe(false);
    expect(isTierCouponId("LAUNCH50")).toBe(false);
    expect(isTierCouponId(null)).toBe(false);
  });

  const ONCE = { discountId: "di_once", couponId: "admin-once-abc" };
  const REFEREE = { discountId: "di_referee", couponId: "Q7xRefereeCoupon" };
  const TIER10 = { discountId: "di_t10", couponId: "d247-ref-tier-pct-10" };

  it("adds the tier reward last and keeps every other discount by id", () => {
    expect(planTierDiscounts([ONCE, REFEREE], "d247-ref-tier-pct-10")).toEqual({
      changed: true,
      discounts: [{ discount: "di_once" }, { discount: "di_referee" }, { coupon: "d247-ref-tier-pct-10" }],
    });
  });

  it("does nothing when the right tier reward is already in place (no Stripe call)", () => {
    expect(planTierDiscounts([ONCE, TIER10], "d247-ref-tier-pct-10").changed).toBe(false);
    expect(planTierDiscounts([], null).changed).toBe(false);
    expect(planTierDiscounts([ONCE], null).changed).toBe(false);
  });

  it("swaps a tier on a tier change, touching nothing else", () => {
    expect(planTierDiscounts([ONCE, TIER10], "d247-ref-tier-pct-20")).toEqual({
      changed: true,
      discounts: [{ discount: "di_once" }, { coupon: "d247-ref-tier-pct-20" }],
    });
  });

  it("removes only the tier reward when the operator drops to no tier", () => {
    expect(planTierDiscounts([ONCE, TIER10, REFEREE], null)).toEqual({
      changed: true,
      discounts: [{ discount: "di_once" }, { discount: "di_referee" }],
    });
  });

  it("moves a kept tier reward to the end, and drops a duplicate", () => {
    expect(planTierDiscounts([TIER10, ONCE], "d247-ref-tier-pct-10")).toEqual({
      changed: true,
      discounts: [{ discount: "di_once" }, { discount: "di_t10" }],
    });
    expect(planTierDiscounts([ONCE, TIER10, { discountId: "di_dup", couponId: "d247-ref-tier-pct-10" }], "d247-ref-tier-pct-10"))
      .toEqual({ changed: true, discounts: [{ discount: "di_once" }, { discount: "di_t10" }] });
  });

  it("is idempotent: planning again after applying changes nothing", () => {
    const first = planTierDiscounts([ONCE], "d247-ref-tier-pct-20");
    const afterStripe = [ONCE, { discountId: "di_new", couponId: "d247-ref-tier-pct-20" }];
    expect(first.changed).toBe(true);
    expect(planTierDiscounts(afterStripe, "d247-ref-tier-pct-20").changed).toBe(false);
  });
});

describe("'3 months' means 3 real bills after a free trial (§7.4)", () => {
  it("stretches a repeating coupon by the trial, rounded up to months", () => {
    expect(deferredCouponMonths(3, 0)).toBe(3);
    expect(deferredCouponMonths(3, 30)).toBe(4);
    expect(deferredCouponMonths(3, 14)).toBe(4);
    expect(deferredCouponMonths(3, 31)).toBe(5);
  });

  it("names the Stripe mirror variant", () => {
    expect(promoVariant(0)).toBe("standard");
    expect(promoVariant(30)).toBe("deferred_1m");
    expect(promoVariant(45)).toBe("deferred_2m");
  });
});

const brandPrefixFrom = compile<(name: string | null, slug: string | null, max?: number) => string>(
  lift("GENERIC_BRAND_WORDS", "brandPrefixFrom"), "brandPrefixFrom");
const referralCodeCandidate = compile<(brand: string, digits: number, random?: () => number) => string>(
  lift("referralCodeCandidate"), "referralCodeCandidate");

describe("referral code format {BRAND}-{DIGITS} (D10, R4)", () => {
  it.each([
    ["Sunset Rentals", "sunset-rentals", "SUNSET"],
    ["RevTek rentals", "revtekrentals", "REVTEK"],
    ["Car Rental Deal HQ", "car-rental-deal-hq", "DEALHQ"],
    ["Moore Luxe Rentals", "moore-luxe-rentals", "MOORELUXE"],
    ["GoNiko!", "goniko", "GONIKO"],
    ["Keyway Rentals LLC", "keyway-rentals", "KEYWAY"],
    ["RBVS", "rbvs", "RBVS"],
    ["Café Économie", "cafe", "CAFEECONOM"],             // accents folded, capped at 10
    ["The Car Company", "sunset-cars", "SUNSET"],          // all generic -> the slug's brand
    ["", "", "OPERATOR"],
  ])("%j -> %s", (name, slug, expected) => expect(brandPrefixFrom(name, slug)).toBe(expected));

  it("adds the configured number of digits", () => {
    let i = 0;
    const seq = [0.48, 0.21, 0.02, 0.19, 0.5, 0.6];
    const rnd = () => seq[i++ % seq.length];
    expect(referralCodeCandidate("SUNSET", 4, rnd)).toBe("SUNSET-4201");
    expect(referralCodeCandidate("SUNSET", 3, () => 0.999)).toBe("SUNSET-999");
    expect(referralCodeCandidate("SUNSET", 6, () => 0)).toBe("SUNSET-000000");
  });

  it("every generated code is a valid stored code", () => {
    for (const name of ["Sunset Rentals", "GoNiko!", "", "Café Économie"]) {
      expect(normalizePromoCode(referralCodeCandidate(brandPrefixFrom(name, "x-y"), 4))).not.toBeNull();
    }
  });
});

describe("codes and wording", () => {
  it.each([
    [" sunset-4821 ", "SUNSET-4821"],
    ["LAUNCH50", "LAUNCH50"],
    ["Sunset-Rentals-4821", "SUNSET-RENTALS-4821"],
  ])("%j -> %s", (input, expected) => expect(normalizePromoCode(input)).toBe(expected));

  it.each(["", "   ", "sunset 4821", "-SUNSET", "SUNSET-", "SUN--SET", "SUNSET_4821", "ÉTÉ-10", 42, null, "A".repeat(65)])(
    "%j is not a code", input => expect(normalizePromoCode(input)).toBeNull());

  it("says what a discount is worth and for how long", () => {
    expect(discountText("percent", 20)).toBe("20% off");
    expect(discountText("fixed", 25)).toBe("$25 off");
    expect(discountText("fixed", 12.5)).toBe("$12.50 off");
    expect(durationText("repeating", 3)).toBe("for your first 3 months");
    expect(durationText("repeating", 1)).toBe("for your first month");
    expect(durationText("once", null)).toBe("on your first bill");
    expect(durationText("forever", null)).toBe("on every bill");
    expect(tierRewardText({ discount_type: "percent", discount_value: 10 })).toBe("10% off every bill");
  });
});

describe("the schema (migrations, not yet applied)", () => {
  const schema = readRepoSource("supabase/migrations/20260922120000_platform_promo_codes.sql");
  const links = readRepoSource("supabase/migrations/20260922120100_promo_code_on_links_and_leads.sql");
  const TABLES = [
    "referral_program_settings", "referral_tiers", "tenant_referral_settings", "platform_promo_codes",
    "platform_promo_code_stripe", "promo_code_redemptions", "referrals", "referral_tier_state",
    "referral_savings", "referral_subscription_scans", "referral_events", "referral_claims",
    "promo_code_lookup_attempts",
  ];

  it("RLS is on for every new table from day one", () => {
    for (const t of TABLES) {
      expect(schema).toContain(`CREATE TABLE public.${t} (`);
      expect(schema).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`));
    }
  });

  it("only the service role writes: no write policies, anon revoked, authenticated read-only", () => {
    expect(schema).not.toMatch(/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(schema).toMatch(/REVOKE ALL ON [\s\S]*? FROM anon;/);
    expect(schema).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON [\s\S]*? FROM authenticated;/);
  });

  // SQL only — the files explain themselves in comments that name the very
  // things they avoid ("no NOT NULL", "no default").
  const sqlOnly = (s: string) => s.replace(/--.*$/gm, "");

  it("additive only: nothing on tenants, no drops, no renames", () => {
    const both = sqlOnly(schema + links);
    expect(both).not.toMatch(/ALTER TABLE (public\.)?tenants\b/i);
    expect(both).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|FUNCTION)\b/i);
    expect(both).not.toMatch(/\bRENAME\b/i);
    // The two existing tables only gain nullable columns.
    expect(sqlOnly(links).match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
    expect(sqlOnly(links)).not.toMatch(/NOT NULL|DEFAULT|CHECK|CREATE TRIGGER/);
  });

  it("seeds the platform default tiers 1 -> 10%, 3 -> 20%, 5 -> 30%", () => {
    expect(schema).toMatch(/\(NULL, 1, 'percent', 10\),\s*\(NULL, 3, 'percent', 20\),\s*\(NULL, 5, 'percent', 30\);/);
    expect(schema).toContain("INSERT INTO public.referral_program_settings (id) VALUES (true);");
  });

  it("one active code per string, one active referral code per operator, one live referral per referee", () => {
    expect(schema).toContain("ON public.platform_promo_codes (upper(code)) WHERE status = 'active'");
    expect(schema).toContain("ON public.platform_promo_codes (owner_tenant_id) WHERE kind = 'referral' AND status = 'active'");
    expect(schema).toContain("ON public.referrals (referred_tenant_id) WHERE status = 'active'");
  });

  it("the stored code format matches the rules module", () => {
    expect(schema).toContain("CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$')");
    expect(SRC).toContain("PROMO_CODE_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/");
  });
});
