// accept-retention-offer — the tenant's "Accept N% off" in the v2 cancel flow.
//
// The offer itself is set by a super admin (Customer management → Tiered
// retention offers): a default for everyone, or a per-tenant override. This
// function, called by the tenant's own portal user:
//
//   1. resolves the tenant's offer (override, else default)
//   2. records the redemption — tenant_retention_redemptions has tenant_id as
//      its primary key, so a tenant gets ONE offer, ever. A second accept, even
//      after the first has run out, is refused here, not just hidden in the UI.
//   3. attaches a Stripe coupon (percent off, repeating for N months) to the
//      live subscription. Stripe stops it by itself after N months — nothing on
//      our side has to remember to take it off.
//   4. files the request in the platform queue (go_live_requests), so the team
//      sees it in /admin/requests and the Cancellations report counts a save.
//      Approved when Stripe took the coupon; pending (with a "please apply it")
//      when it did not, so a person finishes the job.
//
// Every other discount on the subscription is kept; a referral tier reward
// stays last, exactly as apply-subscription-discount-v2 does.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";
import { discountRefsOf } from "../_shared/platform-promo.ts";
import { isTierCouponId } from "../_shared/platform-promo-rules.ts";

const CANCELLATION_TYPE = "subscription_cancellation";
const RETENTION_KIND = "retention";
/** Roles that may act on billing from the portal. Viewers and ops may not. */
const BILLING_ROLES = new Set(["head_admin", "admin", "manager"]);

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
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

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, role, is_active")
      .eq("auth_user_id", user.id)
      .not("tenant_id", "is", null)
      .maybeSingle();
    if (!appUser || appUser.is_active === false) return errorResponse("Unauthorized", 401);
    if (!BILLING_ROLES.has(appUser.role)) {
      return errorResponse("Only an admin of this account can accept the offer", 403);
    }
    const tenantId: string = appUser.tenant_id;

    const body = await req.json().catch(() => ({}));
    const monthlyCents = Number.isFinite(Number(body?.monthlyCents)) ? Math.round(Number(body.monthlyCents)) : null;

    // ── 1. The offer ────────────────────────────────────────────────────────
    const [{ data: settings }, { data: override }] = await Promise.all([
      supabase.from("retention_offer_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("tenant_retention_offers").select("*").eq("tenant_id", tenantId).maybeSingle(),
    ]);
    if (settings && settings.enabled === false) return errorResponse("Retention offers are not available right now", 409);
    const percent: number = override?.percent ?? settings?.default_percent ?? 10;
    const months: number = override?.months ?? settings?.default_months ?? 1;

    // ── 2. One per tenant, ever ─────────────────────────────────────────────
    const { error: claimError } = await supabase.from("tenant_retention_redemptions").insert({
      tenant_id: tenantId,
      percent,
      months,
      source: override ? "tenant" : "default",
      accepted_by: appUser.id,
    });
    if (claimError) {
      if ((claimError as { code?: string }).code === "23505") {
        return errorResponse("This account has already used its one-time offer", 409);
      }
      throw claimError;
    }

    // ── 3. Stripe ───────────────────────────────────────────────────────────
    let stripeStatus: "applied" | "failed" | "no_subscription" = "no_subscription";
    let stripeError: string | null = null;
    let couponId: string | null = null;
    let endsAt: string | null = null;
    let currency = "usd";

    const { data: subscription } = await supabase
      .from("tenant_subscriptions")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (subscription?.stripe_subscription_id) {
      currency = (subscription.currency || "usd").toLowerCase();
      try {
        const mode = await getSubscriptionStripeMode(supabase, tenantId);
        const account = subscription.stripe_account === "uae"
          ? "uae"
          : subscription.stripe_account === "uk"
            ? "uk"
            : await getTenantSubscriptionAccount(supabase, tenantId);
        const stripe = getSubscriptionStripeClientForAccount(account, mode);
        const subId = subscription.stripe_subscription_id;

        const coupon = await stripe.coupons.create(
          {
            percent_off: percent,
            duration: "repeating",
            duration_in_months: months,
            max_redemptions: 1,
            name: `Loyalty ${percent}% off for ${months} month${months === 1 ? "" : "s"}`,
            metadata: { d247_kind: RETENTION_KIND, d247_tenant_id: tenantId },
          },
        );
        couponId = coupon.id;
        try {
          const sub = await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });
          const refs = discountRefsOf(sub as never).filter(r => r.couponId !== coupon.id);
          const others = refs.filter(r => !isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
          const tiers = refs.filter(r => isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
          const updated = await stripe.subscriptions.update(
            subId,
            { discounts: [...others, { coupon: coupon.id }, ...tiers], expand: ["discounts"] } as never,
          );
          const mine = ((updated as any).discounts ?? []).find((d: any) => typeof d === "object" && d?.coupon?.id === coupon.id);
          endsAt = mine?.end ? new Date(mine.end * 1000).toISOString() : null;
          stripeStatus = "applied";
        } catch (attachErr) {
          try { await stripe.coupons.del(coupon.id); } catch { /* best effort */ }
          couponId = null;
          throw attachErr;
        }
      } catch (e) {
        stripeStatus = "failed";
        stripeError = (e as { message?: string })?.message ?? String(e);
        console.error("accept-retention-offer: Stripe failed for", tenantId, stripeError);
      }
    }

    if (!endsAt) {
      const end = new Date();
      end.setMonth(end.getMonth() + months);
      endsAt = end.toISOString();
    }

    // ── 4. The request the team sees ────────────────────────────────────────
    const priceNote = monthlyCents != null && monthlyCents > 0
      ? ` (${money(monthlyCents, currency)} → ${money(Math.round(monthlyCents * (1 - percent / 100)), currency)}/month)`
      : "";
    const tail = stripeStatus === "applied"
      ? " Applied automatically in Stripe."
      : stripeStatus === "failed"
        ? ` Stripe could not apply it (${stripeError}). Please apply it.`
        : " No live Stripe subscription found. Please apply it.";
    const { data: request } = await supabase
      .from("go_live_requests")
      .insert({
        tenant_id: tenantId,
        requested_by: appUser.id,
        integration_type: CANCELLATION_TYPE,
        note: `RETENTION OFFER ACCEPTED — ${percent}% off the next ${months} bill${months === 1 ? "" : "s"}${priceNote}.${tail}`,
        status: stripeStatus === "applied" ? "approved" : "pending",
        reviewed_at: stripeStatus === "applied" ? new Date().toISOString() : null,
      })
      .select("id")
      .single();

    await supabase
      .from("tenant_retention_redemptions")
      .update({
        stripe_status: stripeStatus,
        stripe_error: stripeError,
        stripe_coupon_id: couponId,
        ends_at: endsAt,
        request_id: request?.id ?? null,
      })
      .eq("tenant_id", tenantId);

    return jsonResponse({
      success: true,
      percent,
      months,
      endsAt,
      stripeStatus,
      requestId: request?.id ?? null,
    });
  } catch (error) {
    console.error("accept-retention-offer error:", (error as { message?: string })?.message ?? error);
    return errorResponse((error as { message?: string })?.message || "Internal server error", 500);
  }
});
