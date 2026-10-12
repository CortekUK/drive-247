// creator-reward-review — super admin review of Creator Rewards submissions.
//
// Actions (body: { action, submissionId, ... }):
//   approve   { rewardType: "free_month" | "percent", percent?, message?, override? }
//             marks the submission approved and attaches the reward to the
//             tenant's Drive247 subscription as a one-time Stripe coupon.
//             Refused when it would break the monthly reward limits in
//             creator_reward_settings, unless `override` is true.
//             ALWAYS refused (no override) when the tenant already has an
//             approved submission: one reward per tenant, ever. A unique index
//             on (tenant_id) WHERE status = 'approved' backs this up.
//   reject    { message }  — required; shown to the operator verbatim.
//   apply     re-try attaching an approved reward whose reward_status is
//             pending (no active subscription at approval) or failed.
//   reopen    puts a rejected submission back to pending (a mistaken reject).
//
// Approve and reject also drop a notification in the tenant's bell, linking to
// /rewards. The submission row itself is on the realtime publication, so the
// operator's Rewards page updates at once either way.
//
// HOW THE REWARD IS ATTACHED: same as apply-subscription-discount-v2 — the
// subscription's `discounts` array is edited, never the deprecated `coupon`
// param, so a referral tier reward, a promo code or an admin one-time discount
// already on the subscription is kept. Each reward is its own coupon
// (duration "once", max_redemptions 1, tagged d247_kind=creator_reward), so it
// comes off the next invoice and then ends by itself. "Free month" is 100% off
// that next invoice.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { discountRefsOf } from "../_shared/platform-promo.ts";
import { isTierCouponId } from "../_shared/platform-promo-rules.ts";

const KIND = "creator_reward";

function monthStartUtc(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function rewardLabel(type: string, percent: number | null): string {
  return type === "free_month" ? "a free month" : `${percent}% off`;
}

/**
 * Attach the submission's reward to the tenant's live subscription.
 * Returns the fields to write back; never throws for a Stripe refusal.
 */
async function attachReward(supabase: any, sub: any) {
  const { data: subscription } = await supabase
    .from("tenant_subscriptions")
    .select("*")
    .eq("tenant_id", sub.tenant_id)
    .in("status", ["active", "trialing", "past_due"])
    .maybeSingle();
  if (!subscription?.stripe_subscription_id) {
    return {
      reward_status: "pending",
      reward_error: "No active subscription yet — apply it once the operator subscribes.",
    };
  }

  try {
    const mode = await getSubscriptionStripeMode(supabase, sub.tenant_id);
    const account = subscription.stripe_account === "uae"
      ? "uae"
      : subscription.stripe_account === "uk"
        ? "uk"
        : await getTenantSubscriptionAccount(supabase, sub.tenant_id);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);
    const subId = subscription.stripe_subscription_id;

    const percent = sub.reward_type === "free_month" ? 100 : sub.reward_percent;
    const coupon = await stripe.coupons.create({
      percent_off: percent,
      duration: "once",
      max_redemptions: 1,
      name: sub.reward_type === "free_month" ? "Creator reward — free month" : `Creator reward — ${percent}% off`,
      metadata: { d247_kind: KIND, submission_id: sub.id, tenant_id: sub.tenant_id },
    });

    try {
      const live = await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });
      const refs = discountRefsOf(live as never);
      const others = refs.filter(r => !isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
      const tiers = refs.filter(r => isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
      await stripe.subscriptions.update(subId, {
        discounts: [...others, { coupon: coupon.id }, ...tiers],
      } as never);
    } catch (attachErr) {
      try { await stripe.coupons.del(coupon.id); } catch { /* best effort */ }
      throw attachErr;
    }

    return {
      reward_status: "applied",
      reward_error: null,
      stripe_coupon_id: coupon.id,
      reward_applied_at: new Date().toISOString(),
    };
  } catch (e) {
    const message = (e as { message?: string })?.message ?? String(e);
    console.error("creator-reward-review attach failed:", message);
    return { reward_status: "failed", reward_error: message.slice(0, 500) };
  }
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
    const { data: admins } = await supabase
      .from("app_users")
      .select("id, is_super_admin, is_active")
      .eq("auth_user_id", user.id);
    const admin = (admins ?? []).find((u: any) => u.is_super_admin === true && u.is_active !== false);
    if (!admin) return errorResponse("Only super admins can review creator rewards", 403);

    const body = await req.json();
    const { action, submissionId } = body ?? {};
    if (!submissionId) return errorResponse("submissionId is required");

    const { data: sub, error: subErr } = await supabase
      .from("creator_reward_submissions")
      .select("*")
      .eq("id", submissionId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!sub) return errorResponse("Submission not found", 404);

    const notify = (title: string, message: string, kind: string) =>
      supabase.from("notifications").insert({
        tenant_id: sub.tenant_id,
        user_id: null,
        title,
        message,
        type: "general",
        link: "/rewards",
        metadata: { kind, submission_id: sub.id },
      }).then(({ error }: any) => error && console.error("notification insert failed:", error.message));

    // ── reject ────────────────────────────────────────────────────────────
    if (action === "reject") {
      const message = String(body.message ?? "").trim();
      if (!message) return errorResponse("A message for the operator is required when rejecting");
      if (message.length > 1000) return errorResponse("Message is too long (1000 characters max)");
      if (sub.status === "approved" && sub.reward_status === "applied") {
        return errorResponse("This reward is already on the operator's subscription and can't be rejected now", 409);
      }
      const { data, error } = await supabase
        .from("creator_reward_submissions")
        .update({
          status: "rejected",
          admin_message: message,
          reviewed_by: admin.id,
          reviewed_at: new Date().toISOString(),
          reward_type: null,
          reward_percent: null,
          reward_status: null,
          reward_error: null,
        })
        .eq("id", sub.id)
        .select("*")
        .single();
      if (error) throw error;
      await notify("Your creator video was not approved", message, "creator_reward_rejected");
      return jsonResponse({ success: true, submission: data });
    }

    // ── reopen ────────────────────────────────────────────────────────────
    if (action === "reopen") {
      if (sub.status !== "rejected") return errorResponse("Only a rejected submission can be reopened", 409);
      const { data, error } = await supabase
        .from("creator_reward_submissions")
        .update({ status: "pending", admin_message: null, reviewed_by: null, reviewed_at: null })
        .eq("id", sub.id)
        .select("*")
        .single();
      if (error) throw error;
      return jsonResponse({ success: true, submission: data });
    }

    // ── approve ───────────────────────────────────────────────────────────
    if (action === "approve") {
      if (sub.status === "approved") return errorResponse("Already approved", 409);
      const rewardType = body.rewardType === "free_month" ? "free_month" : "percent";
      const percent = rewardType === "percent" ? Math.round(Number(body.percent)) : null;
      if (rewardType === "percent" && (!Number.isFinite(percent) || percent! < 1 || percent! > 100)) {
        return errorResponse("Percent must be between 1 and 100");
      }
      const message = String(body.message ?? "").trim().slice(0, 1000) || null;

      // One reward per tenant, ever — not overridable.
      const { data: earlier } = await supabase
        .from("creator_reward_submissions")
        .select("id, reviewed_at")
        .eq("tenant_id", sub.tenant_id)
        .eq("status", "approved")
        .neq("id", sub.id)
        .limit(1)
        .maybeSingle();
      if (earlier) {
        return jsonResponse({
          success: false,
          limit: "once",
          error: "This operator has already been rewarded for another video. Creator rewards are one per operator.",
        }, 409);
      }

      if (!body.override) {
        const { data: cfg } = await supabase.from("creator_reward_settings").select("*").eq("id", 1).single();
        const since = monthStartUtc();
        const [{ count: tenantCount }, { count: globalCount }] = await Promise.all([
          supabase.from("creator_reward_submissions").select("id", { count: "exact", head: true })
            .eq("tenant_id", sub.tenant_id).eq("status", "approved").gte("reviewed_at", since),
          supabase.from("creator_reward_submissions").select("id", { count: "exact", head: true })
            .eq("status", "approved").gte("reviewed_at", since),
        ]);
        if ((tenantCount ?? 0) >= cfg.monthly_reward_limit_per_tenant) {
          return jsonResponse({
            success: false,
            limit: "tenant",
            error: `This operator already has ${tenantCount} reward(s) this month (limit ${cfg.monthly_reward_limit_per_tenant}).`,
          }, 409);
        }
        if ((globalCount ?? 0) >= cfg.monthly_reward_limit_global) {
          return jsonResponse({
            success: false,
            limit: "global",
            error: `${globalCount} rewards have been issued this month (platform limit ${cfg.monthly_reward_limit_global}).`,
          }, 409);
        }
      }

      // Mark approved FIRST: the one-reward-per-tenant index settles any race
      // here, before a Stripe coupon exists for the losing approval.
      const { data: claimed, error: claimErr } = await supabase
        .from("creator_reward_submissions")
        .update({
          status: "approved",
          admin_message: message,
          reviewed_by: admin.id,
          reviewed_at: new Date().toISOString(),
          reward_type: rewardType,
          reward_percent: percent,
          reward_status: "pending",
          reward_error: null,
        })
        .eq("id", sub.id)
        .neq("status", "approved")
        .select("*")
        .maybeSingle();
      if (claimErr) {
        if (claimErr.code === "23505") {
          return jsonResponse({
            success: false,
            limit: "once",
            error: "This operator has already been rewarded for another video. Creator rewards are one per operator.",
          }, 409);
        }
        throw claimErr;
      }
      if (!claimed) return errorResponse("Already approved", 409);

      const rewardFields = await attachReward(supabase, claimed);
      const { data, error } = await supabase
        .from("creator_reward_submissions")
        .update(rewardFields)
        .eq("id", sub.id)
        .select("*")
        .single();
      if (error) throw error;

      const reward = rewardLabel(rewardType, percent);
      await notify(
        "Your creator video was approved 🎉",
        message ?? (rewardFields.reward_status === "applied"
          ? `Thanks for spreading the word! You've earned ${reward} on your next Drive247 invoice.`
          : `Thanks for spreading the word! You've earned ${reward} — it will be applied to your next Drive247 invoice.`),
        "creator_reward_approved",
      );
      return jsonResponse({ success: true, submission: data });
    }

    // ── apply (retry) ─────────────────────────────────────────────────────
    if (action === "apply") {
      if (sub.status !== "approved") return errorResponse("Only an approved submission has a reward to apply", 409);
      if (sub.reward_status === "applied") return errorResponse("Already applied", 409);
      const rewardFields = await attachReward(supabase, sub);
      const { data, error } = await supabase
        .from("creator_reward_submissions")
        .update(rewardFields)
        .eq("id", sub.id)
        .select("*")
        .single();
      if (error) throw error;
      return jsonResponse({ success: rewardFields.reward_status === "applied", submission: data });
    }

    return errorResponse("Unknown action");
  } catch (error) {
    console.error("creator-reward-review error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
