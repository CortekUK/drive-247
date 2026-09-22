// tenant-referrals — the operator's Referrals page. JWT on; staff of the tenant
// (or a super admin) only, via the shared membership check.
//
// POST { tenantId, action?: "get" }
//   -> the operator's code and link, what a new operator gets, their tier and
//      the next one, who they referred and whether each still counts, what they
//      have saved, and — if they joined with a code — the discount they got and
//      how many bills it has left.
// POST { tenantId, action: "claim", businessName, contact?, note? }
//   -> "someone joined because of me" (brief R6): a claim in super admin's queue.
//
// Every query is filtered by the caller's tenant (V2_PLAN §5).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authorizeTenantAccess } from "../_shared/tenant-auth.ts";
import {
  computeReferrerStanding,
  ensureReferralCode,
  liveSubscriptionOf,
  loadProgramSettings,
  logReferralEvent,
  PROMO_CODE_COLUMNS,
  referralLink,
  toCodeRow,
} from "../_shared/platform-promo.ts";
import {
  discountText,
  durationText,
  isLiveSubscriptionStatus,
  nextTier,
  tierRewardText,
} from "../_shared/platform-promo-rules.ts";

/** Test tenants see the programme only when allow-listed (keyed on slug). */
const TEST_TENANT_ALLOWLIST: readonly string[] = ["northwind", "test"];

/** Monthly bills still to come inside a discount window. */
function billsLeft(nextBill: string | null, discountEndsAt: string | null): number | null {
  if (!nextBill || !discountEndsAt) return null;
  const end = new Date(discountEndsAt).getTime();
  const cursor = new Date(nextBill);
  let n = 0;
  while (cursor.getTime() < end && n < 60) {
    n++;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return n;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
    if (!tenantId) return errorResponse("tenantId is required");
    const access = await authorizeTenantAccess(supabase, user.id, tenantId);
    if (!access.ok) return errorResponse(access.message, access.status);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, slug, company_name, status, tenant_type")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return errorResponse("Tenant not found", 404);

    const settings = await loadProgramSettings(supabase);
    const { data: prefs } = await supabase
      .from("tenant_referral_settings")
      .select("referrals_enabled")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const inScope = tenant.tenant_type !== "test" || TEST_TENANT_ALLOWLIST.includes(tenant.slug);
    const enabled = settings.enabled && inScope && prefs?.referrals_enabled !== false;

    // ── "someone joined because of me" ────────────────────────────────────
    if (body.action === "claim") {
      if (!enabled) return errorResponse("The referral programme is not available for this account", 409);
      const businessName = typeof body.businessName === "string" ? body.businessName.trim().slice(0, 200) : "";
      if (businessName.length < 2) return errorResponse("Please enter the business name");
      const contact = typeof body.contact === "string" ? body.contact.trim().slice(0, 200) || null : null;
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
      const { data: claim, error } = await supabase
        .from("referral_claims")
        .insert({
          referrer_tenant_id: tenantId,
          claimed_business_name: businessName,
          claimed_contact: contact,
          note,
          created_by: access.appUser.id,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await logReferralEvent(supabase, {
        tenantId, eventType: "claim_created", payload: { claim_id: claim.id, business: businessName }, actor: access.appUser.id,
      });
      return jsonResponse({ success: true, claimId: claim.id });
    }

    // ── the page ─────────────────────────────────────────────────────────
    const live = await liveSubscriptionOf(supabase, tenantId);

    // Their own code. Made here on first view if the engine has not run since
    // they subscribed, so the page never shows an operator an empty space.
    let codeRow = null;
    if (enabled && (live || TEST_TENANT_ALLOWLIST.includes(tenant.slug)) && tenant.status !== "suspended") {
      codeRow = await ensureReferralCode(supabase, tenant, settings);
    } else {
      const { data } = await supabase
        .from("platform_promo_codes")
        .select(PROMO_CODE_COLUMNS)
        .eq("owner_tenant_id", tenantId).eq("kind", "referral").eq("status", "active")
        .maybeSingle();
      codeRow = data ? toCodeRow(data) : null;
    }

    const standing = await computeReferrerStanding(supabase, tenantId);
    const next = nextTier(standing.tiers, standing.activeReferrals);

    // Who they referred, and whether each still counts toward the tier.
    const { data: refs } = await supabase
      .from("referrals")
      .select("id, referred_tenant_id, referred_name_snapshot, source, status, attributed_at")
      .eq("referrer_tenant_id", tenantId)
      .eq("status", "active")
      .order("attributed_at", { ascending: false });
    const refereeIds = ((refs ?? []) as Array<{ referred_tenant_id: string }>).map(r => r.referred_tenant_id);
    const liveReferees = new Set<string>();
    if (refereeIds.length) {
      const { data: subs } = await supabase
        .from("tenant_subscriptions")
        .select("tenant_id, status")
        .in("tenant_id", refereeIds);
      for (const s of (subs ?? []) as Array<{ tenant_id: string; status: string }>) {
        if (isLiveSubscriptionStatus(s.status)) liveReferees.add(s.tenant_id);
      }
    }

    const { data: savings } = await supabase
      .from("referral_savings")
      .select("amount_off_cents")
      .eq("tenant_id", tenantId);
    const savedCents = ((savings ?? []) as Array<{ amount_off_cents: number }>)
      .reduce((sum, s) => sum + (s.amount_off_cents || 0), 0);

    // If they joined with a code: what they got, and for how long.
    let joinedWith = null;
    const { data: redemption } = await supabase
      .from("promo_code_redemptions")
      .select("discount_snapshot, discount_ends_at, redeemed_at")
      .eq("tenant_id", tenantId)
      .order("redeemed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (redemption) {
      const snap = redemption.discount_snapshot as Record<string, any>;
      const { data: myReferral } = await supabase
        .from("referrals")
        .select("referrer_name_snapshot")
        .eq("referred_tenant_id", tenantId)
        .eq("status", "active")
        .maybeSingle();
      const endsAt = redemption.discount_ends_at as string | null;
      joinedWith = {
        code: snap.code ?? null,
        referrerName: snap.kind === "referral" ? myReferral?.referrer_name_snapshot ?? null : null,
        discountText: discountText(snap.discount_type, Number(snap.discount_value), snap.currency ?? "usd"),
        durationText: durationText(snap.duration, snap.duration_months ?? null),
        endsAt,
        active: endsAt ? new Date(endsAt).getTime() > Date.now() : snap.duration === "forever",
        billsLeft: billsLeft(live?.current_period_end ?? null, endsAt),
      };
    }

    const { data: claims } = await supabase
      .from("referral_claims")
      .select("id, claimed_business_name, status, created_at")
      .eq("referrer_tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20);

    return jsonResponse({
      enabled,
      subscribed: !!live,
      code: codeRow ? { code: codeRow.code, link: referralLink(codeRow.code) } : null,
      refereeOffer: codeRow
        ? { discountText: discountText(codeRow.discount_type, codeRow.discount_value, codeRow.currency), durationText: durationText(codeRow.duration, codeRow.duration_months) }
        : null,
      standing: {
        activeReferrals: standing.activeReferrals,
        totalReferrals: standing.totalReferrals,
        reward: standing.tier ? tierRewardText(standing.tier) : null,
        next: next ? { needed: next.needed, reward: tierRewardText(next.tier) } : null,
        tiers: standing.tiers.map(t => ({ min: t.min_active_referrals, reward: tierRewardText(t) })),
        customTiers: standing.customTiers,
      },
      referrals: ((refs ?? []) as Array<{ id: string; referred_tenant_id: string; referred_name_snapshot: string; source: string; attributed_at: string }>)
        .map(r => ({
          id: r.id,
          name: r.referred_name_snapshot,
          counts: liveReferees.has(r.referred_tenant_id),
          source: r.source,
          since: r.attributed_at,
        })),
      savedCents,
      joinedWith,
      claims: claims ?? [],
    });
  } catch (err) {
    console.error("[tenant-referrals] failed:", (err as { message?: string })?.message ?? err);
    return errorResponse("Could not load your referrals right now", 500);
  }
});
