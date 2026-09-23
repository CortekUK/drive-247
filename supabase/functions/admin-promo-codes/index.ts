// admin-promo-codes — Super admin "Promo Codes" tab. Drive247 platform promo
// codes + the operator referral programme. JWT on.
//
// Who may do what (brief R3):
//   super admin   everything
//   sales agent   read, copy links, and put a code on a payment link — never
//                 anything that changes money terms, tiers or attributions
//
// POST { action, ...args }. Every mutating action writes a referral_events row
// naming the actor. Stripe is only touched when a discount is actually applied
// (manual attach with the referee discount); code terms are mirrored to Stripe
// lazily at checkout.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  attachReferral,
  checkCodeUsable,
  discountRefsOf,
  discountSnapshot,
  ensureCodeCoupon,
  ensureReferralCode,
  findCode,
  generateReferralCode,
  liveSubscriptionOf,
  loadEffectiveTiers,
  loadProgramSettings,
  logReferralEvent,
  planProductOfSubscription,
  PROMO_CODE_COLUMNS,
  referralLink,
  rotateCode,
  stripeFor,
  toCodeRow,
  type PromoCodeRow,
} from "../_shared/platform-promo.ts";
import {
  discountText,
  durationText,
  isLiveSubscriptionStatus,
  isTierCouponId,
  normalizePromoCode,
  tierRewardText,
  type PromoDiscountType,
  type PromoDuration,
} from "../_shared/platform-promo-rules.ts";

const SALES_ACTIONS = new Set([
  "list", "get_tenant_referral", "list_referrals", "leaderboard",
  "list_for_payment_link", "set_link_promo", "search_tenants",
]);

type Actor = { id: string; isSuperAdmin: boolean; isSales: boolean };

const fail = (message: string, status = 400) => errorResponse(message, status);
const msg = (e: unknown) => (e as { message?: string })?.message ?? String(e);

// ─────────────────────────────────────────────────────────── validation ──

type Terms = {
  discount_type: PromoDiscountType;
  discount_value: number;
  duration: PromoDuration;
  duration_months: number | null;
  max_redemptions?: number | null;
  expires_at?: string | null;
  restrict_signup_plan_keys?: string[] | null;
  note?: string | null;
};

/** Money terms from the admin form, checked the same way the table checks them. */
function parseTerms(raw: unknown, opts: { campaign: boolean }): { ok: true; terms: Terms } | { ok: false; error: string } {
  const t = (raw ?? {}) as Record<string, unknown>;
  const type = t.discount_type;
  if (type !== "percent" && type !== "fixed") return { ok: false, error: "Choose a percentage or a fixed amount" };
  const value = Number(t.discount_value);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "The discount must be more than zero" };
  if (type === "percent" && value > 100) return { ok: false, error: "A percentage cannot be more than 100" };
  const duration = t.duration;
  if (duration !== "once" && duration !== "repeating" && duration !== "forever") return { ok: false, error: "Choose how long the discount lasts" };
  let months: number | null = null;
  if (duration === "repeating") {
    months = Number(t.duration_months);
    if (!Number.isInteger(months) || months < 1 || months > 36) return { ok: false, error: "Months must be a whole number from 1 to 36" };
  }
  const terms: Terms = { discount_type: type, discount_value: Math.round(value * 100) / 100, duration, duration_months: months };
  if (opts.campaign) {
    if (t.max_redemptions !== undefined && t.max_redemptions !== null && t.max_redemptions !== "") {
      const max = Number(t.max_redemptions);
      if (!Number.isInteger(max) || max < 1) return { ok: false, error: "Maximum uses must be a whole number, 1 or more" };
      terms.max_redemptions = max;
    } else terms.max_redemptions = null;
    if (t.expires_at) {
      const at = new Date(String(t.expires_at));
      if (Number.isNaN(at.getTime())) return { ok: false, error: "The expiry date is not a date" };
      terms.expires_at = at.toISOString();
    } else terms.expires_at = null;
    if (Array.isArray(t.restrict_signup_plan_keys) && t.restrict_signup_plan_keys.length > 0) {
      terms.restrict_signup_plan_keys = t.restrict_signup_plan_keys.map(String).map(s => s.trim()).filter(Boolean).slice(0, 20);
    } else terms.restrict_signup_plan_keys = null;
  }
  if (typeof t.note === "string") terms.note = t.note.trim().slice(0, 500) || null;
  return { ok: true, terms };
}

type TierInput = { min_active_referrals: number; discount_type: PromoDiscountType; discount_value: number };

function parseTiers(raw: unknown): { ok: true; tiers: TierInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Add at least one tier" };
  if (raw.length > 20) return { ok: false, error: "At most 20 tiers" };
  const tiers: TierInput[] = [];
  const mins = new Set<number>();
  for (const r of raw as Array<Record<string, unknown>>) {
    const min = Number(r.min_active_referrals);
    if (!Number.isInteger(min) || min < 1) return { ok: false, error: "Each tier needs at least 1 referral" };
    if (mins.has(min)) return { ok: false, error: `Two tiers start at ${min} referrals` };
    mins.add(min);
    const type = r.discount_type;
    if (type !== "percent" && type !== "fixed") return { ok: false, error: "Each tier needs a percentage or a fixed amount" };
    const value = Number(r.discount_value);
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "Each tier's discount must be more than zero" };
    if (type === "percent" && value > 100) return { ok: false, error: "A tier cannot be more than 100%" };
    tiers.push({ min_active_referrals: min, discount_type: type, discount_value: Math.round(value * 100) / 100 });
  }
  return { ok: true, tiers: tiers.sort((a, b) => a.min_active_referrals - b.min_active_referrals) };
}

// ─────────────────────────────────────────────────────────────── helpers ──

async function tenantNames(supabase: any, ids: string[]): Promise<Map<string, { name: string; slug: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("tenants").select("id, company_name, slug").in("id", unique);
  return new Map(((data ?? []) as Array<{ id: string; company_name: string | null; slug: string }>)
    .map(t => [t.id, { name: t.company_name || t.slug, slug: t.slug }]));
}

function codeView(row: PromoCodeRow, owner?: { name: string; slug: string } | null) {
  return {
    ...row,
    discountText: discountText(row.discount_type, row.discount_value, row.currency),
    durationText: durationText(row.duration, row.duration_months),
    link: row.kind === "referral" ? referralLink(row.code) : null,
    ownerName: owner?.name ?? null,
    ownerSlug: owner?.slug ?? null,
  };
}

/** Kick the engine for one operator and wait for it (so the screen shows the result). */
async function runEngine(supabase: any, tenantId?: string | null): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("referral-engine", { body: tenantId ? { tenantId } : {} });
  if (error) return { error: msg(error) };
  return data;
}

/**
 * Put the referrer's code discount on a referee's EXISTING subscription (manual
 * attach, "also give them the new-operator discount"). Appended to their
 * discounts; every existing discount is kept, a tier reward stays last.
 */
async function applyRefereeDiscountToExisting(supabase: any, code: PromoCodeRow, refereeTenantId: string, actorId: string): Promise<{ redemptionId: string }> {
  const live = await liveSubscriptionOf(supabase, refereeTenantId);
  if (!live) throw new Error("This operator has no live subscription to discount");
  const { data: t } = await supabase.from("tenants").select("subscription_stripe_mode").eq("id", refereeTenantId).single();
  const mode = t?.subscription_stripe_mode === "live" ? "live" : "test";
  const stripe = stripeFor(live.stripe_account, mode);
  const sub = await stripe.subscriptions.retrieve(live.stripe_subscription_id, { expand: ["discounts"] });
  const productId = planProductOfSubscription(sub);
  if (!productId) throw new Error("Their subscription has no plan item to discount");
  const { couponId } = await ensureCodeCoupon(supabase, stripe, code, { account: live.stripe_account, mode, productId, trialDays: 0 });

  const refs = discountRefsOf(sub);
  if (!refs.some(r => r.couponId === couponId)) {
    const others = refs.filter(r => !isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
    const tiers = refs.filter(r => isTierCouponId(r.couponId)).map(r => ({ discount: r.discountId }));
    await stripe.subscriptions.update(live.stripe_subscription_id, {
      discounts: [...others, { coupon: couponId }, ...tiers],
    }, { idempotencyKey: `d247-manual-referee-${live.stripe_subscription_id}-${couponId}` });
  }

  const refreshed = await stripe.subscriptions.retrieve(live.stripe_subscription_id, { expand: ["discounts"] });
  const ours = (((refreshed as any).discounts ?? []) as Array<any>).find(d => typeof d === "object" && d?.coupon?.id === couponId);
  const { error } = await supabase.from("promo_code_redemptions").insert({
    promo_code_id: code.id,
    tenant_id: refereeTenantId,
    stripe_subscription_id: live.stripe_subscription_id,
    stripe_account: live.stripe_account,
    stripe_mode: mode,
    discount_snapshot: discountSnapshot(code),
    discount_ends_at: ours?.end ? new Date(ours.end * 1000).toISOString() : null,
    redeemed_at: new Date().toISOString(),
  });
  if (error && (error as { code?: string }).code !== "23505") throw new Error(error.message);
  const { data: redemption } = await supabase
    .from("promo_code_redemptions").select("id").eq("promo_code_id", code.id).eq("tenant_id", refereeTenantId).single();
  await logReferralEvent(supabase, { tenantId: refereeTenantId, eventType: "redeemed", payload: { code: code.code, manual: true }, actor: actorId });
  return { redemptionId: redemption.id };
}

/** Manual attach (brief §2.3), shared by the direct action and claim approval. */
async function doAttach(
  supabase: any, actor: Actor,
  args: { referrerTenantId: string; referredTenantId: string; note: string | null; applyRefereeDiscount: boolean },
): Promise<{ referralId: string }> {
  if (!args.referrerTenantId || !args.referredTenantId) throw new Error("Choose both operators");
  if (args.referrerTenantId === args.referredTenantId) throw new Error("An operator cannot refer themselves");
  const { data: existing } = await supabase
    .from("referrals").select("id").eq("referred_tenant_id", args.referredTenantId).eq("status", "active").maybeSingle();
  if (existing) throw new Error("This operator is already attached to a referrer. Void that referral first.");

  let promoCodeId: string | null = null;
  let redemptionId: string | null = null;
  if (args.applyRefereeDiscount) {
    const { data: codeRow } = await supabase
      .from("platform_promo_codes").select(PROMO_CODE_COLUMNS)
      .eq("owner_tenant_id", args.referrerTenantId).eq("kind", "referral").eq("status", "active").maybeSingle();
    if (!codeRow) throw new Error("The referrer has no referral code yet");
    const code = toCodeRow(codeRow);
    const { data: already } = await supabase
      .from("promo_code_redemptions").select("id").eq("tenant_id", args.referredTenantId).limit(1);
    if ((already ?? []).length > 0) throw new Error("This operator already has a promo code discount; one code per operator.");
    promoCodeId = code.id;
    redemptionId = (await applyRefereeDiscountToExisting(supabase, code, args.referredTenantId, actor.id)).redemptionId;
  }

  const referralId = await attachReferral(supabase, {
    referrerTenantId: args.referrerTenantId,
    referredTenantId: args.referredTenantId,
    promoCodeId,
    redemptionId,
    source: "manual",
    refereeDiscountApplied: args.applyRefereeDiscount,
    createdBy: actor.id,
    note: args.note,
  });
  if (!referralId) throw new Error("Could not attach the referral");
  return { referralId };
}

// ────────────────────────────────────────────────────────────────── main ──

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("Missing authorization header", 401);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return fail("Unauthorized", 401);
    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, is_active, is_super_admin, is_sales_agent")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!appUser || appUser.is_active === false || !(appUser.is_super_admin || appUser.is_sales_agent)) {
      return fail("Forbidden", 403);
    }
    const actor: Actor = { id: appUser.id, isSuperAdmin: !!appUser.is_super_admin, isSales: !!appUser.is_sales_agent };

    const body = await req.json().catch(() => ({})) as Record<string, any>;
    const action = String(body.action ?? "");
    if (!actor.isSuperAdmin && !SALES_ACTIONS.has(action)) return fail("Only a super admin can do that", 403);

    switch (action) {
      // ── codes ──────────────────────────────────────────────────────────
      case "list": {
        let q = supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).order("created_at", { ascending: false }).limit(500);
        if (body.kind === "campaign" || body.kind === "referral") q = q.eq("kind", body.kind);
        if (["active", "inactive", "superseded"].includes(body.status)) q = q.eq("status", body.status);
        const search = typeof body.search === "string" ? normalizePromoCode(body.search.replace(/\s+/g, "")) : null;
        if (search) q = q.ilike("code", `%${search}%`);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = ((data ?? []) as Array<Record<string, unknown>>).map(toCodeRow);
        const owners = await tenantNames(supabase, rows.map(r => r.owner_tenant_id ?? ""));
        const counts = new Map<string, number>();
        if (rows.length) {
          const { data: reds } = await supabase.from("promo_code_redemptions").select("promo_code_id").in("promo_code_id", rows.map(r => r.id));
          for (const r of (reds ?? []) as Array<{ promo_code_id: string }>) counts.set(r.promo_code_id, (counts.get(r.promo_code_id) ?? 0) + 1);
        }
        return jsonResponse({
          codes: rows.map(r => ({ ...codeView(r, r.owner_tenant_id ? owners.get(r.owner_tenant_id) : null), redemptions: counts.get(r.id) ?? 0 })),
        });
      }

      case "create_campaign": {
        const code = normalizePromoCode(body.code);
        if (!code) return fail("Codes use letters, numbers and single dashes, e.g. LAUNCH50");
        const parsed = parseTerms(body.terms, { campaign: true });
        if (!parsed.ok) return fail(parsed.error);
        const { data, error } = await supabase
          .from("platform_promo_codes")
          .insert({ code, kind: "campaign", ...parsed.terms, created_by: actor.id })
          .select(PROMO_CODE_COLUMNS)
          .single();
        if (error) return fail(error.code === "23505" ? "That code is already in use" : error.message);
        await logReferralEvent(supabase, { eventType: "code_created", payload: { code, kind: "campaign" }, actor: actor.id });
        return jsonResponse({ code: codeView(toCodeRow(data)) });
      }

      case "update_code": {
        const { data: row } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).eq("id", body.id).maybeSingle();
        if (!row) return fail("Code not found", 404);
        const current = toCodeRow(row);
        if (current.status !== "active") return fail("Only an active code can be edited");
        const parsed = parseTerms(body.terms, { campaign: current.kind === "campaign" });
        if (!parsed.ok) return fail(parsed.error);
        let newCode: string | undefined;
        if (current.kind === "campaign" && body.code !== undefined) {
          const c = normalizePromoCode(body.code);
          if (!c) return fail("Codes use letters, numbers and single dashes");
          newCode = c;
        }
        const rotated = await rotateCode(supabase, current, { ...parsed.terms, ...(newCode ? { code: newCode } : {}) }, actor.id);
        if (current.kind === "referral" && current.owner_tenant_id) {
          // Custom terms from now on: a change to the platform default no longer moves this code.
          await supabase.from("tenant_referral_settings").upsert(
            { tenant_id: current.owner_tenant_id, uses_default_referee_discount: false, updated_by: actor.id },
            { onConflict: "tenant_id" },
          );
        }
        return jsonResponse({ code: codeView(rotated) });
      }

      case "set_status": {
        if (body.status !== "active" && body.status !== "inactive") return fail("Status must be active or inactive");
        const { data: row } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).eq("id", body.id).maybeSingle();
        if (!row) return fail("Code not found", 404);
        if (row.status === "superseded") return fail("This is an old version of a code; edit the current one instead");
        const { error } = await supabase.from("platform_promo_codes").update({ status: body.status }).eq("id", body.id);
        if (error) return fail(error.code === "23505" ? "Another active code already uses this string or owner" : error.message);
        await logReferralEvent(supabase, { tenantId: row.owner_tenant_id, eventType: `code_${body.status}`, payload: { code: row.code }, actor: actor.id });
        return jsonResponse({ success: true });
      }

      // ── one operator's referral set-up ─────────────────────────────────
      case "get_tenant_referral": {
        const tenantId = String(body.tenantId ?? "");
        const { data: tenant } = await supabase.from("tenants").select("id, slug, company_name, status, tenant_type, contact_email").eq("id", tenantId).maybeSingle();
        if (!tenant) return fail("Operator not found", 404);
        const [{ data: prefs }, { data: codeRow }, { data: state }, effective, live] = await Promise.all([
          supabase.from("tenant_referral_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
          supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).eq("owner_tenant_id", tenantId).eq("kind", "referral").eq("status", "active").maybeSingle(),
          supabase.from("referral_tier_state").select("*").eq("tenant_id", tenantId).maybeSingle(),
          loadEffectiveTiers(supabase, tenantId),
          liveSubscriptionOf(supabase, tenantId),
        ]);
        const { data: made } = await supabase
          .from("referrals").select("id, referred_tenant_id, referred_name_snapshot, source, status, attributed_at, voided_at, void_reason, note")
          .eq("referrer_tenant_id", tenantId).order("attributed_at", { ascending: false });
        const { data: received } = await supabase
          .from("referrals").select("id, referrer_tenant_id, referrer_name_snapshot, source, status, attributed_at")
          .eq("referred_tenant_id", tenantId).order("attributed_at", { ascending: false });
        const refereeIds = ((made ?? []) as Array<{ referred_tenant_id: string }>).map(r => r.referred_tenant_id);
        const liveIds = new Set<string>();
        if (refereeIds.length) {
          const { data: subs } = await supabase.from("tenant_subscriptions").select("tenant_id, status").in("tenant_id", refereeIds);
          for (const s of (subs ?? []) as Array<{ tenant_id: string; status: string }>) if (isLiveSubscriptionStatus(s.status)) liveIds.add(s.tenant_id);
        }
        const { data: savings } = await supabase.from("referral_savings").select("amount_off_cents").eq("tenant_id", tenantId);
        const settings = await loadProgramSettings(supabase);
        return jsonResponse({
          tenant,
          subscribed: !!live,
          settings: prefs ?? { tenant_id: tenantId, referrals_enabled: true, brand_prefix: null, uses_default_referee_discount: true, show_name_on_invite: true },
          code: codeRow ? codeView(toCodeRow(codeRow)) : null,
          tiers: effective.tiers.map(t => ({ ...t, reward: tierRewardText(t) })),
          customTiers: effective.custom,
          state: state ?? null,
          referralsMade: ((made ?? []) as Array<any>).map(r => ({ ...r, counts: r.status === "active" && liveIds.has(r.referred_tenant_id) })),
          referredBy: received ?? [],
          savedCents: ((savings ?? []) as Array<{ amount_off_cents: number }>).reduce((a, s) => a + s.amount_off_cents, 0),
          programDefaults: {
            discountText: discountText(settings.default_referee_discount_type, settings.default_referee_discount_value),
            durationText: durationText(settings.default_referee_duration, settings.default_referee_duration_months),
          },
        });
      }

      case "update_tenant_referral": {
        const tenantId = String(body.tenantId ?? "");
        const { data: tenant } = await supabase.from("tenants").select("id, slug, company_name").eq("id", tenantId).maybeSingle();
        if (!tenant) return fail("Operator not found", 404);
        await supabase.from("tenant_referral_settings").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });

        const patch: Record<string, unknown> = { updated_by: actor.id };
        if (typeof body.referralsEnabled === "boolean") patch.referrals_enabled = body.referralsEnabled;
        if (typeof body.showNameOnInvite === "boolean") patch.show_name_on_invite = body.showNameOnInvite;
        let brandChanged = false;
        if (body.brandPrefix !== undefined) {
          const brand = body.brandPrefix === null || body.brandPrefix === "" ? null : String(body.brandPrefix).toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (brand !== null && (brand.length < 2 || brand.length > 10)) return fail("The brand part must be 2 to 10 letters or numbers");
          patch.brand_prefix = brand;
          brandChanged = true;
        }
        const { error: prefsError } = await supabase.from("tenant_referral_settings").update(patch).eq("tenant_id", tenantId);
        if (prefsError) throw new Error(prefsError.message);

        const settings = await loadProgramSettings(supabase);
        const { data: codeRow } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS)
          .eq("owner_tenant_id", tenantId).eq("kind", "referral").eq("status", "active").maybeSingle();
        let code = codeRow ? toCodeRow(codeRow) : await ensureReferralCode(supabase, tenant, settings, actor.id);

        // The discount their code gives a new operator.
        if (body.refereeDiscount?.useDefault === true) {
          await supabase.from("tenant_referral_settings").update({ uses_default_referee_discount: true }).eq("tenant_id", tenantId);
          const wantMonths = settings.default_referee_duration === "repeating" ? settings.default_referee_duration_months : null;
          if (code.discount_type !== settings.default_referee_discount_type || code.discount_value !== settings.default_referee_discount_value ||
              code.duration !== settings.default_referee_duration || (code.duration_months ?? null) !== (wantMonths ?? null)) {
            code = await rotateCode(supabase, code, {
              discount_type: settings.default_referee_discount_type,
              discount_value: settings.default_referee_discount_value,
              duration: settings.default_referee_duration,
              duration_months: wantMonths,
            }, actor.id);
          }
        } else if (body.refereeDiscount?.terms) {
          const parsed = parseTerms(body.refereeDiscount.terms, { campaign: false });
          if (!parsed.ok) return fail(parsed.error);
          await supabase.from("tenant_referral_settings").update({ uses_default_referee_discount: false }).eq("tenant_id", tenantId);
          code = await rotateCode(supabase, code, parsed.terms, actor.id);
        }

        // A new brand part means a new code string (a code carries its brand).
        if (brandChanged) {
          const fresh = await generateReferralCode(supabase, tenant, settings.code_suffix_length, (patch.brand_prefix as string | null) ?? null);
          code = await rotateCode(supabase, code, { code: fresh }, actor.id);
        }

        // Their tier table: replace it, or reset to the platform default.
        if (body.tiers === null) {
          await supabase.from("referral_tiers").delete().eq("tenant_id", tenantId);
          await logReferralEvent(supabase, { tenantId, eventType: "tiers_reset", actor: actor.id });
        } else if (body.tiers !== undefined) {
          const parsed = parseTiers(body.tiers);
          if (!parsed.ok) return fail(parsed.error);
          await supabase.from("referral_tiers").delete().eq("tenant_id", tenantId);
          const { error } = await supabase.from("referral_tiers").insert(parsed.tiers.map(t => ({ ...t, tenant_id: tenantId })));
          if (error) throw new Error(error.message);
          await logReferralEvent(supabase, { tenantId, eventType: "tiers_customised", payload: { tiers: parsed.tiers }, actor: actor.id });
        }

        await logReferralEvent(supabase, { tenantId, eventType: "referral_settings_updated", payload: { keys: Object.keys(body) }, actor: actor.id });
        const engine = await runEngine(supabase, tenantId);
        return jsonResponse({ success: true, code: codeView(code), engine });
      }

      case "regenerate_code": {
        const tenantId = String(body.tenantId ?? "");
        const { data: tenant } = await supabase.from("tenants").select("id, slug, company_name").eq("id", tenantId).maybeSingle();
        if (!tenant) return fail("Operator not found", 404);
        const settings = await loadProgramSettings(supabase);
        const { data: prefs } = await supabase.from("tenant_referral_settings").select("brand_prefix").eq("tenant_id", tenantId).maybeSingle();
        const { data: codeRow } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS)
          .eq("owner_tenant_id", tenantId).eq("kind", "referral").eq("status", "active").maybeSingle();
        if (!codeRow) return jsonResponse({ code: codeView(await ensureReferralCode(supabase, tenant, settings, actor.id)) });
        const fresh = await generateReferralCode(supabase, tenant, settings.code_suffix_length, prefs?.brand_prefix ?? null);
        return jsonResponse({ code: codeView(await rotateCode(supabase, toCodeRow(codeRow), { code: fresh }, actor.id)) });
      }

      // ── referrals ──────────────────────────────────────────────────────
      case "list_referrals": {
        let q = supabase.from("referrals")
          .select("id, referrer_tenant_id, referred_tenant_id, referrer_name_snapshot, referred_name_snapshot, source, status, referee_discount_applied, attributed_at, voided_at, void_reason, note, promo_code_id")
          .order("attributed_at", { ascending: false }).limit(500);
        if (body.status === "active" || body.status === "void") q = q.eq("status", body.status);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as Array<any>;
        const referees = rows.map(r => r.referred_tenant_id);
        const liveIds = new Set<string>();
        if (referees.length) {
          const { data: subs } = await supabase.from("tenant_subscriptions").select("tenant_id, status").in("tenant_id", referees);
          for (const s of (subs ?? []) as Array<{ tenant_id: string; status: string }>) if (isLiveSubscriptionStatus(s.status)) liveIds.add(s.tenant_id);
        }
        const search = typeof body.search === "string" ? body.search.trim().toLowerCase() : "";
        return jsonResponse({
          referrals: rows
            .filter(r => !search || `${r.referrer_name_snapshot} ${r.referred_name_snapshot}`.toLowerCase().includes(search))
            .map(r => ({ ...r, counts: r.status === "active" && liveIds.has(r.referred_tenant_id) })),
        });
      }

      case "attach_referral": {
        try {
          const out = await doAttach(supabase, actor, {
            referrerTenantId: String(body.referrerTenantId ?? ""),
            referredTenantId: String(body.referredTenantId ?? ""),
            note: typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null,
            applyRefereeDiscount: body.applyRefereeDiscount === true,
          });
          const engine = await runEngine(supabase, String(body.referrerTenantId));
          return jsonResponse({ success: true, referralId: out.referralId, engine });
        } catch (e) {
          return fail(msg(e));
        }
      }

      case "void_referral": {
        const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
        if (reason.length < 3) return fail("Say why this referral is being voided");
        const { data: row, error } = await supabase
          .from("referrals")
          .update({ status: "void", voided_at: new Date().toISOString(), voided_by: actor.id, void_reason: reason })
          .eq("id", body.referralId).eq("status", "active")
          .select("id, referrer_tenant_id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) return fail("That referral is not active", 404);
        await logReferralEvent(supabase, { tenantId: row.referrer_tenant_id, referralId: row.id, eventType: "referral_voided", payload: { reason }, actor: actor.id });
        const engine = await runEngine(supabase, row.referrer_tenant_id);
        return jsonResponse({ success: true, engine });
      }

      case "list_claims": {
        let q = supabase.from("referral_claims").select("*").order("created_at", { ascending: false }).limit(200);
        if (["pending", "approved", "rejected"].includes(body.status)) q = q.eq("status", body.status);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const names = await tenantNames(supabase, ((data ?? []) as Array<any>).map(c => c.referrer_tenant_id));
        return jsonResponse({ claims: ((data ?? []) as Array<any>).map(c => ({ ...c, referrerName: names.get(c.referrer_tenant_id)?.name ?? null })) });
      }

      case "resolve_claim": {
        const { data: claim } = await supabase.from("referral_claims").select("*").eq("id", body.claimId).maybeSingle();
        if (!claim) return fail("Claim not found", 404);
        if (claim.status !== "pending") return fail("This claim has already been resolved");
        if (body.decision === "reject") {
          await supabase.from("referral_claims").update({ status: "rejected", resolved_by: actor.id, resolved_at: new Date().toISOString() }).eq("id", claim.id);
          await logReferralEvent(supabase, { tenantId: claim.referrer_tenant_id, eventType: "claim_rejected", payload: { claim_id: claim.id }, actor: actor.id });
          return jsonResponse({ success: true });
        }
        if (body.decision !== "approve") return fail("Approve or reject");
        try {
          const out = await doAttach(supabase, actor, {
            referrerTenantId: claim.referrer_tenant_id,
            referredTenantId: String(body.referredTenantId ?? ""),
            note: claim.note ?? `Claim: ${claim.claimed_business_name}`,
            applyRefereeDiscount: body.applyRefereeDiscount === true,
          });
          await supabase.from("referral_claims").update({
            status: "approved", resolved_referral_id: out.referralId, resolved_by: actor.id, resolved_at: new Date().toISOString(),
          }).eq("id", claim.id);
          const engine = await runEngine(supabase, claim.referrer_tenant_id);
          return jsonResponse({ success: true, referralId: out.referralId, engine });
        } catch (e) {
          return fail(msg(e));
        }
      }

      // ── programme ──────────────────────────────────────────────────────
      case "get_program_settings": {
        const settings = await loadProgramSettings(supabase);
        const { data: defaults } = await supabase.from("referral_tiers")
          .select("id, min_active_referrals, discount_type, discount_value").is("tenant_id", null).order("min_active_referrals");
        return jsonResponse({
          settings,
          defaultTiers: ((defaults ?? []) as Array<any>).map(t => ({ ...t, discount_value: Number(t.discount_value), reward: tierRewardText({ discount_type: t.discount_type, discount_value: Number(t.discount_value) }) })),
        });
      }

      case "update_program_settings": {
        const patch: Record<string, unknown> = { updated_by: actor.id };
        if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
        if (body.refereeDiscount) {
          const parsed = parseTerms(body.refereeDiscount, { campaign: false });
          if (!parsed.ok) return fail(parsed.error);
          patch.default_referee_discount_type = parsed.terms.discount_type;
          patch.default_referee_discount_value = parsed.terms.discount_value;
          patch.default_referee_duration = parsed.terms.duration;
          patch.default_referee_duration_months = parsed.terms.duration_months;
        }
        if (body.codeSuffixLength !== undefined) {
          if (![3, 4, 6].includes(Number(body.codeSuffixLength))) return fail("Code numbers are 3, 4 or 6 digits");
          patch.code_suffix_length = Number(body.codeSuffixLength);
        }
        if (body.linkCookieDays !== undefined) {
          const days = Number(body.linkCookieDays);
          if (!Number.isInteger(days) || days < 1 || days > 365) return fail("Link memory is 1 to 365 days");
          patch.link_cookie_days = days;
        }
        const { error } = await supabase.from("referral_program_settings").update(patch).eq("id", true);
        if (error) return fail(error.message);
        if (body.defaultTiers !== undefined) {
          const parsed = parseTiers(body.defaultTiers);
          if (!parsed.ok) return fail(parsed.error);
          await supabase.from("referral_tiers").delete().is("tenant_id", null);
          const { error: tierError } = await supabase.from("referral_tiers").insert(parsed.tiers.map(t => ({ ...t, tenant_id: null })));
          if (tierError) throw new Error(tierError.message);
        }
        await logReferralEvent(supabase, { eventType: "program_settings_updated", payload: { keys: Object.keys(body) }, actor: actor.id });
        // Codes on the default terms follow the new default on the next engine run.
        const engine = await runEngine(supabase, null);
        return jsonResponse({ success: true, engine });
      }

      case "leaderboard": {
        const { data: states } = await supabase.from("referral_tier_state")
          .select("tenant_id, active_referrals, total_referrals, current_discount_type, current_discount_value, last_evaluated_at, last_error")
          .order("active_referrals", { ascending: false }).limit(200);
        const rows = (states ?? []) as Array<any>;
        const names = await tenantNames(supabase, rows.map(r => r.tenant_id));
        const saved = new Map<string, number>();
        if (rows.length) {
          const { data: savings } = await supabase.from("referral_savings").select("tenant_id, amount_off_cents").in("tenant_id", rows.map(r => r.tenant_id));
          for (const s of (savings ?? []) as Array<{ tenant_id: string; amount_off_cents: number }>) saved.set(s.tenant_id, (saved.get(s.tenant_id) ?? 0) + s.amount_off_cents);
        }
        return jsonResponse({
          leaders: rows.map(r => ({
            ...r,
            name: names.get(r.tenant_id)?.name ?? null,
            slug: names.get(r.tenant_id)?.slug ?? null,
            reward: r.current_discount_type ? tierRewardText({ discount_type: r.current_discount_type, discount_value: Number(r.current_discount_value) }) : null,
            savedCents: saved.get(r.tenant_id) ?? 0,
          })),
        });
      }

      case "run_engine":
        return jsonResponse({ engine: await runEngine(supabase, typeof body.tenantId === "string" ? body.tenantId : null) });

      // ── payment links (sales) ──────────────────────────────────────────
      case "list_for_payment_link": {
        const tenantId = String(body.tenantId ?? "");
        const { data: tenant } = await supabase.from("tenants").select("id, contact_email").eq("id", tenantId).maybeSingle();
        if (!tenant) return fail("Operator not found", 404);
        const { data } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).eq("status", "active").order("code").limit(1000);
        const rows = ((data ?? []) as Array<Record<string, unknown>>).map(toCodeRow)
          .filter(r => r.owner_tenant_id !== tenantId && (r.restrict_signup_plan_keys ?? []).length === 0)
          .filter(r => !r.expires_at || new Date(r.expires_at).getTime() > Date.now());
        const owners = await tenantNames(supabase, rows.map(r => r.owner_tenant_id ?? ""));

        // "Came via SUNSET-4821": the code a lead arrived with.
        let suggested: string | null = null;
        const email = typeof tenant.contact_email === "string" ? tenant.contact_email.replace(/"/g, "") : "";
        const { data: leads } = await supabase.from("contact_requests").select("promo_code, created_at")
          .or(`tenant_id.eq.${tenantId}${email ? `,email.eq."${email}"` : ""}`)
          .not("promo_code", "is", null).order("created_at", { ascending: false }).limit(1);
        suggested = normalizePromoCode(((leads ?? []) as Array<{ promo_code: string }>)[0]?.promo_code) ?? null;

        const { data: link } = await supabase.from("subscription_links").select("id, promo_code_id, status")
          .eq("tenant_id", tenantId).eq("status", "pending").maybeSingle();
        return jsonResponse({
          codes: rows.map(r => codeView(r, r.owner_tenant_id ? owners.get(r.owner_tenant_id) : null)),
          suggested,
          pendingLink: link ? { id: link.id, promoCodeId: link.promo_code_id } : null,
        });
      }

      case "set_link_promo": {
        const tenantId = String(body.tenantId ?? "");
        const { data: link } = await supabase.from("subscription_links").select("id, status, link_mode")
          .eq("tenant_id", tenantId).eq("status", "pending").maybeSingle();
        if (!link) return fail("This operator has no pending payment link. Generate one first.", 404);
        if (link.link_mode === "invoice") return fail("This link pays an existing invoice; a code cannot apply to it.");
        let promoCodeId: string | null = null;
        if (body.code) {
          const found = await findCode(supabase, body.code);
          if (!found.ok) return fail(`That code cannot be used (${found.reason.replace(/_/g, " ")})`);
          const usable = await checkCodeUsable(supabase, found.code, { channel: "payment_link", redeemingTenantId: tenantId });
          if (!usable.ok) return fail(`That code cannot be used here (${usable.reason.replace(/_/g, " ")})`);
          promoCodeId = found.code.id;
        }
        const { error } = await supabase.from("subscription_links").update({ promo_code_id: promoCodeId })
          .eq("id", link.id).eq("status", "pending");
        if (error) throw new Error(error.message);
        await logReferralEvent(supabase, { tenantId, eventType: promoCodeId ? "link_promo_set" : "link_promo_cleared", payload: { link_id: link.id, code: body.code ?? null }, actor: actor.id });
        return jsonResponse({ success: true });
      }

      case "search_tenants": {
        const q = typeof body.q === "string" ? body.q.trim().slice(0, 100) : "";
        let query = supabase.from("tenants").select("id, slug, company_name, status").order("company_name").limit(20);
        if (q) query = query.or(`company_name.ilike.%${q.replace(/[%,()]/g, "")}%,slug.ilike.%${q.replace(/[%,()]/g, "")}%`);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return jsonResponse({ tenants: data ?? [] });
      }

      default:
        return fail("Unknown action");
    }
  } catch (err) {
    console.error("[admin-promo-codes] failed:", msg(err));
    return fail(msg(err) || "Internal server error", 500);
  }
});
