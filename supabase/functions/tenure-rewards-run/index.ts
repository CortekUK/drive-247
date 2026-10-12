// tenure-rewards-run — Tenure Loyalty Rewards for v2 tenants.
//
// pg_cron calls this once a day with the service-role bearer. For every v2
// tenant (portal_experience 'v2' or the northwind canary) it reads the tenure
// from `tenure_reward_tenants()` — the same function the admin tab shows — and
// grants each switched-on milestone the tenant has reached, exactly once.
//
//   once     tenure_reward_grants is UNIQUE (milestone_id, tenant_id) and the
//            row is claimed (status "processing") BEFORE the perk is applied,
//            so overlapping runs can never apply a perk twice
//   off      when tenure_reward_settings.enabled is false the cron run is a
//            no-op (the programme ships switched off)
//   skipped  a milestone the tenant had already passed when it was switched on
//            is logged as skipped unless the milestone says apply_to_existing
//   pending  a subscription perk with no live subscription to attach to waits
//            as "pending" and is retried on every run
//
// Super admins may also call it:
//   { action: "preview" }                     what a run would do, no writes
//   { action: "run" }                         a run now (programme must be on)
//   { action: "grant", tenantId, milestoneId } give one milestone by hand —
//                                             ignores skip / subscription rules
//   { action: "retry", grantId }              re-apply a pending/failed grant
//
// Subscription perks are one Stripe coupon each, attached by editing the
// subscription's `discounts` array (as apply-subscription-discount-v2 does), so
// referral / promo / one-time admin discounts stay. A new tenure PERCENT
// discount replaces an earlier tenure percent discount instead of stacking.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { discountRefsOf } from "../_shared/platform-promo.ts";
import { isTierCouponId } from "../_shared/platform-promo-rules.ts";

const KIND = "tenure_reward";
const MAX_APPLIED_PER_RUN = 50;

interface Settings {
  enabled: boolean;
  require_active_subscription: boolean;
  notify_tenants: boolean;
}

interface Milestone {
  id: string;
  months: number;
  label: string;
  perk_type: "free_period" | "percent_discount" | "credits" | "manual";
  free_months: number | null;
  percent: number | null;
  duration_months: number | null;
  credits: number | null;
  perk_description: string | null;
  enabled: boolean;
  apply_to_existing: boolean;
  active_since: string | null;
}

interface TenureRow {
  tenant_id: string;
  slug: string;
  company_name: string | null;
  started_at: string | null;
  tenure_months: number | null;
  subscription_status: string | null;
}

interface Grant {
  id: string;
  milestone_id: string | null;
  tenant_id: string;
  months: number;
  label: string;
  perk_type: Milestone["perk_type"];
  free_months: number | null;
  percent: number | null;
  duration_months: number | null;
  credits: number | null;
  perk_description: string | null;
  status: string;
}

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function perkText(p: Pick<Milestone, "perk_type" | "free_months" | "percent" | "duration_months" | "credits" | "perk_description">): string {
  switch (p.perk_type) {
    case "free_period":
      return p.free_months === 1 ? "1 free month" : `${p.free_months} free months`;
    case "percent_discount":
      return p.duration_months
        ? `${p.percent}% off for ${p.duration_months} month${p.duration_months === 1 ? "" : "s"}`
        : `${p.percent}% off your subscription, for good`;
    case "credits":
      return `${p.credits} platform credits`;
    default:
      return p.perk_description ?? "a thank-you perk";
  }
}

function snapshot(m: Milestone) {
  return {
    milestone_id: m.id,
    months: m.months,
    label: m.label,
    perk_type: m.perk_type,
    free_months: m.free_months,
    percent: m.percent,
    duration_months: m.duration_months,
    credits: m.credits,
    perk_description: m.perk_description,
  };
}

type Outcome = { status: string; detail: string | null; stripe_coupon_id?: string | null };

/** Apply one grant's perk. Never throws: a failure is an outcome. */
async function applyPerk(supabase: any, g: Grant): Promise<Outcome> {
  try {
    if (g.perk_type === "manual") {
      return { status: "manual_todo", detail: `To fulfil by hand: ${g.perk_description}` };
    }

    if (g.perk_type === "credits") {
      const { error } = await supabase.rpc("add_credits", {
        p_tenant_id: g.tenant_id,
        p_amount: g.credits,
        p_type: "gift",
        p_description: `Tenure reward — ${g.label}`,
        p_category: null,
        p_package_id: null,
        p_stripe_payment_id: null,
        p_performed_by: null,
        p_is_test_mode: false,
      });
      if (error) throw error;
      return { status: "applied", detail: `${g.credits} credits added to the wallet` };
    }

    // Subscription perks.
    const { data: subscription } = await supabase
      .from("tenant_subscriptions")
      .select("*")
      .eq("tenant_id", g.tenant_id)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();
    if (!subscription?.stripe_subscription_id) {
      return { status: "pending", detail: "Waiting for an active subscription to attach the discount to" };
    }

    const mode = await getSubscriptionStripeMode(supabase, g.tenant_id);
    const account = subscription.stripe_account === "uae"
      ? "uae"
      : subscription.stripe_account === "uk"
        ? "uk"
        : await getTenantSubscriptionAccount(supabase, g.tenant_id);
    const stripe = getSubscriptionStripeClientForAccount(account, mode);
    const subId = subscription.stripe_subscription_id;

    const isFree = g.perk_type === "free_period";
    const months = isFree ? g.free_months : g.duration_months;
    const coupon = await stripe.coupons.create({
      percent_off: isFree ? 100 : g.percent!,
      ...(months ? { duration: "repeating", duration_in_months: months } : { duration: "forever" }),
      max_redemptions: 1,
      name: `Tenure reward — ${perkText(g)}`.slice(0, 40),
      metadata: { d247_kind: KIND, d247_tenure_perk: g.perk_type, grant_id: g.id, tenant_id: g.tenant_id },
    } as never);

    try {
      const live = await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });
      const refs = discountRefsOf(live as never);
      // A new tenure percent discount supersedes an older one.
      const superseded = new Set<string>();
      if (!isFree) {
        for (const d of ((live as any).discounts ?? []) as any[]) {
          if (typeof d === "object" && d?.coupon?.metadata?.d247_kind === KIND && d.coupon.metadata.d247_tenure_perk === "percent_discount") {
            superseded.add(d.id);
          }
        }
      }
      const kept = refs.filter(r => !superseded.has(r.discountId));
      const others = kept.filter(r => !isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
      const tiers = kept.filter(r => isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
      await stripe.subscriptions.update(subId, {
        discounts: [...others, { coupon: coupon.id }, ...tiers],
      } as never);
      return {
        status: "applied",
        detail: superseded.size ? "Discount applied (replaced the earlier tenure discount)" : "Discount applied to the subscription",
        stripe_coupon_id: coupon.id,
      };
    } catch (attachErr) {
      try { await stripe.coupons.del(coupon.id); } catch { /* best effort */ }
      throw attachErr;
    }
  } catch (e) {
    const message = (e as { message?: string })?.message ?? String(e);
    console.error("tenure-rewards-run apply failed:", g.id, message);
    return { status: "failed", detail: message.slice(0, 500) };
  }
}

async function finish(supabase: any, g: Grant, outcome: Outcome, settings: Settings, grantedBy: string | null) {
  const applied = outcome.status === "applied" || outcome.status === "manual_todo";
  await supabase
    .from("tenure_reward_grants")
    .update({
      status: outcome.status,
      detail: outcome.detail,
      stripe_coupon_id: outcome.stripe_coupon_id ?? null,
      granted_at: applied ? new Date().toISOString() : null,
      granted_by: grantedBy,
    })
    .eq("id", g.id);

  if (applied && settings.notify_tenants) {
    const { error } = await supabase.from("notifications").insert({
      tenant_id: g.tenant_id,
      user_id: null,
      title: `${g.months} months with Drive247 🎉`,
      message: g.perk_type === "manual"
        ? `Thank you for being with us. As a thank-you you've earned ${perkText(g)} — our team will be in touch.`
        : `Thank you for being with us. As a thank-you you've earned ${perkText(g)}.`,
      type: "general",
      link: g.perk_type === "credits" ? "/credits" : "/subscription",
      metadata: { kind: "tenure_reward", grant_id: g.id, months: g.months },
    });
    if (error) console.error("tenure notification failed:", error.message);
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const isCron = bearer === serviceKey;
    let adminId: string | null = null;
    if (!isCron) {
      const { data: { user } } = await supabase.auth.getUser(bearer);
      if (!user) return errorResponse("Unauthorized", 401);
      const { data: admins } = await supabase.from("app_users").select("id, is_super_admin, is_active").eq("auth_user_id", user.id);
      const admin = (admins ?? []).find((u: any) => u.is_super_admin === true && u.is_active !== false);
      if (!admin) return errorResponse("Only super admins can run tenure rewards", 403);
      adminId = admin.id;
    }

    const body = await req.json().catch(() => ({}));
    // The cron sends no action (= run); a super admin defaults to a preview.
    const action: string = body?.action ?? (isCron ? "run" : "preview");

    const { data: settings, error: sErr } = await supabase.from("tenure_reward_settings").select("*").eq("id", 1).single();
    if (sErr) throw sErr;

    // ── retry one grant ───────────────────────────────────────────────────
    if (action === "retry") {
      const { data: g } = await supabase.from("tenure_reward_grants").select("*").eq("id", body.grantId).maybeSingle();
      if (!g) return errorResponse("Grant not found", 404);
      if (!["pending", "failed"].includes(g.status)) return errorResponse("Only a pending or failed grant can be retried", 409);
      const outcome = await applyPerk(supabase, g);
      await finish(supabase, g, outcome, settings, adminId);
      return jsonResponse({ success: outcome.status !== "failed", outcome });
    }

    // ── grant one by hand ─────────────────────────────────────────────────
    if (action === "grant") {
      const { tenantId, milestoneId } = body ?? {};
      if (!tenantId || !milestoneId) return errorResponse("tenantId and milestoneId are required");
      const { data: m } = await supabase.from("tenure_milestones").select("*").eq("id", milestoneId).maybeSingle();
      if (!m) return errorResponse("Milestone not found", 404);
      const { data: existing } = await supabase.from("tenure_reward_grants").select("*")
        .eq("milestone_id", milestoneId).eq("tenant_id", tenantId).maybeSingle();
      let g: Grant;
      if (existing) {
        if (existing.status !== "skipped") return errorResponse(`Already ${existing.status.replace("_", " ")} for this tenant`, 409);
        // Re-claim the skipped row atomically.
        const { data, error } = await supabase.from("tenure_reward_grants")
          .update({ ...snapshot(m), status: "processing", detail: null })
          .eq("id", existing.id).eq("status", "skipped").select("*").maybeSingle();
        if (error) throw error;
        if (!data) return errorResponse("Someone else just granted it", 409);
        g = data;
      } else {
        const { data, error } = await supabase.from("tenure_reward_grants")
          .insert({ ...snapshot(m), tenant_id: tenantId, status: "processing", reached_at: null })
          .select("*").single();
        if (error) return errorResponse(error.code === "23505" ? "Already granted" : error.message, 409);
        g = data;
      }
      const outcome = await applyPerk(supabase, g);
      await finish(supabase, g, outcome, settings, adminId);
      return jsonResponse({ success: outcome.status !== "failed", outcome });
    }

    if (action !== "run" && action !== "preview") return errorResponse("Unknown action");
    const dry = action === "preview";

    if (!dry && !settings.enabled) {
      return jsonResponse({ success: true, skipped: "Programme is switched off", applied: 0 });
    }

    const [{ data: tenants, error: tErr }, { data: milestones, error: mErr }, { data: grants, error: gErr }] = await Promise.all([
      supabase.rpc("tenure_reward_tenants"),
      supabase.from("tenure_milestones").select("*").eq("enabled", true).order("months"),
      supabase.from("tenure_reward_grants").select("*"),
    ]);
    if (tErr) throw tErr;
    if (mErr) throw mErr;
    if (gErr) throw gErr;

    const have = new Map<string, Grant>();
    for (const g of (grants ?? []) as Grant[]) if (g.milestone_id) have.set(`${g.milestone_id}|${g.tenant_id}`, g);

    const plan: Array<{ tenant: string; slug: string; milestone: string; months: number; action: string; reason?: string }> = [];
    const summary = { applied: 0, pending: 0, failed: 0, skipped: 0, manual: 0, waiting: 0, retried: 0 };
    const now = Date.now();

    // Pending grants first: their subscription may have come back.
    for (const g of (grants ?? []) as Grant[]) {
      if (g.status !== "pending") continue;
      const t = (tenants as TenureRow[]).find((x) => x.tenant_id === g.tenant_id);
      if (!t?.subscription_status) continue;
      plan.push({ tenant: t.company_name ?? t.slug, slug: t.slug, milestone: g.label, months: g.months, action: "retry" });
      if (dry) continue;
      const outcome = await applyPerk(supabase, g);
      await finish(supabase, g, outcome, settings, null);
      summary.retried++;
      if (outcome.status === "applied") summary.applied++;
    }

    let budget = MAX_APPLIED_PER_RUN;
    for (const t of (tenants ?? []) as TenureRow[]) {
      if (t.tenure_months == null || !t.started_at) continue;
      for (const m of (milestones ?? []) as Milestone[]) {
        if (m.months > t.tenure_months) continue;
        if (have.has(`${m.id}|${t.tenant_id}`)) continue;
        const reachedAt = addMonths(t.started_at, m.months);
        if (reachedAt.getTime() > now) continue;
        const name = t.company_name ?? t.slug;

        const alreadyPast = !m.apply_to_existing && m.active_since && reachedAt.getTime() < new Date(m.active_since).getTime();
        if (alreadyPast) {
          plan.push({ tenant: name, slug: t.slug, milestone: m.label, months: m.months, action: "skip", reason: "Already past it when the milestone was switched on" });
          summary.skipped++;
          if (!dry) {
            await supabase.from("tenure_reward_grants").insert({
              ...snapshot(m),
              tenant_id: t.tenant_id,
              status: "skipped",
              detail: "Already past this milestone when it was switched on",
              reached_at: reachedAt.toISOString(),
            });
          }
          continue;
        }

        if (settings.require_active_subscription && !t.subscription_status) {
          plan.push({ tenant: name, slug: t.slug, milestone: m.label, months: m.months, action: "wait", reason: "No active subscription" });
          summary.waiting++;
          continue;
        }

        if (budget <= 0) continue;
        plan.push({ tenant: name, slug: t.slug, milestone: m.label, months: m.months, action: "grant" });
        if (dry) continue;

        // Claim first; a concurrent run loses on the unique index.
        const { data: g, error: claimErr } = await supabase.from("tenure_reward_grants")
          .insert({ ...snapshot(m), tenant_id: t.tenant_id, status: "processing", reached_at: reachedAt.toISOString() })
          .select("*").single();
        if (claimErr) {
          if (claimErr.code !== "23505") console.error("claim failed:", claimErr.message);
          continue;
        }
        budget--;
        const outcome = await applyPerk(supabase, g);
        await finish(supabase, g, outcome, settings, null);
        if (outcome.status === "applied") summary.applied++;
        else if (outcome.status === "pending") summary.pending++;
        else if (outcome.status === "manual_todo") summary.manual++;
        else if (outcome.status === "failed") summary.failed++;
      }
    }

    if (!dry) {
      await supabase.from("tenure_reward_settings").update({
        last_run_at: new Date().toISOString(),
        last_run_summary: summary,
      }).eq("id", 1);
    }

    return jsonResponse({ success: true, dry, summary, plan });
  } catch (error) {
    console.error("tenure-rewards-run error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
