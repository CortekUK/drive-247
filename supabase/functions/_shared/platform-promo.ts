/**
 * Drive247 platform promo codes + referral programme — Stripe and database
 * machinery shared by: promo-code-lookup, admin-promo-codes, referral-engine,
 * tenant-referrals, subscription-link-v2 and apply-subscription-discount-v2.
 *
 * A NEW helper (V2_PLAN §7: add a helper, never edit an existing one). It only
 * imports from the existing helpers.
 *
 * The decisions themselves (tiers, coupon ids, the discounts list, wording) are
 * in ./platform-promo-rules.ts, which has no imports and is unit-tested.
 *
 * Two facts shape the Stripe side:
 *   - Coupons carry applies_to = [the plan's product] so they never discount
 *     the $1 card-verification line or metered e-sign usage (brief R2). Plans
 *     do NOT share one product (sales onboarding mints one per plan), so every
 *     coupon is minted per product.
 *   - We apply codes ourselves and attach the coupon directly; Stripe's own
 *     promo-code box is never shown (brief §7.1), so no Stripe promotion code
 *     is needed.
 */
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getSubscriptionStripeClientForAccount, type SubscriptionAccount } from "./subscription-stripe.ts";
import { siteBaseUrl } from "./subscription-link.ts";
import {
  brandPrefixFrom,
  deferredCouponMonths,
  discountText,
  durationText,
  effectiveTiers,
  isLiveSubscriptionStatus,
  LIVE_SUBSCRIPTION_STATUSES,
  normalizePromoCode,
  planTierDiscounts,
  promoVariant,
  referralCodeCandidate,
  resolveTier,
  tierCouponId,
  type PromoDiscountType,
  type PromoDuration,
  type ReferralTier,
  type SubscriptionDiscountRef,
} from "./platform-promo-rules.ts";

export type StripeMode = "test" | "live";
export type PromoKind = "campaign" | "referral";

export interface PromoCodeRow {
  id: string;
  code: string;
  kind: PromoKind;
  owner_tenant_id: string | null;
  discount_type: PromoDiscountType;
  discount_value: number;
  currency: string;
  duration: PromoDuration;
  duration_months: number | null;
  max_redemptions: number | null;
  expires_at: string | null;
  restrict_signup_plan_keys: string[] | null;
  status: "active" | "inactive" | "superseded";
  superseded_by: string | null;
  note: string | null;
  created_at: string;
}

// One string literal, not a concatenation: supabase-js types `.select()` by
// parsing the literal, and a plain `string` types every row as an error.
export const PROMO_CODE_COLUMNS =
  "id, code, kind, owner_tenant_id, discount_type, discount_value, currency, duration, duration_months, max_redemptions, expires_at, restrict_signup_plan_keys, status, superseded_by, note, created_at";

export interface ProgramSettings {
  enabled: boolean;
  default_referee_discount_type: PromoDiscountType;
  default_referee_discount_value: number;
  default_referee_duration: PromoDuration;
  default_referee_duration_months: number | null;
  code_suffix_length: number;
  link_cookie_days: number;
}

/** The public referral link for a code: drive-247.com/r/SUNSET-4821. */
export function referralLink(code: string): string {
  return `${siteBaseUrl()}/r/${encodeURIComponent(code)}`;
}

/** numeric(10,2) arrives from PostgREST as a string; the rules want numbers. */
export function toCodeRow(raw: Record<string, unknown>): PromoCodeRow {
  return {
    ...(raw as unknown as PromoCodeRow),
    discount_value: Number(raw.discount_value),
  };
}

function toTier(raw: Record<string, unknown>): ReferralTier {
  return {
    id: raw.id as string,
    min_active_referrals: Number(raw.min_active_referrals),
    discount_type: raw.discount_type as PromoDiscountType,
    discount_value: Number(raw.discount_value),
  };
}

// ─────────────────────────────────────────────────────────────── settings ──

export async function loadProgramSettings(supabase: any): Promise<ProgramSettings> {
  const { data, error } = await supabase
    .from("referral_program_settings")
    .select("enabled, default_referee_discount_type, default_referee_discount_value, default_referee_duration, default_referee_duration_months, code_suffix_length, link_cookie_days")
    .eq("id", true)
    .single();
  if (error || !data) throw new Error(`Referral programme settings unavailable: ${error?.message ?? "no row"}`);
  return {
    ...data,
    default_referee_discount_value: Number(data.default_referee_discount_value),
  } as ProgramSettings;
}

/** An operator's own tier rows if they have any, otherwise the platform defaults. */
export async function loadEffectiveTiers(supabase: any, tenantId: string): Promise<{ tiers: ReferralTier[]; custom: boolean }> {
  const { data, error } = await supabase
    .from("referral_tiers")
    .select("id, tenant_id, min_active_referrals, discount_type, discount_value")
    .or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  if (error) throw new Error(`Referral tiers unavailable: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const own = rows.filter(r => r.tenant_id === tenantId).map(toTier);
  const defaults = rows.filter(r => r.tenant_id === null).map(toTier);
  return { tiers: effectiveTiers(own, defaults), custom: own.length > 0 };
}

// ──────────────────────────────────────────────────── finding a live code ──

export type CodeRejection =
  | "not_found" | "expired" | "maxed_out" | "inactive" | "plan_not_eligible"
  | "programme_disabled" | "owner_disabled" | "self_referral" | "not_new_operator"
  | "already_referred";

/** The active version of a code, or why there isn't one. */
export async function findCode(
  supabase: any,
  raw: unknown,
): Promise<{ ok: true; code: PromoCodeRow } | { ok: false; reason: CodeRejection }> {
  const normalized = normalizePromoCode(raw);
  if (!normalized) return { ok: false, reason: "not_found" };
  const { data, error } = await supabase
    .from("platform_promo_codes")
    .select(PROMO_CODE_COLUMNS)
    .eq("code", normalized)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`Promo code lookup failed: ${error.message}`);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).map(toCodeRow);
  const active = rows.find(r => r.status === "active");
  if (active) return { ok: true, code: active };
  return { ok: false, reason: rows.length > 0 ? "inactive" : "not_found" };
}

/** Redemptions across every VERSION of a code: a rotation must not reset a "max 20 uses" cap. */
async function countRedemptions(supabase: any, code: PromoCodeRow): Promise<number> {
  const { data: versions, error } = await supabase
    .from("platform_promo_codes")
    .select("id")
    .eq("code", code.code)
    .eq("kind", code.kind);
  if (error) throw new Error(`Redemption count failed: ${error.message}`);
  const ids = ((versions ?? []) as Array<{ id: string }>).map(v => v.id);
  if (ids.length === 0) return 0;
  const { count, error: countError } = await supabase
    .from("promo_code_redemptions")
    .select("id", { count: "exact", head: true })
    .in("promo_code_id", ids);
  if (countError) throw new Error(`Redemption count failed: ${countError.message}`);
  return count ?? 0;
}

/**
 * Whether a code may be used right now, and — when the redeeming operator is
 * known — by them. The same rules answer the public lookup, the payment page
 * and the checkout, so a code that looked valid on screen cannot fail at pay
 * time for a reason the screen did not show.
 */
export async function checkCodeUsable(
  supabase: any,
  code: PromoCodeRow,
  ctx: { channel: "lookup" | "payment_link" | "self_serve"; planKey?: string | null; redeemingTenantId?: string | null },
): Promise<{ ok: true } | { ok: false; reason: CodeRejection }> {
  if (code.status !== "active") return { ok: false, reason: "inactive" };
  if (code.expires_at && new Date(code.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (code.max_redemptions != null && (await countRedemptions(supabase, code)) >= code.max_redemptions) {
    return { ok: false, reason: "maxed_out" };
  }

  // Plan restrictions name SIGNUP plans (self-serve). A sales payment link bills
  // a tenant-specific plan that has no signup key, so a restricted code cannot
  // apply there.
  const restricted = (code.restrict_signup_plan_keys ?? []).length > 0;
  if (restricted) {
    if (ctx.channel === "payment_link") return { ok: false, reason: "plan_not_eligible" };
    if (ctx.planKey && !code.restrict_signup_plan_keys!.includes(ctx.planKey)) {
      return { ok: false, reason: "plan_not_eligible" };
    }
  }

  if (code.kind === "referral") {
    const settings = await loadProgramSettings(supabase);
    if (!settings.enabled) return { ok: false, reason: "programme_disabled" };
    const { data: owner } = await supabase
      .from("tenant_referral_settings")
      .select("referrals_enabled")
      .eq("tenant_id", code.owner_tenant_id)
      .maybeSingle();
    if (owner && owner.referrals_enabled === false) return { ok: false, reason: "owner_disabled" };
    const { data: ownerTenant } = await supabase
      .from("tenants")
      .select("id, status")
      .eq("id", code.owner_tenant_id)
      .maybeSingle();
    if (!ownerTenant || ownerTenant.status === "suspended") return { ok: false, reason: "owner_disabled" };
  }

  const tenantId = ctx.redeemingTenantId;
  if (tenantId) {
    if (code.kind === "referral" && code.owner_tenant_id === tenantId) return { ok: false, reason: "self_referral" };

    // New operators only: anyone who has ever held a real subscription is not
    // new. 'incomplete' / 'incomplete_expired' are the residue of a declined
    // card, not a subscription, and must not lock a first-time payer out.
    const { data: subs, error } = await supabase
      .from("tenant_subscriptions")
      .select("status")
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`Subscription history unavailable: ${error.message}`);
    const everSubscribed = ((subs ?? []) as Array<{ status: string }>)
      .some(s => !["incomplete", "incomplete_expired"].includes(s.status));
    if (everSubscribed) return { ok: false, reason: "not_new_operator" };

    if (code.kind === "referral") {
      const { data: existing } = await supabase
        .from("referrals")
        .select("id")
        .eq("referred_tenant_id", tenantId)
        .eq("status", "active")
        .limit(1);
      if ((existing ?? []).length > 0) return { ok: false, reason: "already_referred" };
    }
  }
  return { ok: true };
}

/** What a visitor may be told about a code. Never ids, never money owed. */
export async function publicCodeView(supabase: any, code: PromoCodeRow): Promise<{
  kind: PromoKind; displayCode: string; discountText: string; durationText: string; referrerName: string | null;
  duration: PromoDuration; durationMonths: number | null;
  /** The offer itself (public: it is what the code gives), for showing a discounted price. */
  discountType: PromoDiscountType; discountValue: number; currency: string;
}> {
  let referrerName: string | null = null;
  if (code.kind === "referral" && code.owner_tenant_id) {
    const { data: prefs } = await supabase
      .from("tenant_referral_settings")
      .select("show_name_on_invite")
      .eq("tenant_id", code.owner_tenant_id)
      .maybeSingle();
    if (!prefs || prefs.show_name_on_invite !== false) {
      const { data: owner } = await supabase
        .from("tenants")
        .select("company_name")
        .eq("id", code.owner_tenant_id)
        .maybeSingle();
      referrerName = owner?.company_name ?? null;
    }
  }
  return {
    kind: code.kind,
    displayCode: code.code,
    discountText: discountText(code.discount_type, code.discount_value, code.currency),
    durationText: durationText(code.duration, code.duration_months),
    referrerName,
    duration: code.duration,
    durationMonths: code.duration_months,
    discountType: code.discount_type,
    discountValue: code.discount_value,
    currency: code.currency,
  };
}

// ───────────────────────────────────────────────────────────── Stripe bits ──

export function stripeFor(account: SubscriptionAccount, mode: StripeMode): Stripe {
  return getSubscriptionStripeClientForAccount(account, mode) as unknown as Stripe;
}

/** The product a price belongs to. */
export async function productForPrice(stripe: Stripe, priceId: string): Promise<string> {
  const price = await stripe.prices.retrieve(priceId);
  return typeof price.product === "string" ? price.product : price.product.id;
}

/** The plan's product on a subscription: the one item that is not metered usage. */
export function planProductOfSubscription(sub: Stripe.Subscription): string | null {
  for (const item of sub.items?.data ?? []) {
    const price = item.price;
    if (!price || price.recurring?.usage_type === "metered") continue;
    return typeof price.product === "string" ? price.product : price.product?.id ?? null;
  }
  return null;
}

/** Every discount on a subscription as {discountId, couponId}, from either API shape. */
export function discountRefsOf(sub: Stripe.Subscription): SubscriptionDiscountRef[] {
  const refs: SubscriptionDiscountRef[] = [];
  const raw = (sub as unknown as { discounts?: Array<string | Stripe.Discount> }).discounts ?? [];
  for (const d of raw) {
    if (typeof d === "string") refs.push({ discountId: d, couponId: null });
    else refs.push({ discountId: d.id, couponId: d.coupon?.id ?? null });
  }
  // The legacy single `discount` (set via the deprecated `coupon` param) may not
  // appear in `discounts` on the pinned API version.
  const legacy = sub.discount as Stripe.Discount | null;
  if (legacy && !refs.some(r => r.discountId === legacy.id)) {
    refs.unshift({ discountId: legacy.id, couponId: legacy.coupon?.id ?? null });
  }
  return refs;
}

/** Invoice label for a code's coupon: "Invited by Sunset Rentals: 20% off", "LAUNCH50: 50% off". */
function codeCouponName(code: PromoCodeRow, ownerName: string | null): string {
  const off = discountText(code.discount_type, code.discount_value, code.currency);
  const name = code.kind === "referral"
    ? `Invited by ${ownerName ?? code.code}: ${off}`
    : `${code.code}: ${off}`;
  return name.slice(0, 40); // Stripe's coupon name limit
}

/**
 * The Stripe coupon behind a code for one checkout, minted the first time it is
 * needed on this account / mode / product / trial variant.
 *
 * On a checkout that starts with a free trial, a repeating (or once) coupon is
 * stretched by the trial so "3 months" is 3 REAL bills (brief §7.4).
 */
export async function ensureCodeCoupon(
  supabase: any,
  stripe: Stripe,
  code: PromoCodeRow,
  ctx: { account: SubscriptionAccount; mode: StripeMode; productId: string; trialDays: number },
): Promise<{ couponId: string; variant: string }> {
  const stretches = code.duration !== "forever" && ctx.trialDays > 0;
  const variant = stretches ? promoVariant(ctx.trialDays) : "standard";

  const { data: existing, error: readError } = await supabase
    .from("platform_promo_code_stripe")
    .select("stripe_coupon_id, variant")
    .eq("promo_code_id", code.id)
    .eq("stripe_account", ctx.account)
    .eq("stripe_mode", ctx.mode)
    .eq("variant", variant)
    .eq("stripe_product_id", ctx.productId)
    .maybeSingle();
  if (readError) throw new Error(`Promo coupon lookup failed: ${readError.message}`);
  if (existing) return { couponId: existing.stripe_coupon_id, variant };

  let ownerName: string | null = null;
  if (code.owner_tenant_id) {
    const { data: owner } = await supabase.from("tenants").select("company_name").eq("id", code.owner_tenant_id).maybeSingle();
    ownerName = owner?.company_name ?? null;
  }

  const months = code.duration === "once" ? 1 : (code.duration_months ?? 1);
  const duration: Stripe.CouponCreateParams.Duration = stretches ? "repeating" : code.duration;
  const params: Stripe.CouponCreateParams = {
    ...(code.discount_type === "percent"
      ? { percent_off: code.discount_value }
      : { amount_off: Math.round(code.discount_value * 100), currency: (code.currency || "usd").toLowerCase() }),
    duration,
    ...(duration === "repeating"
      ? { duration_in_months: stretches ? deferredCouponMonths(months, ctx.trialDays) : months }
      : {}),
    applies_to: { products: [ctx.productId] },
    name: codeCouponName(code, ownerName),
    metadata: {
      d247_promo_code_id: code.id,
      d247_code: code.code,
      d247_kind: code.kind,
      d247_owner_tenant_id: code.owner_tenant_id ?? "",
      d247_variant: variant,
    },
  };
  // The idempotency key makes a retried or raced mint return the same coupon.
  const coupon = await stripe.coupons.create(params, {
    idempotencyKey: `d247-pc-${code.id}-${ctx.account}-${ctx.mode}-${variant}-${ctx.productId}`,
  });

  const { error: insertError } = await supabase.from("platform_promo_code_stripe").insert({
    promo_code_id: code.id,
    stripe_account: ctx.account,
    stripe_mode: ctx.mode,
    variant,
    stripe_product_id: ctx.productId,
    stripe_coupon_id: coupon.id,
  });
  if (insertError && (insertError as { code?: string }).code !== "23505") {
    throw new Error(`Could not record the promo coupon: ${insertError.message}`);
  }
  if (insertError) {
    // Lost a race to a concurrent checkout: use the winner's coupon.
    const { data: winner } = await supabase
      .from("platform_promo_code_stripe")
      .select("stripe_coupon_id")
      .eq("promo_code_id", code.id).eq("stripe_account", ctx.account).eq("stripe_mode", ctx.mode)
      .eq("variant", variant).eq("stripe_product_id", ctx.productId)
      .single();
    return { couponId: winner.stripe_coupon_id, variant };
  }
  return { couponId: coupon.id, variant };
}

/** The standing tier-reward coupon for a tier value on one product (deterministic id). */
export async function ensureTierCoupon(
  stripe: Stripe,
  tier: Pick<ReferralTier, "discount_type" | "discount_value">,
  productId: string,
): Promise<string> {
  const id = tierCouponId(tier.discount_type, tier.discount_value, productId);
  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch (e) {
    if ((e as { code?: string })?.code !== "resource_missing") throw e;
  }
  try {
    await stripe.coupons.create({
      id,
      ...(tier.discount_type === "percent"
        ? { percent_off: tier.discount_value }
        : { amount_off: Math.round(tier.discount_value * 100), currency: "usd" }),
      duration: "forever",
      applies_to: { products: [productId] },
      name: `Referral reward: ${discountText(tier.discount_type, tier.discount_value)}`.slice(0, 40),
      metadata: { d247_kind: "referral_tier" },
    });
  } catch (e) {
    // A concurrent run created it first — the id is deterministic, so fine.
    if ((e as { code?: string })?.code !== "resource_already_exists") throw e;
  }
  return id;
}

/**
 * Make one live subscription carry exactly the tier reward it should — or none —
 * touching no other discount. Makes no Stripe write when it already matches.
 *
 * No idempotency key on the update, deliberately: any key derived from the
 * state collides when a referrer returns to an earlier state (10% -> none ->
 * 10% in one hour), and Stripe then replays the first response and applies
 * nothing. The update is safe to repeat instead: it replaces the whole list,
 * computed from a fresh read on every run.
 */
export async function reconcileTierOnSubscription(
  stripe: Stripe,
  subscriptionId: string,
  desired: Pick<ReferralTier, "discount_type" | "discount_value"> | null,
): Promise<{ changed: boolean; couponId: string | null }> {
  // Items carry their full price already; `items.data.price` is not an
  // expandable path, and asking for it fails the whole request.
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
  let desiredCouponId: string | null = null;
  if (desired) {
    const productId = planProductOfSubscription(sub);
    if (!productId) throw new Error(`Subscription ${subscriptionId} has no plan item to discount`);
    desiredCouponId = await ensureTierCoupon(stripe, desired, productId);
  }
  const plan = planTierDiscounts(discountRefsOf(sub), desiredCouponId);
  if (plan.changed) {
    await stripe.subscriptions.update(
      subscriptionId,
      // An empty list must be sent as "": the SDK's form encoding drops an
      // empty array, which would leave the tier discount in place.
      { discounts: plan.discounts.length > 0 ? plan.discounts : "" } as Stripe.SubscriptionUpdateParams,
    );
  }
  return { changed: plan.changed, couponId: desiredCouponId };
}

// ──────────────────────────────────────────── redemptions and referrals ──

/** The terms as redeemed, frozen onto the redemption row. */
export function discountSnapshot(code: PromoCodeRow): Record<string, unknown> {
  return {
    code: code.code,
    kind: code.kind,
    discount_type: code.discount_type,
    discount_value: code.discount_value,
    currency: code.currency,
    duration: code.duration,
    duration_months: code.duration_months,
  };
}

/**
 * Record that a code was used on a new subscription, and — for a referral code
 * — attribute the referral. Idempotent: the checkout's own success path and
 * the engine's discovery pass may both call this for the same subscription.
 */
export async function recordRedemption(
  supabase: any,
  args: {
    code: PromoCodeRow;
    tenantId: string;
    subscriptionId: string;
    account: SubscriptionAccount;
    mode: StripeMode;
    discountEndsAt: string | null;
    source: "self_serve_checkout" | "payment_link";
    redeemedAt?: string;
  },
): Promise<{ redemptionId: string; referralId: string | null }> {
  const { code, tenantId } = args;
  const { error: insertError } = await supabase.from("promo_code_redemptions").insert({
    promo_code_id: code.id,
    tenant_id: tenantId,
    stripe_subscription_id: args.subscriptionId,
    stripe_account: args.account,
    stripe_mode: args.mode,
    discount_snapshot: discountSnapshot(code),
    discount_ends_at: args.discountEndsAt,
    redeemed_at: args.redeemedAt ?? new Date().toISOString(),
  });
  if (insertError && (insertError as { code?: string }).code !== "23505") {
    throw new Error(`Could not record the redemption: ${insertError.message}`);
  }
  const { data: redemption } = await supabase
    .from("promo_code_redemptions")
    .select("id")
    .eq("promo_code_id", code.id)
    .eq("tenant_id", tenantId)
    .single();

  if (!insertError) {
    await logReferralEvent(supabase, { tenantId, eventType: "redeemed", payload: { code: code.code, kind: code.kind, subscription: args.subscriptionId } });
  }

  if (code.kind !== "referral" || !code.owner_tenant_id || code.owner_tenant_id === tenantId) {
    return { redemptionId: redemption.id, referralId: null };
  }

  const referralId = await attachReferral(supabase, {
    referrerTenantId: code.owner_tenant_id,
    referredTenantId: tenantId,
    promoCodeId: code.id,
    redemptionId: redemption.id,
    source: args.source,
    refereeDiscountApplied: true,
  });
  return { redemptionId: redemption.id, referralId };
}

/**
 * Create the live referral between two operators, with name snapshots (the
 * portal cannot read another tenant's row). Returns the existing live referral
 * when the referee already has one — one live referral per referee.
 */
export async function attachReferral(
  supabase: any,
  args: {
    referrerTenantId: string;
    referredTenantId: string;
    promoCodeId: string | null;
    redemptionId: string | null;
    source: "self_serve_checkout" | "payment_link" | "manual";
    refereeDiscountApplied: boolean;
    createdBy?: string | null;
    note?: string | null;
  },
): Promise<string | null> {
  if (args.referrerTenantId === args.referredTenantId) return null;
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, company_name, slug")
    .in("id", [args.referrerTenantId, args.referredTenantId]);
  const nameOf = (id: string) => {
    const t = ((tenants ?? []) as Array<{ id: string; company_name: string | null; slug: string }>).find(x => x.id === id);
    return t?.company_name || t?.slug || "Unknown operator";
  };

  const { data: inserted, error } = await supabase
    .from("referrals")
    .insert({
      referrer_tenant_id: args.referrerTenantId,
      referred_tenant_id: args.referredTenantId,
      referrer_name_snapshot: nameOf(args.referrerTenantId),
      referred_name_snapshot: nameOf(args.referredTenantId),
      promo_code_id: args.promoCodeId,
      redemption_id: args.redemptionId,
      source: args.source,
      referee_discount_applied: args.refereeDiscountApplied,
      created_by: args.createdBy ?? null,
      note: args.note ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code !== "23505") throw new Error(`Could not record the referral: ${error.message}`);
    const { data: live } = await supabase
      .from("referrals")
      .select("id")
      .eq("referred_tenant_id", args.referredTenantId)
      .eq("status", "active")
      .maybeSingle();
    return live?.id ?? null;
  }

  await logReferralEvent(supabase, {
    tenantId: args.referrerTenantId,
    referralId: inserted.id,
    eventType: "referral_attached",
    payload: { referred_tenant_id: args.referredTenantId, source: args.source },
    actor: args.createdBy ?? null,
  });
  return inserted.id;
}

export async function logReferralEvent(
  supabase: any,
  e: { tenantId?: string | null; referralId?: string | null; eventType: string; payload?: Record<string, unknown>; actor?: string | null },
): Promise<void> {
  const { error } = await supabase.from("referral_events").insert({
    tenant_id: e.tenantId ?? null,
    referral_id: e.referralId ?? null,
    event_type: e.eventType,
    payload: e.payload ?? {},
    actor_app_user_id: e.actor ?? null,
  });
  if (error) console.error("[platform-promo] referral event not recorded:", error.message);
}

// ─────────────────────────────────────────────────── operators' own codes ──

/** A fresh, unused {BRAND}-{DIGITS} code for an operator. */
export async function generateReferralCode(
  supabase: any,
  tenant: { id: string; company_name: string | null; slug: string },
  digits: number,
  brandOverride?: string | null,
): Promise<string> {
  const brand = brandOverride || brandPrefixFrom(tenant.company_name, tenant.slug);
  for (let attempt = 0; attempt < 30; attempt++) {
    // After a run of collisions, widen the number rather than loop forever.
    const width = attempt < 20 ? digits : 6;
    const candidate = referralCodeCandidate(brand, width);
    const { data, error } = await supabase
      .from("platform_promo_codes")
      .select("id")
      .eq("code", candidate)
      .eq("status", "active")
      .limit(1);
    if (error) throw new Error(`Code uniqueness check failed: ${error.message}`);
    if ((data ?? []).length === 0) return candidate;
  }
  throw new Error(`Could not find a free referral code for ${brand}`);
}

/**
 * The operator's active referral code, creating it (and their settings row)
 * when they have none. New codes carry the platform default referee discount.
 */
export async function ensureReferralCode(
  supabase: any,
  tenant: { id: string; company_name: string | null; slug: string },
  settings: ProgramSettings,
  actor?: string | null,
): Promise<PromoCodeRow> {
  const { data: current, error } = await supabase
    .from("platform_promo_codes")
    .select(PROMO_CODE_COLUMNS)
    .eq("owner_tenant_id", tenant.id)
    .eq("kind", "referral")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Referral code lookup failed: ${error.message}`);
  if (current) return toCodeRow(current);

  await supabase.from("tenant_referral_settings").upsert({ tenant_id: tenant.id }, { onConflict: "tenant_id", ignoreDuplicates: true });
  const { data: prefs } = await supabase
    .from("tenant_referral_settings")
    .select("brand_prefix")
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await generateReferralCode(supabase, tenant, settings.code_suffix_length, prefs?.brand_prefix ?? null);
    const { data: created, error: insertError } = await supabase
      .from("platform_promo_codes")
      .insert({
        code,
        kind: "referral",
        owner_tenant_id: tenant.id,
        discount_type: settings.default_referee_discount_type,
        discount_value: settings.default_referee_discount_value,
        duration: settings.default_referee_duration,
        duration_months: settings.default_referee_duration === "repeating" ? settings.default_referee_duration_months : null,
        created_by: actor ?? null,
      })
      .select(PROMO_CODE_COLUMNS)
      .single();
    if (!insertError) {
      await logReferralEvent(supabase, { tenantId: tenant.id, eventType: "code_created", payload: { code }, actor });
      return toCodeRow(created);
    }
    if ((insertError as { code?: string }).code !== "23505") throw new Error(`Could not create a referral code: ${insertError.message}`);
    // 23505: either the code string was taken a moment ago (retry with a new
    // number) or this operator got a code from a concurrent run (return it).
    const { data: raced } = await supabase
      .from("platform_promo_codes")
      .select(PROMO_CODE_COLUMNS)
      .eq("owner_tenant_id", tenant.id).eq("kind", "referral").eq("status", "active")
      .maybeSingle();
    if (raced) return toCodeRow(raced);
  }
  throw new Error(`Could not create a referral code for ${tenant.slug}`);
}

/**
 * Change a code's terms. Stripe coupons are immutable, so the old version is
 * superseded and a new one takes the same code string; operators who already
 * redeemed keep the terms they got.
 */
export async function rotateCode(
  supabase: any,
  old: PromoCodeRow,
  terms: Partial<Pick<PromoCodeRow, "code" | "discount_type" | "discount_value" | "duration" | "duration_months" | "max_redemptions" | "expires_at" | "restrict_signup_plan_keys" | "note">>,
  actor?: string | null,
): Promise<PromoCodeRow> {
  const { data: stepped, error: stepError } = await supabase
    .from("platform_promo_codes")
    .update({ status: "superseded" })
    .eq("id", old.id)
    .eq("status", "active")
    .select("id");
  if (stepError) throw new Error(`Could not retire the old code: ${stepError.message}`);
  if ((stepped ?? []).length === 0) throw new Error("This code changed while you were editing it — reload and try again.");

  const next = {
    code: terms.code ?? old.code,
    kind: old.kind,
    owner_tenant_id: old.owner_tenant_id,
    discount_type: terms.discount_type ?? old.discount_type,
    discount_value: terms.discount_value ?? old.discount_value,
    currency: old.currency,
    duration: terms.duration ?? old.duration,
    duration_months: (terms.duration ?? old.duration) === "repeating"
      ? (terms.duration_months ?? old.duration_months ?? 1)
      : null,
    max_redemptions: terms.max_redemptions !== undefined ? terms.max_redemptions : old.max_redemptions,
    expires_at: terms.expires_at !== undefined ? terms.expires_at : old.expires_at,
    restrict_signup_plan_keys: terms.restrict_signup_plan_keys !== undefined ? terms.restrict_signup_plan_keys : old.restrict_signup_plan_keys,
    note: terms.note !== undefined ? terms.note : old.note,
    created_by: actor ?? null,
  };
  const { data: created, error: insertError } = await supabase
    .from("platform_promo_codes")
    .insert(next)
    .select(PROMO_CODE_COLUMNS)
    .single();
  if (insertError) {
    // Put the old version back rather than leave the operator with no code.
    await supabase.from("platform_promo_codes").update({ status: "active" }).eq("id", old.id).eq("status", "superseded");
    throw new Error(insertError.code === "23505" ? "That code is already in use." : `Could not save the new terms: ${insertError.message}`);
  }
  await supabase.from("platform_promo_codes").update({ superseded_by: created.id }).eq("id", old.id);
  await logReferralEvent(supabase, {
    tenantId: old.owner_tenant_id,
    eventType: "code_rotated",
    payload: { from: old.id, to: created.id, code: created.code },
    actor,
  });
  return toCodeRow(created);
}

// ────────────────────────────────────────────── a referrer's tier state ──

/**
 * How many of an operator's referrals count right now (the referee's
 * subscription is live — brief R1), and the tier that earns.
 */
export async function computeReferrerStanding(supabase: any, tenantId: string): Promise<{
  activeReferrals: number;
  totalReferrals: number;
  tier: ReferralTier | null;
  tiers: ReferralTier[];
  customTiers: boolean;
}> {
  const { data: refs, error } = await supabase
    .from("referrals")
    .select("referred_tenant_id")
    .eq("referrer_tenant_id", tenantId)
    .eq("status", "active");
  if (error) throw new Error(`Referrals unavailable: ${error.message}`);
  const referees = ((refs ?? []) as Array<{ referred_tenant_id: string }>).map(r => r.referred_tenant_id);

  let activeReferrals = 0;
  if (referees.length > 0) {
    const { data: subs, error: subsError } = await supabase
      .from("tenant_subscriptions")
      .select("tenant_id, status")
      .in("tenant_id", referees)
      .in("status", LIVE_SUBSCRIPTION_STATUSES as string[]);
    if (subsError) throw new Error(`Referee subscriptions unavailable: ${subsError.message}`);
    activeReferrals = new Set(
      ((subs ?? []) as Array<{ tenant_id: string; status: string }>)
        .filter(s => isLiveSubscriptionStatus(s.status))
        .map(s => s.tenant_id),
    ).size;
  }

  const { tiers, custom } = await loadEffectiveTiers(supabase, tenantId);
  return {
    activeReferrals,
    totalReferrals: referees.length,
    tier: resolveTier(tiers, activeReferrals),
    tiers,
    customTiers: custom,
  };
}

/** The tenant's live subscription row, if any (the account on the row is the one billed). */
export async function liveSubscriptionOf(supabase: any, tenantId: string): Promise<{
  stripe_subscription_id: string; stripe_account: SubscriptionAccount; status: string; current_period_end: string | null;
} | null> {
  const { data, error } = await supabase
    .from("tenant_subscriptions")
    .select("stripe_subscription_id, stripe_account, status, current_period_end")
    .eq("tenant_id", tenantId)
    .in("status", LIVE_SUBSCRIPTION_STATUSES as string[])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Subscription lookup failed: ${error.message}`);
  if (!data) return null;
  return { ...data, stripe_account: data.stripe_account === "uae" ? "uae" : "uk" };
}

// ─────────────────────────────────────────────────────────────── email ──

/** Drive247's own plain email frame for platform-to-operator messages. */
export function platformEmailShell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
<p style="font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#6366f1;margin:0 0 18px">Drive247</p>
${inner}
</div>
<p style="font-size:12px;color:#94a3b8;text-align:center;margin:16px 0 0">Sent by Drive247 about your referral programme.</p>
</div></body></html>`;
}
