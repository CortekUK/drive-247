// referral-engine — Drive247 referral programme. Cron every 15 minutes, and
// callable for one operator (after a checkout, a manual attach or void, and
// "Sync now" in super admin).
//
// The ONLY thing that changes Stripe discounts on existing subscriptions.
// Idempotent: a second run straight after the first changes nothing. It reads
// tenant_subscriptions — which both the subscription webhook and the hourly
// reconciler keep current — instead of hanging off the webhook, so a dropped
// Stripe event cannot lose a referral.
//
// Per run:
//   1. ensure codes   every eligible operator has a referral code; codes on the
//                     platform default terms follow a change to the default
//   2. discover       codes used on live subscriptions we have not looked at yet
//                     (the safety net behind the checkout's own recording)
//   3. recompute      each referrer's subscribed referrals -> tier (levels, never
//                     summed; a referral counts only while the referee is live)
//   4. reconcile      exactly one tier reward on the referrer's live subscription,
//                     every other discount left alone
//   5. savings        what the tier reward took off each paid invoice
//   6. notify         a tier change, in the portal and by email (deduplicated)
//
// Auth: the pg_cron job presents the service role key; a super admin may call
// it from the admin app. Body: { tenantId? } — one operator, or everyone.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { notifyOperatorsInApp } from "../_shared/notify-inapp.ts";
import { sendResendEmail } from "../_shared/resend-service.ts";
import { escapeHtml, portalBaseUrl } from "../_shared/subscription-link.ts";
import {
  computeReferrerStanding,
  discountRefsOf,
  ensureReferralCode,
  liveSubscriptionOf,
  loadProgramSettings,
  logReferralEvent,
  PROMO_CODE_COLUMNS,
  platformEmailShell,
  reconcileTierOnSubscription,
  recordRedemption,
  rotateCode,
  stripeFor,
  toCodeRow,
  type ProgramSettings,
  type StripeMode,
} from "../_shared/platform-promo.ts";
import {
  isTierCouponId,
  LIVE_SUBSCRIPTION_STATUSES,
  nextTier,
  tierRewardText,
  type ReferralTier,
} from "../_shared/platform-promo-rules.ts";

/** Test tenants are skipped, except these (keyed on SLUG, never id — V2_PLAN §2). */
const TEST_TENANT_ALLOWLIST: readonly string[] = ["northwind", "test"];

/** A full run holds the lease this long; long enough for ~60 operators. */
const LEASE_MS = 10 * 60 * 1000;

type Tenant = {
  id: string;
  slug: string;
  company_name: string | null;
  contact_email: string | null;
  status: string | null;
  tenant_type: string | null;
  subscription_stripe_mode: string | null;
};

const TENANT_COLUMNS = "id, slug, company_name, contact_email, status, tenant_type, subscription_stripe_mode";

function inScope(t: Tenant): boolean {
  if (t.tenant_type === "test") return TEST_TENANT_ALLOWLIST.includes(t.slug);
  return true;
}

function modeOf(t: Tenant): StripeMode {
  return t.subscription_stripe_mode === "live" ? "live" : "test";
}

const msg = (e: unknown) => (e as { message?: string })?.message ?? String(e);

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // ── who may run this ─────────────────────────────────────────────────────
  const bearer = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!bearer) return errorResponse("Missing authorization header", 401);
  if (bearer !== serviceKey) {
    const { data: { user }, error } = await supabase.auth.getUser(bearer);
    if (error || !user) return errorResponse("Unauthorized", 401);
    const { data: appUser } = await supabase
      .from("app_users").select("is_super_admin, is_active").eq("auth_user_id", user.id).maybeSingle();
    if (!appUser?.is_super_admin || appUser.is_active === false) return errorResponse("Forbidden: super admin only", 403);
  }

  const body = await req.json().catch(() => ({})) as { tenantId?: string };
  const onlyTenantId = typeof body.tenantId === "string" ? body.tenantId : null;
  const now = new Date();
  const report = {
    scope: onlyTenantId ? "tenant" : "all",
    codesCreated: 0, codesRotated: 0, subscriptionsScanned: 0, redemptionsFound: 0,
    referrersEvaluated: 0, tiersChanged: 0, stripeUpdates: 0, savingsRecorded: 0,
    errors: [] as string[],
  };

  // ── a full run claims the lease so two never overlap ────────────────────
  if (!onlyTenantId) {
    const { data: claimed } = await supabase
      .from("referral_program_settings")
      .update({ engine_lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
      .eq("id", true)
      .or(`engine_lease_until.is.null,engine_lease_until.lt.${now.toISOString()}`)
      .select("id");
    if (!claimed || claimed.length === 0) return jsonResponse({ ...report, skipped: "another run is in progress" });
  }

  try {
    const settings = await loadProgramSettings(supabase);

    let tenantQuery = supabase.from("tenants").select(TENANT_COLUMNS);
    if (onlyTenantId) tenantQuery = tenantQuery.eq("id", onlyTenantId);
    const { data: tenantRows, error: tenantError } = await tenantQuery;
    if (tenantError) throw new Error(`Tenants unavailable: ${tenantError.message}`);
    const tenants = ((tenantRows ?? []) as Tenant[]).filter(inScope);
    const byId = new Map(tenants.map(t => [t.id, t]));

    // ── 1. ensure codes ───────────────────────────────────────────────────
    if (settings.enabled) {
      const { data: liveRows } = await supabase
        .from("tenant_subscriptions")
        .select("tenant_id")
        .in("status", LIVE_SUBSCRIPTION_STATUSES as string[]);
      const subscribed = new Set(((liveRows ?? []) as Array<{ tenant_id: string }>).map(r => r.tenant_id));
      for (const t of tenants) {
        const eligible = t.status !== "suspended" &&
          (subscribed.has(t.id) || TEST_TENANT_ALLOWLIST.includes(t.slug));
        if (!eligible) continue;
        try {
          const before = report.codesCreated;
          const code = await ensureCodeForTenant(supabase, t, settings);
          if (code.created) report.codesCreated = before + 1;
          if (code.rotated) report.codesRotated++;
        } catch (e) {
          report.errors.push(`code ${t.slug}: ${msg(e)}`);
        }
      }
    }

    // ── 2. discover redemptions ──────────────────────────────────────────
    let subsQuery = supabase
      .from("tenant_subscriptions")
      .select("tenant_id, stripe_subscription_id, stripe_account, status, created_at")
      .in("status", LIVE_SUBSCRIPTION_STATUSES as string[]);
    if (onlyTenantId) subsQuery = subsQuery.eq("tenant_id", onlyTenantId);
    const { data: liveSubs } = await subsQuery;
    const subIds = ((liveSubs ?? []) as Array<{ stripe_subscription_id: string }>).map(s => s.stripe_subscription_id);
    const { data: scanned } = subIds.length
      ? await supabase.from("referral_subscription_scans").select("stripe_subscription_id").in("stripe_subscription_id", subIds)
      : { data: [] };
    const seen = new Set(((scanned ?? []) as Array<{ stripe_subscription_id: string }>).map(s => s.stripe_subscription_id));
    for (const row of (liveSubs ?? []) as Array<{ tenant_id: string; stripe_subscription_id: string; stripe_account: string; created_at: string }>) {
      if (seen.has(row.stripe_subscription_id)) continue;
      const t = byId.get(row.tenant_id);
      if (!t) continue;
      report.subscriptionsScanned++;
      try {
        const found = await discoverRedemption(supabase, t, row);
        if (found) report.redemptionsFound++;
      } catch (e) {
        report.errors.push(`scan ${row.stripe_subscription_id}: ${msg(e)}`);
      }
    }

    // ── 3–6. referrers ───────────────────────────────────────────────────
    let refQuery = supabase.from("referrals").select("referrer_tenant_id");
    if (onlyTenantId) refQuery = refQuery.eq("referrer_tenant_id", onlyTenantId);
    const { data: refRows } = await refQuery;
    let stateQuery = supabase.from("referral_tier_state").select("tenant_id");
    if (onlyTenantId) stateQuery = stateQuery.eq("tenant_id", onlyTenantId);
    const { data: stateRows } = await stateQuery;
    const referrerIds = new Set<string>([
      ...((refRows ?? []) as Array<{ referrer_tenant_id: string }>).map(r => r.referrer_tenant_id),
      ...((stateRows ?? []) as Array<{ tenant_id: string }>).map(r => r.tenant_id),
    ]);

    for (const referrerId of referrerIds) {
      const t = byId.get(referrerId);
      if (!t) continue;
      report.referrersEvaluated++;
      try {
        const out = await evaluateReferrer(supabase, t, now);
        if (out.tierChanged) report.tiersChanged++;
        if (out.stripeChanged) report.stripeUpdates++;
        report.savingsRecorded += await recordSavings(supabase, t);
      } catch (e) {
        report.errors.push(`referrer ${t.slug}: ${msg(e)}`);
        await supabase.from("referral_tier_state").upsert(
          { tenant_id: t.id, last_evaluated_at: now.toISOString(), last_error: msg(e).slice(0, 500) },
          { onConflict: "tenant_id" },
        );
      }
    }

    // ── housekeeping ─────────────────────────────────────────────────────
    if (!onlyTenantId) {
      await supabase.from("promo_code_lookup_attempts")
        .delete().lt("created_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
    }

    return jsonResponse(report);
  } catch (e) {
    console.error("[referral-engine] run failed:", msg(e));
    return jsonResponse({ ...report, errors: [...report.errors, msg(e)] }, 500);
  } finally {
    if (!onlyTenantId) {
      await supabase.from("referral_program_settings").update({ engine_lease_until: null }).eq("id", true);
    }
  }
});

// ─────────────────────────────────────────────────────────────── step 1 ──

/**
 * The operator's code exists; if they are on the default referee terms and the
 * default has changed since their code was made, it is rotated onto the new
 * terms (operators who already redeemed keep what they got).
 */
async function ensureCodeForTenant(
  supabase: any, t: Tenant, settings: ProgramSettings,
): Promise<{ created: boolean; rotated: boolean }> {
  const { data: existing } = await supabase
    .from("platform_promo_codes")
    .select("id")
    .eq("owner_tenant_id", t.id).eq("kind", "referral").eq("status", "active")
    .maybeSingle();
  const code = await ensureReferralCode(supabase, t, settings);
  if (!existing) return { created: true, rotated: false };

  const { data: prefs } = await supabase
    .from("tenant_referral_settings")
    .select("uses_default_referee_discount")
    .eq("tenant_id", t.id)
    .maybeSingle();
  if (prefs && prefs.uses_default_referee_discount === false) return { created: false, rotated: false };

  const wantMonths = settings.default_referee_duration === "repeating" ? settings.default_referee_duration_months : null;
  const differs =
    code.discount_type !== settings.default_referee_discount_type ||
    Number(code.discount_value) !== Number(settings.default_referee_discount_value) ||
    code.duration !== settings.default_referee_duration ||
    (code.duration_months ?? null) !== (wantMonths ?? null);
  if (!differs) return { created: false, rotated: false };

  await rotateCode(supabase, code, {
    discount_type: settings.default_referee_discount_type,
    discount_value: settings.default_referee_discount_value,
    duration: settings.default_referee_duration,
    duration_months: wantMonths,
  });
  return { created: false, rotated: true };
}

// ─────────────────────────────────────────────────────────────── step 2 ──

/** Look at one live subscription we have not seen: did it redeem one of our codes? */
async function discoverRedemption(
  supabase: any,
  t: Tenant,
  row: { tenant_id: string; stripe_subscription_id: string; stripe_account: string; created_at: string },
): Promise<boolean> {
  const account = row.stripe_account === "uae" ? "uae" : "uk";
  const mode = modeOf(t);
  const stripe = stripeFor(account, mode);
  const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id, { expand: ["discounts"] });

  let foundCodeId: string | null = null;
  let discountEnd: number | null = null;
  const refs = discountRefsOf(sub);
  const couponIds = refs.map(r => r.couponId).filter((c): c is string => !!c && !isTierCouponId(c));
  if (couponIds.length > 0) {
    const { data: mirrors } = await supabase
      .from("platform_promo_code_stripe")
      .select("promo_code_id, stripe_coupon_id")
      .in("stripe_coupon_id", couponIds);
    const hit = ((mirrors ?? []) as Array<{ promo_code_id: string; stripe_coupon_id: string }>)[0];
    if (hit) {
      foundCodeId = hit.promo_code_id;
      const expanded = ((sub as any).discounts ?? []) as Array<any>;
      const d = expanded.find(x => typeof x === "object" && x?.coupon?.id === hit.stripe_coupon_id);
      discountEnd = d?.end ?? null;
    }
  }

  if (foundCodeId) {
    const { data: codeRow } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).eq("id", foundCodeId).maybeSingle();
    if (codeRow) {
      const { referralId } = await recordRedemption(supabase, {
        code: toCodeRow(codeRow),
        tenantId: t.id,
        subscriptionId: row.stripe_subscription_id,
        account,
        mode,
        discountEndsAt: discountEnd ? new Date(discountEnd * 1000).toISOString() : null,
        source: sub.metadata?.subscription_link_id ? "payment_link" : "self_serve_checkout",
        redeemedAt: row.created_at,
      });
      void referralId;
    }
  }

  await supabase.from("referral_subscription_scans").upsert({
    stripe_subscription_id: row.stripe_subscription_id,
    tenant_id: t.id,
    scanned_at: new Date().toISOString(),
    found_promo_code_id: foundCodeId,
  }, { onConflict: "stripe_subscription_id" });
  return !!foundCodeId;
}

// ─────────────────────────────────────────────────────────── steps 3–4, 6 ──

async function evaluateReferrer(
  supabase: any, t: Tenant, now: Date,
): Promise<{ tierChanged: boolean; stripeChanged: boolean }> {
  const standing = await computeReferrerStanding(supabase, t.id);
  const { data: prev } = await supabase
    .from("referral_tier_state")
    .select("current_discount_type, current_discount_value, applied_stripe_coupon_id, applied_on_subscription_id")
    .eq("tenant_id", t.id)
    .maybeSingle();

  const tier = standing.tier;
  const prevValue = prev?.current_discount_value != null ? Number(prev.current_discount_value) : null;
  const tierChanged =
    (prev?.current_discount_type ?? null) !== (tier?.discount_type ?? null) ||
    prevValue !== (tier ? Number(tier.discount_value) : null);

  // The reward lives on the referrer's own live subscription. No subscription:
  // record the standing and wait — there is nothing to discount yet.
  const live = await liveSubscriptionOf(supabase, t.id);
  let couponId: string | null = null;
  let stripeChanged = false;
  if (live) {
    const stripe = stripeFor(live.stripe_account, modeOf(t));
    const out = await reconcileTierOnSubscription(stripe, live.stripe_subscription_id, tier);
    couponId = out.couponId;
    stripeChanged = out.changed;
  }

  await supabase.from("referral_tier_state").upsert({
    tenant_id: t.id,
    active_referrals: standing.activeReferrals,
    total_referrals: standing.totalReferrals,
    current_tier_id: tier?.id ?? null,
    current_discount_type: tier?.discount_type ?? null,
    current_discount_value: tier?.discount_value ?? null,
    applied_stripe_coupon_id: couponId,
    applied_on_subscription_id: live?.stripe_subscription_id ?? null,
    stripe_account: live?.stripe_account ?? null,
    stripe_mode: live ? modeOf(t) : null,
    last_evaluated_at: now.toISOString(),
    ...(tierChanged ? { last_changed_at: now.toISOString() } : {}),
    last_error: null,
  }, { onConflict: "tenant_id" });

  // A first evaluation with no tier is not a change worth telling anyone about.
  if (tierChanged && (prev || tier)) {
    const up = tier && (prevValue === null || prev?.current_discount_type !== tier.discount_type || Number(tier.discount_value) > prevValue);
    await logReferralEvent(supabase, {
      tenantId: t.id,
      eventType: "tier_changed",
      payload: {
        from: prev?.current_discount_type ? { type: prev.current_discount_type, value: prevValue } : null,
        to: tier ? { type: tier.discount_type, value: tier.discount_value } : null,
        active_referrals: standing.activeReferrals,
        direction: up ? "up" : "down",
      },
    });
    await notifyTierChange(supabase, t, tier, standing.tiers, standing.activeReferrals, !!up, now);
  }
  return { tierChanged, stripeChanged };
}

/** Trax voice: short, factual, tells them what happens to their next bill. */
async function notifyTierChange(
  supabase: any, t: Tenant, tier: ReferralTier | null, tiers: ReferralTier[],
  activeReferrals: number, up: boolean, now: Date,
): Promise<void> {
  const reward = tier ? tierRewardText(tier) : null;
  const next = nextTier(tiers, activeReferrals);
  const plural = (n: number) => `${n} subscribed referral${n === 1 ? "" : "s"}`;

  const title = up ? "Your referral reward went up" : tier ? "Your referral reward changed" : "Your referral reward has paused";
  const message = up
    ? `You now have ${plural(activeReferrals)}, so you get ${reward} from your next bill.` +
      (next ? ` ${next.needed} more and it rises to ${tierRewardText(next.tier)}.` : "")
    : tier
      ? `One of the operators you referred is no longer subscribed. You now get ${reward} from your next bill.`
      : `The operators you referred are no longer subscribed, so your next bill is at the full price. Refer someone new to start saving again.`;

  // The new standing is part of the key: a retry of the same change is one
  // notice, but "paused" then "back" in the same minute are two.
  const standing = tier ? `${tier.discount_type}-${tier.discount_value}` : "none";
  const dedupeKey = `ref-tier-${t.id}-${standing}-${activeReferrals}-${now.toISOString().slice(0, 16)}`;
  await notifyOperatorsInApp({
    tenantId: t.id,
    type: "referral_tier_changed",
    title,
    message,
    link: "/referrals",
    metadata: { active_referrals: activeReferrals, reward },
    dedupeKey,
  });

  if (t.contact_email) {
    const portal = portalBaseUrl(t.slug);
    const html = platformEmailShell(`
<p style="font-size:18px;font-weight:600;color:#0f172a;margin:0 0 12px">${escapeHtml(title)}</p>
<p style="margin:0 0 20px;line-height:1.6">${escapeHtml(message)}</p>
<a href="${portal}/referrals" style="display:block;text-align:center;background:#0f172a;color:#fff;text-decoration:none;padding:13px 20px;border-radius:8px;font-weight:500">See your referrals</a>`);
    const r = await sendResendEmail({
      to: t.contact_email,
      subject: `${title} — Drive247`,
      html,
      text: `${title}\n\n${message}\n\n${portal}/referrals`,
      idempotencyKey: dedupeKey,
    }, supabase);
    if (r?.success) {
      await logReferralEvent(supabase, { tenantId: t.id, eventType: "notified_referrer", payload: { title } });
    }
  }
}

// ─────────────────────────────────────────────────────────────── step 5 ──

/** What the tier reward took off each paid invoice, for "you have saved $X". */
async function recordSavings(supabase: any, t: Tenant): Promise<number> {
  const { data: first } = await supabase
    .from("referrals")
    .select("attributed_at")
    .eq("referrer_tenant_id", t.id)
    .order("attributed_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!first) return 0;

  const { data: invoices } = await supabase
    .from("tenant_subscription_invoices")
    .select("stripe_invoice_id, paid_at, subscription_id")
    .eq("tenant_id", t.id)
    .eq("status", "paid")
    .gte("paid_at", first.attributed_at);
  const list = (invoices ?? []) as Array<{ stripe_invoice_id: string; paid_at: string; subscription_id: string | null }>;
  if (list.length === 0) return 0;

  const { data: done } = await supabase
    .from("referral_savings")
    .select("stripe_invoice_id")
    .in("stripe_invoice_id", list.map(i => i.stripe_invoice_id));
  const recorded = new Set(((done ?? []) as Array<{ stripe_invoice_id: string }>).map(r => r.stripe_invoice_id));

  const { data: subs } = await supabase
    .from("tenant_subscriptions")
    .select("id, stripe_account")
    .eq("tenant_id", t.id);
  const accountOf = new Map(((subs ?? []) as Array<{ id: string; stripe_account: string }>).map(s => [s.id, s.stripe_account === "uae" ? "uae" : "uk"]));

  let added = 0;
  for (const inv of list) {
    if (recorded.has(inv.stripe_invoice_id)) continue;
    const account = (inv.subscription_id && accountOf.get(inv.subscription_id)) || "uae";
    const stripe = stripeFor(account as "uk" | "uae", modeOf(t));
    const invoice = await stripe.invoices.retrieve(inv.stripe_invoice_id, { expand: ["total_discount_amounts.discount"] });
    let cents = 0;
    for (const d of invoice.total_discount_amounts ?? []) {
      const disc = d.discount as unknown as { coupon?: { id?: string } } | string;
      const couponId = typeof disc === "string" ? null : disc?.coupon?.id ?? null;
      if (isTierCouponId(couponId)) cents += d.amount;
    }
    const { error } = await supabase.from("referral_savings").insert({
      tenant_id: t.id,
      stripe_invoice_id: inv.stripe_invoice_id,
      stripe_account: account,
      amount_off_cents: cents,
      invoice_paid_at: inv.paid_at,
    });
    if (!error) added++;
  }
  return added;
}
