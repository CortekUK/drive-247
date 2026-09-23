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

/**
 * "3 months" must mean 3 REAL bills. A repeating coupon counts months from
 * when it is applied, so on a checkout that starts with a free trial the
 * coupon is stretched by the trial's length in (rounded-up) months.
 */
export function deferredCouponMonths(months: number, trialDays: number): number {
  return months + Math.max(0, Math.ceil(trialDays / 30));
}

/** Variant name for the Stripe mirror table: standard, or deferred_{k}m. */
export function promoVariant(trialDays: number): string {
  const extra = Math.max(0, Math.ceil(trialDays / 30));
  return extra === 0 ? "standard" : `deferred_${extra}m`;
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
