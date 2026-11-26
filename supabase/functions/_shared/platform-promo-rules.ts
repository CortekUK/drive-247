/**
 * Drive247 platform promo codes + referral programme — the rules.
 *
 * Pure logic, NO imports: no Stripe, no Supabase, no Deno APIs. Every decision
 * the referral engine, the admin function and the checkout functions make
 * about tiers, coupons and wording lives here, so it is identical everywhere
 * and the test suite runs the shipped code itself (it is lifted out of this
 * file, not copied — see apps/portal/src/__tests__/helpers/edge-source.ts).
 *
 * Money here is what Drive247 charges OPERATORS for their subscription. It has
 * nothing to do with renter bookings or the renter-side `promocodes` table.
 */

export type PromoDiscountType = "percent" | "fixed";
export type PromoDuration = "once" | "repeating" | "forever";

export interface ReferralTier {
  id?: string;
  min_active_referrals: number;
  discount_type: PromoDiscountType;
  /** Percent (0–100] or, for "fixed", an amount in major units (dollars). */
  discount_value: number;
}

/**
 * A referral counts toward the referrer's tier only while the referred
 * operator's subscription is live (brief R1). Canceled, unpaid and expired
 * referrals stop counting and the tier drops from the next bill.
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

export function isLiveSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && LIVE_SUBSCRIPTION_STATUSES.includes(status);
}

/**
 * The tier table that applies to one operator: their own override rows if they
 * have ANY, otherwise the platform defaults. Never a mix of the two.
 * Returned lowest threshold first.
 */
export function effectiveTiers(tenantTiers: ReferralTier[], defaultTiers: ReferralTier[]): ReferralTier[] {
  const rows = tenantTiers.length > 0 ? tenantTiers : defaultTiers;
  return [...rows].sort((a, b) => a.min_active_referrals - b.min_active_referrals);
}

/**
 * The operator's current tier: the single HIGHEST tier whose minimum is met.
 *
 * Tiers are levels, not cumulative (confirmed by Ghulam, 2026-09-22): two
 * subscribed referrals in a 10% tier is 10%, not 20%. Values are never summed
 * and there is never one discount per referral.
 */
export function resolveTier(tiers: ReferralTier[], activeReferrals: number): ReferralTier | null {
  let best: ReferralTier | null = null;
  for (const tier of tiers) {
    if (tier.min_active_referrals <= activeReferrals &&
        (!best || tier.min_active_referrals > best.min_active_referrals)) {
      best = tier;
    }
  }
  return best;
}

/** The next tier up and how many more subscribed referrals reach it; null at the top. */
export function nextTier(
  tiers: ReferralTier[],
  activeReferrals: number,
): { tier: ReferralTier; needed: number } | null {
  let next: ReferralTier | null = null;
  for (const tier of tiers) {
    if (tier.min_active_referrals > activeReferrals &&
        (!next || tier.min_active_referrals < next.min_active_referrals)) {
      next = tier;
    }
  }
  return next ? { tier: next, needed: next.min_active_referrals - activeReferrals } : null;
}

/** Every tier-reward coupon id starts with this; nothing else may. */
export const TIER_COUPON_PREFIX = "d247-ref-tier-";

/**
 * Deterministic Stripe coupon id for a tier value on one product, so creating
 * it is idempotent per account/mode: 10% on prod_X -> d247-ref-tier-pct-10-prod_X,
 * $25 -> d247-ref-tier-fixed-2500-prod_X (cents). A fractional percent keeps
 * its decimals with "p" for the point: 12.5% -> d247-ref-tier-pct-12p5-prod_X.
 *
 * The product is part of the id because the coupon carries
 * applies_to = [product] (brief R2: never discount the $1 verification line or
 * metered e-sign usage), and operators' plans sit on different products.
 */
export function tierCouponId(type: PromoDiscountType, value: number, productId: string): string {
  const amount = type === "fixed"
    ? `fixed-${Math.round(value * 100)}`
    : `pct-${Number(value.toFixed(2)).toString().replace(".", "p")}`;
  return `${TIER_COUPON_PREFIX}${amount}-${productId}`;
}

export function isTierCouponId(couponId: string | null | undefined): boolean {
  return !!couponId && couponId.startsWith(TIER_COUPON_PREFIX);
}

/** One discount already on a subscription (Stripe `di_…` id and its coupon). */
export interface SubscriptionDiscountRef {
  discountId: string;
  couponId: string | null;
}

/** An entry of Stripe's `subscriptions.update({ discounts })` array. */
export type DiscountParam = { discount: string } | { coupon: string };

/**
 * The `discounts` list that leaves a subscription carrying exactly one tier
 * reward — the desired one, or none — and every other discount untouched.
 *
 *  - Other discounts (a super admin's one-time discount, the operator's own
 *    referee discount) are kept, in order, by their existing `di_` id, so they
 *    are kept rather than re-redeemed.
 *  - The tier reward goes LAST, so percentages stack predictably.
 *  - An existing tier discount with the right coupon is kept by id; a wrong
 *    or duplicate one is dropped.
 *
 * `changed` is false when the list already matches, so the engine makes no
 * Stripe call at all on a steady run.
 */
export function planTierDiscounts(
  current: SubscriptionDiscountRef[],
  desiredCouponId: string | null,
): { changed: boolean; discounts: DiscountParam[] } {
  const others = current.filter(d => !isTierCouponId(d.couponId));
  const keep = desiredCouponId ? current.find(d => d.couponId === desiredCouponId) : undefined;

  const discounts: DiscountParam[] = others.map(d => ({ discount: d.discountId }));
  if (desiredCouponId) {
    discounts.push(keep ? { discount: keep.discountId } : { coupon: desiredCouponId });
  }

  const unchanged =
    discounts.length === current.length &&
    discounts.every((d, i) => "discount" in d && d.discount === current[i].discountId);
  return { changed: !unchanged, discounts };
}

/*
 * How long a code's coupon runs on a checkout with a free trial is
 * `couponMonthsFor` (below, feat-001 spec 08.13). It replaced "whole months of
 * trial" (trial days / 30), which gave 30-, 60-, 61- and 90-day trials the
 * wrong number of discounted bills. A repeating coupon counts from signup and
 * stops at its end date: WELCOME20 on Ashkun's subscription ran 23 Nov to 23 Mar
 * and covered 7 Dec, 7 Jan, 7 Feb AND 7 Mar (Neema, 2026-11-25).
 *
 * The Stripe mirror table's variant is `standard` without a trial and
 * `deferred_{k}m` with one (k = the extra months), even at k = 0, so a "once"
 * code's trial coupon (repeating, 1 month, to land on the first PAID bill)
 * never shares a row with its no-trial `standard` coupon (duration once, which
 * would be spent on the $0 trial invoice). 14-day trials stay deferred_0m.
 */

/* ------------------------------------------------------------------------- */
/* feat-001 spec 08: the one place the signup bill math lives.               */
/* Money is whole cents in and out. Dates are calendar days in UTC, written  */
/* "YYYY-MM-DD". Monthly bills keep the day of the first bill and fall back  */
/* to the month's last day when that day does not exist (Stripe's rule).     */
/* ------------------------------------------------------------------------- */

/**
 * One bill after a discount, in whole cents (spec 08.1, 08.6).
 * Percent: rounded to the cent, half up, using whole-number arithmetic so a
 * half is never lost to floating point. Fixed: `value` is in dollars. Never
 * below 0.
 */
export function promoBillCents(priceCents: number, type: PromoDiscountType, value: number): number {
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error(`priceCents must be whole cents, got ${priceCents}`);
  if (!Number.isFinite(value) || value < 0) throw new Error(`discount value must be 0 or more, got ${value}`);
  if (type === "percent") {
    if (value > 100) throw new Error(`a percent discount cannot be over 100, got ${value}`);
    const keepBasisPoints = 10000 - Math.round(value * 100); // 30% -> keep 7000 of 10000
    return Math.floor((priceCents * keepBasisPoints + 5000) / 10000);
  }
  return Math.max(0, priceCents - Math.round(value * 100));
}

function parseDay(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`a date must look like 2026-11-26, got ${iso}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`${iso} is not a real date`);
  }
  return { y, m, d };
}

function formatDay(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `months` calendar months after `iso`, kept on the same day or the month's last day. */
export function addMonthsKeepingDay(iso: string, months: number): string {
  const { y, m, d } = parseDay(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return formatDay(ny, nm, Math.min(d, lastDay));
}

/** `days` days after `iso`. */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parseDay(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return formatDay(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The dates of the first `count` paid monthly bills (spec 08.4). Without a
 * trial the first is charged at signup; with one, on the day the trial ends.
 */
export function paidBillDates(signupISO: string, trialDays: number, count: number): string[] {
  if (!Number.isInteger(trialDays) || trialDays < 0) throw new Error(`trialDays must be a whole number of days, got ${trialDays}`);
  const first = addDays(signupISO, trialDays);
  return Array.from({ length: count }, (_, i) => addMonthsKeepingDay(first, i));
}

/**
 * The coupon's `duration_in_months` so that a "`months` months" code discounts
 * exactly `months` PAID bills (spec 08.5, 08.13).
 *
 * Stripe counts a repeating coupon's months from the subscription's start
 * (signup), and stops discounting at that end date. So the coupon must end
 * after the last discounted bill and no later than the next one: the smallest
 * whole number of months from signup that passes the last discounted bill.
 * This replaces "trial days / 30", which gives a 60-day trial 4 discounted
 * bills (signup 26 Nov, bills 25 Jan, 25 Feb, 25 Mar, 25 Apr all before 26 Apr).
 */
export function couponMonthsFor(signupISO: string, trialDays: number, months: number): number {
  if (!Number.isInteger(months) || months < 1) throw new Error(`months must be 1 or more, got ${months}`);
  const bills = paidBillDates(signupISO, trialDays, months);
  const lastDiscounted = bills[months - 1];
  let m = months;
  while (addMonthsKeepingDay(signupISO, m) <= lastDiscounted) m++;
  return m;
}

/**
 * Which paid bills the coupon from `couponMonthsFor` really discounts: those
 * dated before the coupon ends. Spec 08's worked examples check this, so the
 * test proves the coupon length, not a list built to match it.
 */
export function discountedBillDates(signupISO: string, trialDays: number, months: number): string[] {
  const end = addMonthsKeepingDay(signupISO, couponMonthsFor(signupISO, trialDays, months));
  return paidBillDates(signupISO, trialDays, months + 2).filter((day) => day < end);
}

/** What the card step shows about the money (spec 08.3, 08.4, 08.12). */
export interface SignupBill {
  /** Charged when the card is entered: 0 during a free trial. */
  todayCents: number;
  /** "YYYY-MM-DD" of the first paid bill. */
  firstChargeAt: string;
  firstChargeCents: number;
  /** How many paid bills get the discount: 0 without a code, null for "forever". */
  discountedBills: number | null;
  /** One discounted bill (equals fullPriceCents without a code). */
  discountedBillCents: number;
  /** The plan price, charged once the discount ends. */
  fullPriceCents: number;
}

export function signupBill(
  priceCents: number,
  trialDays: number,
  signupISO: string,
  promo: { discountType: PromoDiscountType; discountValue: number; duration: PromoDuration; durationMonths: number | null } | null,
): SignupBill {
  const [firstChargeAt] = paidBillDates(signupISO, trialDays, 1);
  const discountedBillCents = promo ? promoBillCents(priceCents, promo.discountType, promo.discountValue) : priceCents;
  const discountedBills = !promo ? 0 : promo.duration === "forever" ? null : promo.duration === "once" ? 1 : (promo.durationMonths ?? 1);
  const firstChargeCents = discountedBills === 0 ? priceCents : discountedBillCents;
  return {
    todayCents: trialDays > 0 ? 0 : firstChargeCents,
    firstChargeAt,
    firstChargeCents,
    discountedBills,
    discountedBillCents,
    fullPriceCents: priceCents,
  };
}

/** What a stored code looks like (matches the table's CHECK). */
export const PROMO_CODE_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

/**
 * A code as typed or carried in a link, or null if it cannot be one.
 * Codes are case-insensitive (as in Stripe), so they are compared uppercased.
 */
export function normalizePromoCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  if (code.length === 0 || code.length > 64) return null;
  return PROMO_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Words that say what an operator IS rather than WHO they are. Dropped from the
 * brand part of a referral code: "Sunset Rentals" -> SUNSET, not SUNSETRENT.
 */
const GENERIC_BRAND_WORDS: ReadonlySet<string> = new Set([
  "THE", "AND", "OF", "RENT", "RENTS", "RENTAL", "RENTALS", "HIRE", "HIRES", "CAR", "CARS",
  "AUTO", "AUTOS", "MOTOR", "MOTORS", "VEHICLE", "VEHICLES", "FLEET", "SERVICE", "SERVICES",
  "LLC", "LTD", "LIMITED", "INC", "CO", "CORP", "COMPANY", "GROUP",
]);

/**
 * The BRAND in a {BRAND}-{DIGITS} referral code (decision D10): the operator's
 * business name, uppercased, letters and digits only, generic words dropped,
 * at most `maxLength` characters. Falls back to the slug when the name is all
 * generic words ("The Car Company"), and to OPERATOR when both are empty.
 */
export function brandPrefixFrom(companyName: string | null | undefined, slug: string | null | undefined, maxLength = 10): string {
  const words = (text: string | null | undefined) =>
    (text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase()
      .split(/[^A-Z0-9]+/).filter(Boolean);
  const meaningful = words(companyName).filter(w => !GENERIC_BRAND_WORDS.has(w));
  const fromSlug = words(slug).filter(w => !GENERIC_BRAND_WORDS.has(w));
  const brand = (meaningful.length > 0 ? meaningful : fromSlug).join("") || words(slug).join("") || "OPERATOR";
  return brand.slice(0, maxLength);
}

/** "SUNSET" + 4 -> "SUNSET-4821". `random` returns [0, 1); injectable for tests. */
export function referralCodeCandidate(brand: string, digits: number, random: () => number = Math.random): string {
  let suffix = "";
  for (let i = 0; i < digits; i++) suffix += Math.floor(random() * 10).toString();
  return `${brand}-${suffix}`;
}

/** "20% off", "$25 off", "$12.50 off". */
export function discountText(type: PromoDiscountType, value: number, currency = "usd"): string {
  if (type === "percent") return `${Number(value.toFixed(2))}% off`;
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return currency.toLowerCase() === "usd" ? `$${amount} off` : `${amount} ${currency.toUpperCase()} off`;
}

/** "on your first bill", "for your first 3 months", "on every bill". */
export function durationText(duration: PromoDuration, months: number | null | undefined): string {
  if (duration === "once") return "on your first bill";
  if (duration === "forever") return "on every bill";
  const n = months ?? 1;
  return n === 1 ? "for your first month" : `for your first ${n} months`;
}

/** A tier as the operator reads it: "10% off every bill". */
export function tierRewardText(tier: Pick<ReferralTier, "discount_type" | "discount_value">): string {
  return `${discountText(tier.discount_type, tier.discount_value)} every bill`;
}
