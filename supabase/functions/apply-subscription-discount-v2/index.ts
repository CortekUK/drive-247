// apply-subscription-discount-v2 — super admin "Discount next invoice", safe
// alongside the referral programme.
//
// Same actions and response shape as `apply-subscription-discount` (the admin
// screen only swaps the function name). The difference is HOW the discount is
// attached. The original uses Stripe's deprecated `coupon` parameter, which
// REPLACES every discount on the subscription — it would silently wipe an
// operator's referral reward and their new-operator discount — and it errors
// outright once a subscription carries more than one discount. This version
// edits the `discounts` array instead:
//   apply   appends its own one-time coupon; every other discount is kept and a
//           referral tier reward stays last
//   remove  removes only its own one-time coupons
//   get     reports its own pending one-time discount, plus every discount on
//           the subscription for context
// The original is untouched (V2_PLAN §7: never change an existing function).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { discountRefsOf } from "../_shared/platform-promo.ts";
import { isTierCouponId } from "../_shared/platform-promo-rules.ts";

const ADMIN_ONCE = "admin_once";

/** Our one-time discount: tagged by this function, or made by the original (untagged "One-time …"). */
function isAdminOnce(coupon: any): boolean {
  if (!coupon) return false;
  if (coupon.metadata?.d247_kind === ADMIN_ONCE) return true;
  return coupon.duration === "once" && typeof coupon.name === "string" && coupon.name.startsWith("One-time ");
}

function summarizeCoupon(coupon: any) {
  if (!coupon) return null;
  return {
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off != null ? coupon.amount_off / 100 : null,
    currency: coupon.currency ?? null,
    duration: coupon.duration ?? null,
    name: coupon.name ?? null,
  };
}

/** Every discount object on a subscription (expanded), legacy single discount included. */
function allDiscounts(sub: any): any[] {
  const list = ((sub.discounts ?? []) as any[]).filter(d => typeof d === "object" && d);
  if (sub.discount && !list.some(d => d.id === sub.discount.id)) list.unshift(sub.discount);
  return list;
}

function describe(sub: any) {
  const discounts = allDiscounts(sub);
  const mine = discounts.find(d => isAdminOnce(d.coupon));
  return {
    discount: summarizeCoupon(mine?.coupon),
    discounts: discounts.map(d => ({
      ...summarizeCoupon(d.coupon),
      kind: isAdminOnce(d.coupon) ? "admin_once" : isTierCouponId(d.coupon?.id) ? "referral_reward" : d.coupon?.metadata?.d247_promo_code_id ? "promo_code" : "other",
      end: d.end ? new Date(d.end * 1000).toISOString() : null,
    })),
  };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);
    const { data: admins } = await supabase.from("app_users").select("is_super_admin, is_active").eq("auth_user_id", user.id);
    const isSuperAdmin = Array.isArray(admins) && admins.some((u: any) => u.is_super_admin === true && u.is_active !== false);
    if (!isSuperAdmin) return errorResponse("Only super admins can adjust subscription discounts", 403);

    const { tenantId, action, discountType, value } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");

    const { data: subscription } = await supabase
      .from("tenant_subscriptions")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();
    if (!subscription?.stripe_subscription_id) {
      return errorResponse("This tenant has no active subscription to discount", 404);
    }

    const mode = await getSubscriptionStripeMode(supabase, tenantId);
    const account = subscription.stripe_account === "uae"
      ? "uae"
      : subscription.stripe_account === "uk"
        ? "uk"
        : await getTenantSubscriptionAccount(supabase, tenantId);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);
    const subId = subscription.stripe_subscription_id;
    const load = () => stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });

    if (action === "get") {
      return jsonResponse(describe(await load()));
    }

    if (action === "remove") {
      const sub = await load();
      const refs = discountRefsOf(sub as never);
      const mine = new Set(allDiscounts(sub).filter(d => isAdminOnce(d.coupon)).map(d => d.id));
      if (mine.size > 0) {
        const keep = refs.filter(r => !mine.has(r.discountId)).map(r => ({ discount: r.discountId }));
        // "" clears the list: the SDK's form encoding drops an empty array, so
        // removing the only discount would otherwise change nothing.
        await stripe.subscriptions.update(subId, { discounts: keep.length > 0 ? keep : "" } as never);
      }
      return jsonResponse({ success: true, ...describe(await load()), discount: null });
    }

    if (action === "apply") {
      const type = discountType === "amount" ? "amount" : "percent";
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return errorResponse("A positive discount value is required");
      if (type === "percent" && num > 100) return errorResponse("Percentage cannot exceed 100");

      const cur = (subscription.currency || "usd").toLowerCase();
      const coupon = await stripe.coupons.create({
        ...(type === "percent" ? { percent_off: num } : { amount_off: Math.round(num * 100), currency: cur }),
        duration: "once",
        max_redemptions: 1,
        name: type === "percent" ? `One-time ${num}% off` : `One-time ${num} ${cur.toUpperCase()} off`,
        metadata: { d247_kind: ADMIN_ONCE },
      });

      try {
        const sub = await load();
        const refs = discountRefsOf(sub as never);
        // Replace any earlier pending one-time discount of ours (one at a time,
        // as before); keep everything else, with a referral reward last.
        const mine = new Set(allDiscounts(sub).filter(d => isAdminOnce(d.coupon)).map(d => d.id));
        const kept = refs.filter(r => !mine.has(r.discountId));
        const others = kept.filter(r => !isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
        const tiers = kept.filter(r => isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
        await stripe.subscriptions.update(subId, {
          discounts: [...others, { coupon: coupon.id }, ...tiers],
        } as never);
      } catch (attachErr) {
        try { await stripe.coupons.del(coupon.id); } catch { /* best effort */ }
        throw attachErr;
      }
      return jsonResponse({ success: true, ...describe(await load()) });
    }

    return errorResponse("Unknown action");
  } catch (error) {
    console.error("apply-subscription-discount-v2 error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
