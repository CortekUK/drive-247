// subscription-link — ANONYMOUS. The prospect has no Supabase session.
//
// Authorisation is a 256-bit token resolved against a stored sha256 hash, and
// NOTHING about the charge is caller-supplied: amount, currency, interval, price
// id, Stripe account and mode are all read back from the row that was frozen when
// George generated the link, and every one of them is re-verified against live
// config before a session is created. If any has drifted the link REFUSES rather
// than charging a number nobody quoted.
//
// Three entry points, all on the same token:
//   GET  ?token=…&info=1                 → read-only JSON for the interstitial.
//                                          Creates NOTHING in Stripe.
//   POST ?token=…                        → mint a Checkout session, 303 to Stripe.
//   GET  ?token=…&done=1&session_id=cs_… → settle after Stripe redirects back.
//
// Why minting is POST-only: chat unfurlers and mail scanners GET every pasted
// URL. If a GET minted a session, Google Chat's preview would burn the link
// before the prospect ever clicked it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse } from "../_shared/cors.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";
import { PLATFORM_TOS_VERSION, PLATFORM_TOS_URL, PLATFORM_PRIVACY_URL } from "../_shared/platform-tos.ts";
import { sha256Hex, siteBaseUrl, portalBaseUrl } from "../_shared/subscription-link.ts";

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

/** Everything that is not a live link collapses to a byte-identical `invalid`,
 *  so the endpoint is not an oracle for which tokens ever existed. */
function invalid() {
  return info("invalid", {}, 404);
}

function redirect(url: string) {
  return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
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
    if (!token || token.length < 20 || token.length > 200) return invalid();

    const tokenHash = await sha256Hex(token);
    const { data: link } = await supabase
      .from("subscription_links")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (!link) return invalid();

    const now = Date.now();
    const expiresMs = new Date(link.expires_at).getTime();
    const isInfo = url.searchParams.get("info") === "1";
    const isDone = url.searchParams.get("done") === "1";

    // ── tenant + plan, read once ───────────────────────────────────────────
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, slug, company_name, contact_email, status, stripe_subscription_customer_id, subscription_billing_anchor, subscription_stripe_mode, subscription_account")
      .eq("id", link.tenant_id)
      .maybeSingle();
    if (!tenant) return invalid();

    const portalUrl = portalBaseUrl(tenant.slug);

    // Collapse the dead states BEFORE anything else, `done` included. Testing
    // showed the done path sat above these guards, so a revoked or superseded
    // token still answered 403-with-portalUrl while an unknown token answered
    // 404-without — a difference an attacker can measure, and one that also
    // disclosed the tenant's slug.

    // ══════════════════════════════════════════════════════════════════════
    // DONE — Stripe has redirected the payer back to us.
    // ══════════════════════════════════════════════════════════════════════
    if (isDone) {
      const sessionId = url.searchParams.get("session_id") ?? "";
      if (!sessionId) return info("invalid", { portalUrl }, 400);
      try {
        const stripe = getSubscriptionStripeClientForAccount(
          link.stripe_account_snapshot as "uk" | "uae",
          link.stripe_mode_snapshot as "test" | "live",
        );
        const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

        // The session id in the URL is never trusted on its own — it must be a
        // session WE minted for THIS link.
        if (session.metadata?.subscription_link_id !== link.id) {
          return invalid();
        }

        const sub = session.subscription as Record<string, any> | string | null;
        const subId = typeof sub === "string" ? sub : sub?.id ?? null;
        const subStatus = typeof sub === "object" && sub ? sub.status : null;

        if (subId && ["active", "trialing", "past_due"].includes(String(subStatus))) {
          const { data: settled } = await supabase.rpc("settle_subscription_link", {
            p_link_id: link.id, p_source: "success_page", p_stripe_subscription_id: subId,
          });
          if (settled === false) {
            // Money is at Stripe but our subscription row has not landed yet.
            // Never show a paying customer an error because our webhook is slow.
            await supabase.from("subscription_links")
              .update({ awaiting_subscription_row_since: new Date().toISOString() })
              .eq("id", link.id).is("awaiting_subscription_row_since", null);
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

        // No subscription on the session at all: the checkout was opened and
        // abandoned, so nothing was paid. Saying "paid" here was a straight lie
        // to the payer — reachable by anyone who minted a session and then hit
        // this URL without entering a card. Send them back to finish instead.
        return info("ready", {
          portalUrl, companyName: tenant.company_name,
          planName: link.plan_name_snapshot, amount: link.amount_snapshot,
          currency: link.currency_snapshot, interval: link.interval_snapshot,
          expiresAt: link.expires_at, incomplete: true,
        });
      } catch (e) {
        console.error("[subscription-link] done handler failed:", e);
        // Two very different failures land here and they must not be conflated.
        //
        //  · The link is ALREADY paid and we merely failed to re-read Stripe —
        //    a transient error on our side is not the payer's problem, so say
        //    paid, because it is true.
        //  · The session id is not one of ours (made up, or from another link).
        //    Saying "paid" there would be a false claim to an anonymous caller
        //    about a link that has not been paid at all.
        if (link.status === "paid") {
          return info("paid", { portalUrl, companyName: tenant.company_name });
        }
        return invalid();
      }
    }

    // ── guards, in order, shared by info and mint ──────────────────────────
    if (link.status === "paid") return info("paid", { portalUrl, companyName: tenant.company_name });
    if (link.status === "revoked" || link.status === "superseded") return invalid();

    if (expiresMs < now) {
      // Lazy expiry: the link expires when someone looks, not only when cron runs.
      if (link.status === "pending") {
        await supabase.from("subscription_links")
          .update({ status: "expired", expired_at: new Date().toISOString() })
          .eq("id", link.id).eq("status", "pending");
      }
      return info("expired", { portalUrl, companyName: tenant.company_name });
    }
    if (link.status === "expired") return info("expired", { portalUrl, companyName: tenant.company_name });

    if (tenant.status === "suspended") return info("tenant_suspended", { portalUrl });

    // Non-terminal subscription: a second live subscription is physically
    // impossible (idx_tenant_subscriptions_active), so never mint one.
    const { data: liveSubs } = await supabase
      .from("tenant_subscriptions")
      .select("id, status, stripe_subscription_id")
      .eq("tenant_id", tenant.id)
      .not("status", "in", "(canceled,incomplete_expired)");
    const liveSub = (liveSubs ?? [])[0];

    // Only a LIVE subscription means "already subscribed". An 'incomplete' or
    // 'unpaid' row does NOT — Stripe creates the subscription object before the
    // payment confirms, so a failed 3-D Secure challenge leaves one behind while
    // the customer has paid nothing.
    //
    // Verified live: a failed 3DS produced exactly that row, and treating it as
    // "already subscribed" STRANDED the prospect — the link George had just sent
    // them refused to let them try again, and they were not subscribed either.
    // On a sales call that is a dead end. Stripe keeps an incomplete
    // subscription payable for ~23h and expires it by itself, so letting them
    // retry is both safe and the only humane behaviour.
    const trulySubscribed = liveSub && ["active", "trialing", "past_due"].includes(liveSub.status);
    if (trulySubscribed && link.link_mode !== "invoice") {
      // They already paid — most likely through this very link, via a webhook
      // that landed before the browser came back. Settle and say so.
      // NOT `.rpc(...).catch(...)`: rpc() returns a PostgrestFilterBuilder, which
      // is a thenable with no .catch method, so that form threw a TypeError and
      // turned this whole branch into a 500. It made 'already_subscribed'
      // unreachable and left this settler dead.
      try {
        await supabase.rpc("settle_subscription_link", {
          p_link_id: link.id, p_source: "success_page",
          p_stripe_subscription_id: liveSub.stripe_subscription_id,
        });
      } catch (e) {
        console.error("[subscription-link] settle on already-subscribed failed:", e);
      }
      return info("already_subscribed", { portalUrl, companyName: tenant.company_name });
    }

    // Plan checks. A deleted plan nulls plan_id (ON DELETE SET NULL) so that
    // "Delete plan" keeps working; redemption refuses, which is the safe side.
    let plan: Record<string, any> | null = null;
    if (link.link_mode !== "invoice") {
      if (!link.plan_id) return info("plan_unavailable", { portalUrl, companyName: tenant.company_name });
      const { data: p } = await supabase
        .from("subscription_plans")
        .select("id, name, stripe_price_id, tenant_id, is_active, trial_days, amount, currency, interval, billing_model, stripe_account")
        .eq("id", link.plan_id)
        .maybeSingle();
      if (!p || p.tenant_id !== tenant.id || !p.is_active || !p.stripe_price_id) {
        return info("plan_unavailable", { portalUrl, companyName: tenant.company_name });
      }
      plan = p;

      // The account/mode must still be the ones we froze. A tenant flipped from
      // test to live between generation and click must not be charged for real
      // against a link quoted in test.
      const liveMode = tenant.subscription_stripe_mode || "test";
      const liveAccount = tenant.subscription_account === "uae" ? "uae" : "uk";
      if (liveMode !== link.stripe_mode_snapshot || liveAccount !== link.stripe_account_snapshot) {
        return info("account_changed", { portalUrl, companyName: tenant.company_name });
      }

      // The offer must still be the one George quoted out loud.
      const drifted =
        (p.amount ?? 0) !== link.amount_snapshot ||
        (p.currency || "usd").toLowerCase() !== link.currency_snapshot ||
        (p.interval || "month") !== link.interval_snapshot ||
        p.stripe_price_id !== link.stripe_price_id_snapshot;
      if (drifted) return info("price_changed", { portalUrl, companyName: tenant.company_name });
    }

    // Report the cap on both paths, but only STAMP it on the path that would
    // actually have minted. `info` is documented as read-only and a chat
    // unfurler's GET must not write to the row.
    if (link.mint_count >= MAX_MINTS) {
      if (req.method === "POST" && !isInfo) {
        await supabase.from("subscription_links")
          .update({ rate_limited_at: new Date().toISOString() })
          .eq("id", link.id).is("rate_limited_at", null);
      }
      return info("rate_limited", { portalUrl, companyName: tenant.company_name });
    }

    // ══════════════════════════════════════════════════════════════════════
    // INFO — read-only. Nothing is created, nothing is stamped.
    // ══════════════════════════════════════════════════════════════════════
    if (isInfo || req.method === "GET") {
      // The mint guard below refuses inside the last few minutes. Saying "ready"
      // here produced a page whose only button dead-ends, so apply the same
      // clock to what we advertise.
      if (expiresMs - now < MIN_REMAINING_MS) {
        return info("expired", { portalUrl, companyName: tenant.company_name, aboutToExpire: true });
      }
      const trialDays = link.trial_days_snapshot ?? 0;
      const isUpfront = link.billing_model_snapshot === "upfront_monthly";
      const chargeToday = !(isUpfront || trialDays > 0);
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
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // MINT — POST only, from our own interstitial form.
    // ══════════════════════════════════════════════════════════════════════
    if (req.method !== "POST") return info("invalid", { portalUrl }, 405);

    if (expiresMs - now < MIN_REMAINING_MS) {
      return info("expired", { portalUrl, companyName: tenant.company_name, aboutToExpire: true });
    }

    const form = await req.formData().catch(() => null);
    const accepted = form?.get("accept_terms");
    if (!accepted) {
      return info("ready", {
        portalUrl, companyName: tenant.company_name, planName: link.plan_name_snapshot,
        amount: link.amount_snapshot, currency: link.currency_snapshot,
        interval: link.interval_snapshot, expiresAt: link.expires_at,
        error: "Please accept the terms to continue.",
      }, 400);
    }

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
      if (!inv?.stripe_hosted_invoice_url) return info("plan_unavailable", { portalUrl });
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

    const account = link.stripe_account_snapshot as "uk" | "uae";
    const mode = link.stripe_mode_snapshot as "test" | "live";
    const stripe = getSubscriptionStripeClientForAccount(account, mode);

    // At most ONE payable session per link at any instant. Without this a
    // prospect who opened the link twice could pay twice, the webhook would hit
    // idx_tenant_subscriptions_active, 23505, throw, 500 — and Stripe would
    // retry for three days while they were double-billed.
    if (link.last_session_id && link.last_session_expires_at && new Date(link.last_session_expires_at).getTime() > now) {
      try {
        await stripe.checkout.sessions.expire(link.last_session_id);
      } catch (_e) { /* already complete or gone — both fine */ }
    }

    // Trial / upfront anchor arithmetic — mirrors create-subscription-checkout.
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

    const meteredPriceId = account === "uae"
      ? (mode === "live" ? Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_LIVE") : Deno.env.get("STRIPE_UAE_ESIGN_METERED_PRICE_ID_TEST"))
      : (mode === "live" ? Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_LIVE")
                         : (Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID_TEST") || Deno.env.get("STRIPE_ESIGN_METERED_PRICE_ID")));

    // A customer id belongs to ONE Stripe account; drop a foreign one rather
    // than handing Stripe a "No such customer".
    let existingCustomerId: string | null = tenant.stripe_subscription_customer_id || null;
    if (existingCustomerId) {
      try {
        const existing = await stripe.customers.retrieve(existingCustomerId);
        if ((existing as Record<string, unknown>)?.deleted) existingCustomerId = null;
      } catch (_e) { existingCustomerId = null; }
    }

    // Never let a session outlive its link by more than Stripe's 30-minute floor.
    const sessionExpires = Math.floor(
      Math.min(Math.max(expiresMs, now + 30 * 60_000), now + 24 * 60 * 60_000) / 1000,
    );

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(existingCustomerId ? { customer: existingCustomerId } : { customer_email: tenant.contact_email }),
      line_items: lineItems as never,
      expires_at: sessionExpires,
      success_url: `${siteBaseUrl()}/subscribe/${token}/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteBaseUrl()}/subscribe/${token}?cancelled=1`,
      ...(STRIPE_TOS_CONSENT_ENABLED ? { consent_collection: { terms_of_service: "required" as const } } : {}),
      metadata: {
        // MANDATORY: the webhook returns silently without it.
        tenant_id: tenant.id,
        plan_id: String(link.plan_id),
        plan_name: link.plan_name_snapshot,
        source: "platform_subscription",
        subscription_link_id: link.id,
        tos_version: PLATFORM_TOS_VERSION,
        // The person completing this payment IS the operator — that is the whole
        // point of the link. tos_accepted_by is omitted (no app_users row exists
        // for them), and tos_accepted_by_email is deliberately omitted so the
        // webhook falls back to session.customer_details.email: the
        // Stripe-attested address, the one identity here nobody can choose.
        tos_actor: "operator",
        tos_accepted_in_app: "true",
        ...(chargesDeferredToday ? { setup_fee: "true" } : {}),
        ...(meteredPriceId ? { esign_metered_price_id: meteredPriceId } : {}),
      },
      subscription_data: {
        metadata: {
          tenant_id: tenant.id,
          plan_id: String(link.plan_id),
          plan_name: link.plan_name_snapshot,
          billing_model: link.billing_model_snapshot,
          subscription_link_id: link.id,
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

    if (!session.url) return info("invalid", { portalUrl }, 500);
    return redirect(session.url);
  } catch (err) {
    console.error("[subscription-link] failed:", err);
    return jsonResponse({ state: "invalid", error: "Something went wrong. Ask for a fresh link." }, 500);
  }
});
