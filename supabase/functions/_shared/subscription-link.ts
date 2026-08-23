// Shared machinery for anonymous platform-subscription payment links.
//
// George generates a link on a sales call and pastes it into chat. The prospect
// pays without logging in and without screen-sharing, then explores the portal
// later. The link IS the paywall, moved forward in time — not an addition to it.
//
// Two rules govern everything here:
//   1. NOTHING about the charge is caller-supplied. The amount, currency,
//      interval, price id, Stripe account and mode are all frozen onto the row
//      at generation, and redemption REFUSES if any of them has drifted. We
//      never charge a number different from the one George said out loud.
//   2. The credential is never stored. Only sha256(token) is persisted, so a
//      database dump cannot be replayed as a payment.
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import {
  getSubscriptionStripeMode,
  getTenantSubscriptionAccount,
  getSubscriptionStripeClientForAccount,
  type SubscriptionAccount,
} from "./subscription-stripe.ts";

export const STRIPE_PRODUCT_NAME = "Drive247 Platform Subscription";

/** How long a link stays payable. The meeting asked for exactly one day. */
export const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Public site that serves the interstitial. The link George pastes points here,
 * never at the Supabase functions host — a prospect should see a Drive247 page,
 * and the URL should look like something a company would send.
 */
export function siteBaseUrl(): string {
  return (Deno.env.get("PUBLIC_SITE_URL") || "https://drive-247.com").replace(/\/+$/, "");
}

export function portalBaseUrl(tenantSlug: string): string {
  const root = (Deno.env.get("PORTAL_ROOT_DOMAIN") || "portal.drive-247.com").replace(/\/+$/, "");
  return `https://${tenantSlug}.${root}`;
}

/** 32 bytes → base64url, 43 chars, 256 bits of entropy. Unguessable. */
export function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildLinkUrl(token: string): string {
  return `${siteBaseUrl()}/subscribe/${token}`;
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function getOrCreateProduct(stripe: Stripe): Promise<string> {
  const products = await stripe.products.search({
    query: `name:'${STRIPE_PRODUCT_NAME}' AND active:'true'`,
  });
  if (products.data.length > 0) return products.data[0].id;
  const product = await stripe.products.create({
    name: STRIPE_PRODUCT_NAME,
    description: "Monthly/yearly subscription for the Drive247 rental management platform",
  });
  return product.id;
}

/**
 * Make sure the plan's Stripe Price lives on the account we are about to charge.
 *
 * This is a deliberate COPY of the same block in create-subscription-checkout
 * rather than an extraction. Refactoring the live checkout that all 47 tenants
 * depend on, in the same change that introduces a new anonymous endpoint, would
 * put an unrelated blast radius behind this feature. The duplication is the
 * cheaper risk; if they ever diverge, this one is the newer.
 *
 * It runs ONLY in the authenticated generate path. The anonymous redeem path
 * verifies and refuses instead — otherwise one leaked token would let an
 * unauthenticated caller create Stripe Products and Prices and repoint the row
 * that decides what every future portal checkout charges.
 */
export async function ensurePlanPriceOnAccount(
  supabase: any,
  stripe: Stripe,
  plan: any,
  tenantId: string,
  account: SubscriptionAccount,
  mode: "test" | "live",
): Promise<string> {
  let priceId = plan.stripe_price_id as string;
  const planAccount = plan.stripe_account === "uae" ? "uae" : "uk";
  let priceValid = planAccount === account;

  if (priceValid) {
    try {
      await stripe.prices.retrieve(priceId);
    } catch (_e) {
      priceValid = false;
    }
  }

  if (!priceValid) {
    console.log(`[subscription-link] price ${priceId} unusable on ${account}/${mode}; recreating`);
    const productId = await getOrCreateProduct(stripe);
    const newPrice = await stripe.prices.create({
      product: productId,
      unit_amount: plan.amount || 0,
      currency: (plan.currency || "usd").toLowerCase(),
      recurring: { interval: (plan.interval || "month") as "month" | "year" },
      metadata: { tenant_id: tenantId, plan_name: plan.name },
    });
    priceId = newPrice.id;
    await supabase
      .from("subscription_plans")
      .update({ stripe_price_id: newPrice.id, stripe_product_id: productId, stripe_account: account })
      .eq("id", plan.id);
  }
  return priceId;
}

/**
 * Expire the Stripe Checkout session a link last minted, if one is still live.
 *
 * Killing our row is not killing the payment. A session already open in the
 * prospect's tab stays payable until Stripe expires it, and because we clamp
 * expiry to at least now+30min a session minted near the end of a link's life
 * outlives that link. Every path that retires a link must call this or the admin
 * is told something untrue.
 *
 * Returns whether a session was actually expired. Never throws: an
 * already-complete or already-expired session is a normal outcome.
 */
export async function expireLinkSession(
  stripe: Stripe,
  link: { last_session_id?: string | null; last_session_expires_at?: string | null },
): Promise<boolean> {
  if (!link?.last_session_id) return false;
  if (link.last_session_expires_at && new Date(link.last_session_expires_at).getTime() <= Date.now()) {
    return false;
  }
  try {
    await stripe.checkout.sessions.expire(link.last_session_id);
    return true;
  } catch (_e) {
    // resource_missing, or the customer completed it a moment ago. Both fine.
    return false;
  }
}

export type IssueResult =
  | { ok: true; linkId: string; url: string; token: string; expiresAt: string; kind: string;
      linkMode: string; plan: Record<string, unknown>; mode: string; account: string; raced?: boolean }
  | { ok: false; code: string; message: string; httpStatus: number };

/**
 * Mint a link. Shared so create-sales-onboarding can call it in-process rather
 * than needing a service-role bearer bypass on the HTTP function.
 */
export async function issueSubscriptionLink(
  supabase: any,
  opts: { tenantId: string; planId?: string | null; kind?: "first" | "followup"; createdBy?: string | null },
): Promise<IssueResult> {
  const { tenantId, createdBy = null } = opts;

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    // Never select platform_tos_* here. PostgREST fails the WHOLE query on an
    // unknown column, and the guard below turns any error into a false 404 — so
    // naming a column that does not exist yet would make every link generation
    // report "Tenant not found".
    .select("id, slug, company_name, contact_email, status, stripe_subscription_customer_id, subscription_billing_anchor")
    .eq("id", tenantId)
    .single();

  if (tenantError || !tenant) {
    return { ok: false, code: "tenant_not_found", message: "Tenant not found", httpStatus: 404 };
  }
  if (tenant.status === "suspended") {
    return {
      ok: false, code: "tenant_suspended", httpStatus: 409,
      message: "This tenant is suspended — they would be locked out of the portal even after paying.",
    };
  }

  const mode = await getSubscriptionStripeMode(supabase, tenantId);
  const account = await getTenantSubscriptionAccount(supabase, tenantId);
  const stripe = getSubscriptionStripeClientForAccount(account, mode);

  // ── Live-subscription refusal, using a set WIDER than any existing guard ──
  // 'incomplete' and 'unpaid' both resume into a live subscription, and
  // idx_tenant_subscriptions_active makes a second live row physically
  // impossible — the webhook would 23505, throw, 500, and Stripe would retry for
  // three days while the prospect is double-billed.
  const { data: subs } = await supabase
    .from("tenant_subscriptions")
    .select("id, status, stripe_subscription_id")
    .eq("tenant_id", tenantId)
    .not("status", "in", "(canceled,incomplete_expired)");

  const live = (subs ?? [])[0];
  let linkMode: "checkout" | "invoice" = "checkout";
  let invoiceRef: string | null = null;

  if (live) {
    if (live.status === "past_due") {
      // The meeting's actual case: a tenant blocked for non-payment. Send them to
      // the invoice Stripe already priced — no new Stripe object, no pro-rata
      // question, and paying it releases the portal's grace block.
      const { data: inv } = await supabase
        .from("tenant_subscription_invoices")
        .select("id, stripe_hosted_invoice_url, status")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "draft"])
        .not("stripe_hosted_invoice_url", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!inv) {
        return {
          ok: false, code: "past_due_outstanding", httpStatus: 409,
          message: "This tenant is past due but has no open invoice to pay. Use Discount next invoice or the Stripe portal.",
        };
      }
      linkMode = "invoice";
      invoiceRef = inv.id;
    } else if (["incomplete", "unpaid"].includes(live.status)) {
      // NOT a subscription — Stripe mints the object before payment confirms, so
      // this is the residue of a card that failed (a declined 3-D Secure
      // challenge leaves exactly this). Refusing here would strand the prospect
      // AND George: nobody could send a payable link, and the tenant is not
      // subscribed. Stripe expires these on its own in about 23 hours.
      // Fall through and mint.
    } else {
      return {
        ok: false,
        code: "live_subscription_exists",
        httpStatus: 409,
        message: `This tenant already has ${live.status === "active" ? "an" : "a"} ${live.status} subscription. A second one cannot exist — use Discount next invoice or the Stripe billing portal.`,
      };
    }
  }

  // ── Resolve the plan ──────────────────────────────────────────────────────
  let planId = opts.planId ?? null;
  if (!planId) {
    const { data: plans } = await supabase
      .from("subscription_plans")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (!plans || plans.length === 0) {
      return {
        ok: false, code: "no_plan_configured", httpStatus: 409,
        message: "This tenant has no active subscription plan. Create one under Manage Plans first.",
      };
    }
    if (plans.length > 1 && linkMode === "checkout") {
      return {
        ok: false, code: "plan_ambiguous", httpStatus: 409,
        message: "This tenant has more than one active plan — choose which one the link should charge.",
      };
    }
    planId = plans[0].id;
  }

  const { data: plan, error: planError } = await supabase
    .from("subscription_plans")
    .select("id, name, stripe_price_id, stripe_product_id, tenant_id, is_active, trial_days, amount, currency, interval, billing_model, stripe_account")
    .eq("id", planId)
    .single();

  if (planError || !plan) {
    return { ok: false, code: "plan_not_found", message: "Plan not found", httpStatus: 404 };
  }
  if (plan.tenant_id !== tenantId) {
    return { ok: false, code: "plan_foreign", message: "Plan does not belong to this tenant", httpStatus: 403 };
  }
  if (!plan.is_active) {
    return { ok: false, code: "plan_inactive", message: "Plan is no longer active", httpStatus: 409 };
  }
  if (!plan.stripe_price_id) {
    return { ok: false, code: "plan_no_price", message: "Plan has no Stripe price configured", httpStatus: 500 };
  }

  // Reconcile the price onto the right account HERE, where the caller is a
  // verified super admin. 9 of 47 tenants currently carry a plan whose
  // stripe_account differs from the tenant's subscription_account.
  let priceId: string;
  try {
    priceId = await ensurePlanPriceOnAccount(supabase, stripe, plan, tenantId, account, mode);
  } catch (e) {
    return {
      ok: false, code: "price_reconcile_failed", httpStatus: 500,
      message: `Could not prepare the Stripe price: ${(e as { message?: string })?.message ?? e}`,
    };
  }

  // ── Supersede any live link, then insert ─────────────────────────────────
  // Read BEFORE flipping, so we still have the session id to kill. Regenerating
  // used to leave the previous link's checkout tab payable — the prospect could
  // pay a link George had already replaced.
  const { data: toSupersede } = await supabase
    .from("subscription_links")
    .select("id, last_session_id, last_session_expires_at")
    .eq("tenant_id", tenantId)
    .eq("status", "pending");

  for (const old of toSupersede ?? []) {
    await expireLinkSession(stripe, old);
  }

  const { data: superseded } = await supabase
    .from("subscription_links")
    .update({ status: "superseded", superseded_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .select("id");

  // 'first' only when this tenant has never been linked AND never subscribed.
  let kind = opts.kind ?? "followup";
  if (!opts.kind) {
    const { count: priorLinks } = await supabase
      .from("subscription_links")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    kind = (priorLinks ?? 0) === 0 && !live ? "first" : "followup";
  }

  const token = genToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();

  const { data: row, error: insertError } = await supabase
    .from("subscription_links")
    .insert({
      tenant_id: tenantId,
      plan_id: plan.id,
      token_hash: tokenHash,
      kind,
      expires_at: expiresAt,
      plan_name_snapshot: plan.name,
      amount_snapshot: plan.amount ?? 0,
      currency_snapshot: (plan.currency || "usd").toLowerCase(),
      interval_snapshot: plan.interval || "month",
      billing_model_snapshot: plan.billing_model || "trial",
      trial_days_snapshot: plan.trial_days ?? 0,
      stripe_account_snapshot: account,
      stripe_mode_snapshot: mode,
      stripe_price_id_snapshot: priceId,
      link_mode: linkMode,
      invoice_url_ref: invoiceRef,
      created_by: createdBy,
    })
    .select("id, expires_at, kind, link_mode")
    .single();

  if (insertError) {
    // Two admins pressed Generate at the same instant. The loser returns the
    // winner's link so both screens converge instead of showing an error.
    if ((insertError as { code?: string })?.code === "23505") {
      const { data: existing } = await supabase
        .from("subscription_links")
        .select("id, expires_at, kind, link_mode")
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .maybeSingle();
      if (existing) {
        return {
          ok: true, linkId: existing.id, url: "", token: "",
          expiresAt: existing.expires_at, kind: existing.kind, linkMode: existing.link_mode,
          plan: { name: plan.name, amount: plan.amount, currency: plan.currency, interval: plan.interval },
          mode, account, raced: true,
        };
      }
    }
    return {
      ok: false, code: "insert_failed", httpStatus: 500,
      message: (insertError as { message?: string })?.message ?? "Could not create the link",
    };
  }

  if (superseded && superseded.length > 0) {
    await supabase
      .from("subscription_links")
      .update({ superseded_by: row.id })
      .in("id", superseded.map((s: { id: string }) => s.id));
  }

  // No PII: sent_to is never copied here.
  await supabase.from("audit_logs").insert({
    action: "subscription_link_created",
    tenant_id: tenantId,
    entity_type: "subscription_link",
    entity_id: row.id,
    actor_id: createdBy,
    is_super_admin_action: true,
    details: {
      kind, link_mode: linkMode, amount: plan.amount, currency: plan.currency,
      interval: plan.interval, plan_name: plan.name, mode, account,
      superseded: (superseded ?? []).length,
    },
  });

  return {
    ok: true,
    linkId: row.id,
    url: buildLinkUrl(token),
    token,
    expiresAt: row.expires_at,
    kind: row.kind,
    linkMode: row.link_mode,
    plan: { name: plan.name, amount: plan.amount, currency: plan.currency, interval: plan.interval, trialDays: plan.trial_days ?? 0 },
    mode,
    account,
  };
}
