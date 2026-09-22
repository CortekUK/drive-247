// subscription-link-v2 — ANONYMOUS. The payment-link interstitial WITH Drive247
// platform promo codes.
//
// A copy of `subscription-link` (V2_PLAN §7: never change an existing edge
// function) with exactly one addition: a promo code.
//   - the code sales pre-applied to the link (subscription_links.promo_code_id),
//   - or one the prospect types on the page ("Have a promo code?"),
// never both (one code per checkout, D11). The interstitial calls this function
// only when a code is involved; a link without one keeps using the original.
// Everything else — token handling, the frozen snapshot, every guard, trial and
// upfront arithmetic, the $1 verification line — is byte-for-byte the
// original's behaviour.
//
// The code's coupon is minted for the plan's own product (applies_to), so the
// $1 verification line and metered e-sign usage are never discounted, and it is
// stretched over any free trial so "3 months" means 3 real bills.
//
//   GET  ?token=…&info=1[&promo_code=X]   read-only JSON, now with the discount
//   POST ?token=… (form: accept_terms, promo_code?) → Checkout, 303 to Stripe
//   GET  ?token=…&done=1&session_id=cs_…  settle, then record the redemption
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";
import { PLATFORM_TOS_VERSION, PLATFORM_TOS_URL, PLATFORM_PRIVACY_URL } from "../_shared/platform-tos.ts";
import { sha256Hex, siteBaseUrl, portalBaseUrl } from "../_shared/subscription-link.ts";
import {
  checkCodeUsable,
  ensureCodeCoupon,
  findCode,
  productForPrice,
  PROMO_CODE_COLUMNS,
  publicCodeView,
  recordRedemption,
  toCodeRow,
  type CodeRejection,
  type PromoCodeRow,
} from "../_shared/platform-promo.ts";
import { normalizePromoCode } from "../_shared/platform-promo-rules.ts";

const STRIPE_TOS_CONSENT_ENABLED =
  (Deno.env.get("STRIPE_TOS_CONSENT_ENABLED") ?? "").toLowerCase() === "true";

/** Beyond this many mint attempts we stop creating sessions. Never auto-revoke:
 *  a prospect fumbling their card must not lose the link George sent. */
const MAX_MINTS = 20;

/** Refuse inside this window so a Checkout session cannot outlive its link by
 *  more than Stripe's own 30-minute floor. */
const MIN_REMAINING_MS = 5 * 60 * 1000;

type State =
  | "ready" | "expired" | "paid" | "invalid" | "plan_unavailable"
  | "price_changed" | "account_changed" | "tenant_suspended"
  | "already_subscribed" | "rate_limited";

function info(state: State, extra: Record<string, unknown> = {}, status = 200) {
  return jsonResponse({ state, tosVersion: PLATFORM_TOS_VERSION, tosUrl: PLATFORM_TOS_URL, privacyUrl: PLATFORM_PRIVACY_URL, ...extra }, status);
}

function invalidFor(isPost: boolean, token: string) {
  return isPost ? bounce(token, "invalid") : info("invalid", {}, 404);
}

function redirect(url: string) {
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
}

function bounce(token: string, state: string) {
  return redirect(`${siteBaseUrl()}/subscribe/${encodeURIComponent(token)}?err=${encodeURIComponent(state)}`);
}

function refuse(isPost: boolean, token: string, state: State, extra: Record<string, unknown> = {}, status = 200) {
  return isPost ? bounce(token, state) : info(state, extra, status);
}

/**
 * The code this checkout carries: the one sales pre-applied, or the one typed.
 * Checked with the SAME rules the page's lookup used, against this link's
 * operator — so self-referral and "new operators only" are enforced here.
 */
async function resolvePromo(
  supabase: any,
  link: { promo_code_id: string | null },
  tenantId: string,
  typed: string | null,
): Promise<{ code: PromoCodeRow | null; preApplied: boolean; error: CodeRejection | "one_code_per_checkout" | null }> {
  let code: PromoCodeRow | null = null;
  let preApplied = false;
  if (link.promo_code_id) {
    const { data } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).eq("id", link.promo_code_id).maybeSingle();
    if (data) {
      code = toCodeRow(data);
      preApplied = true;
    }
  }
  if (typed) {
    if (preApplied) {
      if (normalizePromoCode(typed) !== code!.code) return { code: null, preApplied, error: "one_code_per_checkout" };
    } else {
      const found = await findCode(supabase, typed);
      if (!found.ok) return { code: null, preApplied, error: found.reason };
      code = found.code;
    }
  }
  if (!code) return { code: null, preApplied, error: null };
  const usable = await checkCodeUsable(supabase, code, { channel: "payment_link", redeemingTenantId: tenantId });
  if (!usable.ok) return { code: null, preApplied, error: usable.reason };
  return { code, preApplied, error: null };
}

/** The first real bill after the discount, in the plan's minor units. */
function discountedAmount(amount: number, code: PromoCodeRow): number {
  if (code.discount_type === "percent") return Math.max(0, Math.round(amount * (1 - code.discount_value / 100)));
  return Math.max(0, amount - Math.round(code.discount_value * 100));
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    if (!token || token.length < 20 || token.length > 200) return info("invalid", {}, 404);

    const tokenHash = await sha256Hex(token);
    const { data: link } = await supabase
      .from("subscription_links")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!link) return invalidFor(req.method === "POST" && url.searchParams.get("info") !== "1", token);

    const now = Date.now();
    const expiresMs = new Date(link.expires_at).getTime();
    const isInfo = url.searchParams.get("info") === "1";
    const isDone = url.searchParams.get("done") === "1";
    const isPost = req.method === "POST" && !isInfo;

    // ── tenant + plan, read once ───────────────────────────────────────────
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, slug, company_name, contact_email, status, stripe_subscription_customer_id, subscription_billing_anchor, subscription_stripe_mode, subscription_account")
      .eq("id", link.tenant_id)
      .maybeSingle();
    if (!tenant) return invalidFor(isPost, token);

    const portalUrl = portalBaseUrl(tenant.slug);

    if (link.status === "revoked" || link.status === "superseded") return invalidFor(isPost, token);

    // ══════════════════════════════════════════════════════════════════════
    // DONE — Stripe has redirected the payer back to us.
    // ══════════════════════════════════════════════════════════════════════
    if (isDone) {
      const sessionId = url.searchParams.get("session_id") ?? "";
      if (!sessionId) return info("invalid", {}, 404);
      try {
        const stripe = getSubscriptionStripeClientForAccount(
          link.stripe_account_snapshot as "uk" | "uae",
          link.stripe_mode_snapshot as "test" | "live",
        );
        const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

        if (session.metadata?.subscription_link_id !== link.id) {
          return info("invalid", {}, 404);
        }

        const sub = session.subscription as Record<string, any> | string | null;
        const subId = typeof sub === "string" ? sub : sub?.id ?? null;
        const subStatus = typeof sub === "object" && sub ? sub.status : null;

        if (subId && ["active", "trialing", "past_due"].includes(String(subStatus))) {
          const { data: settled } = await supabase.rpc("settle_subscription_link", {
            p_link_id: link.id, p_source: "success_page", p_stripe_subscription_id: subId,
          });
          if (settled === false) {
            await supabase.from("subscription_links")
              .update({ awaiting_subscription_row_since: new Date().toISOString() })
              .eq("id", link.id).is("awaiting_subscription_row_since", null);
          }

          // The promo code this checkout carried. Recorded here for an instant
          // tier update; the referral engine's discovery pass records it anyway
          // if this step is ever missed, and both paths are idempotent.
          const promoId = session.metadata?.d247_promo_code_id;
          if (promoId) {
            try {
              const { data: row } = await supabase.from("platform_promo_codes").select(PROMO_CODE_COLUMNS).eq("id", promoId).maybeSingle();
              if (row) {
                const code = toCodeRow(row);
                const full = await stripe.subscriptions.retrieve(subId, { expand: ["discounts"] });
                const ours = ((full as any).discounts ?? []).find(
                  (d: any) => typeof d === "object" && d?.coupon?.metadata?.d247_promo_code_id === code.id,
                );
                const { referralId } = await recordRedemption(supabase, {
                  code,
                  tenantId: tenant.id,
                  subscriptionId: subId,
                  account: link.stripe_account_snapshot === "uae" ? "uae" : "uk",
                  mode: link.stripe_mode_snapshot === "live" ? "live" : "test",
                  discountEndsAt: ours?.end ? new Date(ours.end * 1000).toISOString() : null,
                  source: "payment_link",
                });
                // D8: the referrer's tier moves as soon as the referee subscribes.
                if (referralId && code.owner_tenant_id) {
                  const kick = supabase.functions.invoke("referral-engine", { body: { tenantId: code.owner_tenant_id } })
                    .catch((e: unknown) => console.error("[subscription-link-v2] engine kick failed:", e));
                  // Keep the isolate alive past the response where the runtime
                  // supports it; the cron run is the backstop either way.
                  const rt = (globalThis as any).EdgeRuntime;
                  if (rt?.waitUntil) rt.waitUntil(kick);
                }
              }
            } catch (e) {
              // Never show a paying customer an error because of our bookkeeping.
              console.error("[subscription-link-v2] promo redemption not recorded yet:", e);
            }
          }
          return info("paid", { portalUrl, companyName: tenant.company_name });
        }

        if (String(subStatus) === "incomplete") {
          await supabase.from("subscription_links")
            .update({ payment_attempted_at: new Date().toISOString(), last_failure_reason: "subscription_incomplete" })
            .eq("id", link.id).eq("status", "pending");
          return info("ready", { portalUrl, declined: true, companyName: tenant.company_name,
            planName: link.plan_name_snapshot, amount: link.amount_snapshot,
            currency: link.currency_snapshot, interval: link.interval_snapshot,
            expiresAt: link.expires_at });
        }

        return info("ready", {
          portalUrl, companyName: tenant.company_name,
          planName: link.plan_name_snapshot, amount: link.amount_snapshot,
          currency: link.currency_snapshot, interval: link.interval_snapshot,
          expiresAt: link.expires_at, incomplete: true,
        });
      } catch (e) {
        console.error("[subscription-link-v2] done handler failed:", e);
        if (link.status === "paid") {
          return info("paid", { portalUrl, companyName: tenant.company_name });
        }
        return info("invalid", {}, 404);
      }
    }

    // ── guards, in order, shared by info and mint ──────────────────────────
    if (link.status === "paid") return refuse(isPost, token, "paid", { portalUrl, companyName: tenant.company_name });

    if (expiresMs < now) {
      if (link.status === "pending") {
        await supabase.from("subscription_links")
          .update({ status: "expired", expired_at: new Date().toISOString() })
          .eq("id", link.id).eq("status", "pending");
      }
      return refuse(isPost, token, "expired", { portalUrl, companyName: tenant.company_name });
    }
    if (link.status === "expired") return refuse(isPost, token, "expired", { portalUrl, companyName: tenant.company_name });

    if (tenant.status === "suspended") return refuse(isPost, token, "tenant_suspended", { portalUrl });

    const { data: liveSubs } = await supabase
      .from("tenant_subscriptions")
      .select("id, status, stripe_subscription_id")
      .eq("tenant_id", tenant.id)
      .not("status", "in", "(canceled,incomplete_expired)");
    const liveSub = (liveSubs ?? [])[0];

    const trulySubscribed = liveSub && ["active", "trialing", "past_due"].includes(liveSub.status);
    if (trulySubscribed && link.link_mode !== "invoice") {
      return refuse(isPost, token, "already_subscribed", { portalUrl, companyName: tenant.company_name });
    }

    let plan: Record<string, any> | null = null;
    if (link.link_mode !== "invoice") {
      if (!link.plan_id) return refuse(isPost, token, "plan_unavailable", { portalUrl, companyName: tenant.company_name });
      const { data: p } = await supabase
        .from("subscription_plans")
        .select("id, name, stripe_price_id, tenant_id, is_active, trial_days, amount, currency, interval, billing_model, stripe_account")
        .eq("id", link.plan_id)
        .maybeSingle();
      if (!p || p.tenant_id !== tenant.id || !p.is_active || !p.stripe_price_id) {
        return refuse(isPost, token, "plan_unavailable", { portalUrl, companyName: tenant.company_name });
      }
      plan = p;

      const liveMode = tenant.subscription_stripe_mode || "test";
      const liveAccount = tenant.subscription_account === "uae" ? "uae" : "uk";
      if (liveMode !== link.stripe_mode_snapshot || liveAccount !== link.stripe_account_snapshot) {
        return refuse(isPost, token, "account_changed", { portalUrl, companyName: tenant.company_name });
      }

      const drifted =
        (p.amount ?? 0) !== link.amount_snapshot ||
        (p.currency || "usd").toLowerCase() !== link.currency_snapshot ||
        (p.interval || "month") !== link.interval_snapshot ||
        p.stripe_price_id !== link.stripe_price_id_snapshot;
      if (drifted) return refuse(isPost, token, "price_changed", { portalUrl, companyName: tenant.company_name });
    }

    if (link.mint_count >= MAX_MINTS) {
      if (req.method === "POST" && !isInfo) {
        await supabase.from("subscription_links")
          .update({ rate_limited_at: new Date().toISOString() })
          .eq("id", link.id).is("rate_limited_at", null);
      }
      return refuse(isPost, token, "rate_limited", { portalUrl, companyName: tenant.company_name });
    }

    // ══════════════════════════════════════════════════════════════════════
    // INFO — read-only. Nothing is created, nothing is stamped.
    // ══════════════════════════════════════════════════════════════════════
    if (isInfo || req.method === "GET") {
      if (expiresMs - now < MIN_REMAINING_MS) {
        return info("expired", { portalUrl, companyName: tenant.company_name, aboutToExpire: true });
      }
      const trialDays = link.trial_days_snapshot ?? 0;
      const isUpfront = link.billing_model_snapshot === "upfront_monthly";
      const chargeToday = !(isUpfront || trialDays > 0);

      // Invoice-mode links pay an invoice Stripe already priced: no code applies.
      let promo: Record<string, unknown> | null = null;
      let promoError: string | null = null;
      if (link.link_mode !== "invoice") {
        const typed = url.searchParams.get("promo_code");
        const resolved = await resolvePromo(supabase, link, tenant.id, typed && typed.trim() ? typed : null);
        if (resolved.error) promoError = resolved.error;
        if (resolved.code) {
          promo = {
            ...(await publicCodeView(supabase, resolved.code)),
            preApplied: resolved.preApplied,
            discountedAmount: discountedAmount(link.amount_snapshot ?? 0, resolved.code),
          };
        }
      }

      return info("ready", {
        portalUrl,
        companyName: tenant.company_name,
        planName: link.plan_name_snapshot,
        amount: link.amount_snapshot,
        currency: link.currency_snapshot,
        interval: link.interval_snapshot,
        trialDays,
        chargeToday,
        linkMode: link.link_mode,
        expiresAt: link.expires_at,
        declined: !!link.payment_attempted_at,
        promo,
        promoError,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // MINT — POST only, from our own interstitial form.
    // ══════════════════════════════════════════════════════════════════════
    if (req.method !== "POST") return info("invalid", { portalUrl }, 405);

    if (expiresMs - now < MIN_REMAINING_MS) return bounce(token, "expired");

    const form = await req.formData().catch(() => null);
    const accepted = form?.get("accept_terms");
    if (!accepted) return bounce(token, "terms");

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent") ?? null;
    const nowIso = new Date().toISOString();

    // ── invoice mode: straight to the invoice Stripe already priced ────────
    if (link.link_mode === "invoice") {
      const { data: inv } = await supabase
        .from("tenant_subscription_invoices")
        .select("stripe_hosted_invoice_url, status")
        .eq("id", link.invoice_url_ref)
        .maybeSingle();
      if (!inv?.stripe_hosted_invoice_url) return bounce(token, "plan_unavailable");
      await supabase.from("subscription_links").update({
        mint_count: (link.mint_count ?? 0) + 1,
        first_started_at: link.first_started_at ?? nowIso,
        last_started_at: nowIso,
        tos_version: PLATFORM_TOS_VERSION,
        tos_accepted_at: link.tos_accepted_at ?? nowIso,
        tos_accepted_ip: ip, tos_accepted_user_agent: ua,
      }).eq("id", link.id);
      return redirect(inv.stripe_hosted_invoice_url);
    }

    // ── the promo code, re-checked at the moment of payment ────────────────
    const typedRaw = form?.get("promo_code");
    const typed = typeof typedRaw === "string" && typedRaw.trim() ? typedRaw.trim() : null;
    const promo = await resolvePromo(supabase, link, tenant.id, typed);
    if (promo.error) return bounce(token, promo.error === "one_code_per_checkout" ? "promo_one_code" : "promo_invalid");

    const account = link.stripe_account_snapshot as "uk" | "uae";
    const mode = link.stripe_mode_snapshot as "test" | "live";
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    if (link.last_session_id && link.last_session_expires_at && new Date(link.last_session_expires_at).getTime() > now) {
      try {
        await stripe.checkout.sessions.expire(link.last_session_id);
      } catch (_e) { /* already complete or gone — both fine */ }
    }

    const isUpfrontMonthly = link.billing_model_snapshot === "upfront_monthly";
    const trialDays = link.trial_days_snapshot ?? 0;
    let trialEndTs: number | null = null;
    if (isUpfrontMonthly) {
      const anchor = tenant.subscription_billing_anchor
        ? new Date(`${tenant.subscription_billing_anchor}T00:00:00Z`)
        : new Date();
      const firstCharge = new Date(anchor);
      firstCharge.setUTCMonth(firstCharge.getUTCMonth() + 1);
      while (firstCharge.getTime() <= now + 60_000) firstCharge.setUTCMonth(firstCharge.getUTCMonth() + 1);
      trialEndTs = Math.floor(firstCharge.getTime() / 1000);
    }
    const chargesDeferredToday = !!trialEndTs || trialDays > 0;

    const lineItems: Array<Record<string, unknown>> = [{ price: link.stripe_price_id_snapshot, quantity: 1 }];
    if (chargesDeferredToday) {
      lineItems.push({
        price_data: {
          currency: link.currency_snapshot,
          product_data: { name: "Card verification — $1.00, refunded instantly (net $0 today)" },
          unit_amount: 100,
        },
        quantity: 1,
      });
    }

    // The code's coupon, for this plan's product only, stretched over any trial.
    let promoDiscounts: Array<{ coupon: string }> = [];
    if (promo.code) {
      const deferredDays = trialEndTs
        ? Math.max(0, Math.ceil((trialEndTs * 1000 - now) / 86_400_000))
        : trialDays;
      const productId = await productForPrice(stripe as never, link.stripe_price_id_snapshot);
      const { couponId } = await ensureCodeCoupon(supabase, stripe as never, promo.code, {
        account, mode, productId, trialDays: deferredDays,
      });
      promoDiscounts = [{ coupon: couponId }];
    }

    const meteredPriceId = account === "uae"
      ? (mode === "live" ? Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_LIVE") : Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_TEST"))
      : (mode === "live" ? Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_LIVE")
                         : (Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_TEST") || Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID")));

    let existingCustomerId: string | null = tenant.stripe_subscription_customer_id || null;
    if (existingCustomerId) {
      try {
        const existing = await stripe.customers.retrieve(existingCustomerId);
        if ((existing as { deleted?: boolean }).deleted) existingCustomerId = null;
      } catch (_e) { existingCustomerId = null; }
    }

    const sessionExpires = Math.floor(
      Math.min(Math.max(expiresMs, now + 30 * 60_000), now + 24 * 60 * 60_000) / 1000,
    );

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(existingCustomerId ? { customer: existingCustomerId } : { customer_email: tenant.contact_email }),
      line_items: lineItems as never,
      ...(promoDiscounts.length ? { discounts: promoDiscounts } : {}),
      expires_at: sessionExpires,
      // `v=2` sends the done page back HERE, so the code is recorded at once
      // (the referral engine would find it on its next run regardless).
      success_url: `${siteBaseUrl()}/subscribe/${token}/done?session_id={CHECKOUT_SESSION_ID}&v=2`,
      cancel_url: `${siteBaseUrl()}/subscribe/${token}?cancelled=1`,
      ...(STRIPE_TOS_CONSENT_ENABLED ? { consent_collection: { terms_of_service: "required" as const } } : {}),
      metadata: {
        tenant_id: tenant.id,
        plan_id: String(link.plan_id),
        plan_name: link.plan_name_snapshot,
        source: "platform_subscription",
        subscription_link_id: link.id,
        tos_version: PLATFORM_TOS_VERSION,
        tos_actor: "operator",
        tos_accepted_in_app: "true",
        ...(chargesDeferredToday ? { setup_fee: "true" } : {}),
        ...(meteredPriceId ? { esign_metered_price_id: meteredPriceId } : {}),
        ...(promo.code ? { d247_promo_code_id: promo.code.id, d247_promo_code: promo.code.code } : {}),
      },
      subscription_data: {
        metadata: {
          tenant_id: tenant.id,
          plan_id: String(link.plan_id),
          plan_name: link.plan_name_snapshot,
          billing_model: link.billing_model_snapshot,
          subscription_link_id: link.id,
          ...(promo.code ? { d247_promo_code_id: promo.code.id, d247_promo_code: promo.code.code } : {}),
        },
        ...(trialEndTs ? { trial_end: trialEndTs } : trialDays > 0 ? { trial_period_days: trialDays } : {}),
      },
    });

    await supabase.from("subscription_links").update({
      mint_count: (link.mint_count ?? 0) + 1,
      first_started_at: link.first_started_at ?? nowIso,
      last_started_at: nowIso,
      last_session_id: session.id,
      last_session_expires_at: new Date(sessionExpires * 1000).toISOString(),
      tos_version: PLATFORM_TOS_VERSION,
      tos_accepted_at: link.tos_accepted_at ?? nowIso,
      tos_accepted_ip: ip,
      tos_accepted_user_agent: ua,
    }).eq("id", link.id);

    if (!session.url) return bounce(token, "stripe");
    return redirect(session.url);
  } catch (err) {
    console.error("[subscription-link-v2] failed:", err);
    try {
      const u = new URL(req.url);
      const t = u.searchParams.get("token");
      if (req.method === "POST" && t) return bounce(t, "unavailable");
    } catch { /* fall through to JSON */ }
    return jsonResponse({ state: "invalid", error: "Something went wrong. Ask for a fresh link." }, 500);
  }
});
