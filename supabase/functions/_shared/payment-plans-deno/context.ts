// Payment plans — everything the engine needs for ONE tenant, built from the
// tenant row with the same helpers every other money path uses.
//
// NEW charges go to the tenant's CURRENT platform account
// (getChargePlatformAccount: payment_model 'own' → UAE keys, else UK) and its
// connected account (getConnectAccountId), exactly as create-checkout-session,
// installment-pay-link and send-payg-reminders resolve them. The engine's
// idempotency key embeds that connected account, so a plan's attempts are
// always replayed against the account they were made on (the engine refuses
// to recover an attempt on a different account rather than charge anew).
//
// A tenant the engine cannot charge in slice 1 — a Square tenant, a live
// Own-Stripe tenant with no connected account, missing keys — gets an
// UnavailableProvider: every charge is refused as an integration bug (plan
// paused, operator alerted, no customer email). Manual plans still work.

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import {
  getChargePlatformAccount,
  getConnectAccountId,
  getStripeClientForAccount,
  TENANT_STRIPE_COLUMNS,
  type PlatformAccount,
} from "../stripe-client.ts";
import type { EngineDeps } from "../payment-plans/engine.ts";
import { isValidTimeZone } from "../payment-plans/dates.ts";
import { SupabasePlanStore, type PlanDbClient } from "./supabase-store.ts";
import { StripePaymentProvider, UnavailableProvider } from "./stripe-provider.ts";
import { DenoNotifier } from "./notifier.ts";
import { DenoLinkMinter } from "./link-minter.ts";
import { BonzahRenewalInsurer } from "./insurer.ts";
import { STRIPE, SQUARE } from "../payments/predicates.ts";
import type { ProviderId } from "../payments/types.ts";

/**
 * The processors the plan engine has a provider adapter for — ONE declaration,
 * read by the cron (below) and by payment-plan-manage. Slice 1 has
 * stripe-provider.ts only. Square's manifest would allow an emailed link
 * (supportsHostedCheckout) but not an unattended card charge
 * (canChargeOffSession), and neither is built for plans yet, so a Square
 * tenant's plan collects by manual record only. Adding a Square adapter means
 * adding it here, not another name comparison at a call site
 * (tests/integrations/square/adapter-depth.test.ts counts those).
 */
export const PLAN_COLLECTING_PROVIDERS: readonly ProviderId[] = [STRIPE];

/** Can the engine charge a card or send a link for this processor? */
export function planEngineCollects(provider: ProviderId): boolean {
  return PLAN_COLLECTING_PROVIDERS.includes(provider);
}

export interface TenantPlanContext {
  tenantId: string;
  slug: string;
  companyName: string | null;
  /** Lower-case ISO 4217, as Stripe and payment_plans.currency want it. */
  currency: string;
  /** The tenant's IANA zone, or null when it is missing or not a zone this runtime knows. */
  timezone: string | null;
  paymentProvider: "stripe" | "square";
  mode: "test" | "live";
  platformAccount: PlatformAccount;
  stripe: Stripe | null;
  connectAccountId: string | null;
  /** Why the engine cannot charge this tenant, or null when it can. */
  unavailable: string | null;
}

/**
 * Tenants the payment-plans endpoints serve in slice 1 (the v2 canary). The
 * portal UI gates on the same slug; this is the server-side half, so a direct
 * call cannot create a plan anywhere else. PAYMENT_PLANS_TENANT_SLUGS
 * (comma-separated) overrides it.
 */
export function paymentPlansTenantSlugs(): string[] {
  const raw = Deno.env.get("PAYMENT_PLANS_TENANT_SLUGS");
  const list = (raw ?? "northwind").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : ["northwind"];
}

export function isPaymentPlansTenant(slug: string | null | undefined): boolean {
  return !!slug && paymentPlansTenantSlugs().includes(slug.toLowerCase());
}

export async function loadTenantPlanContext(db: PlanDbClient, tenantId: string): Promise<TenantPlanContext> {
  const { data: tenant, error } = await db
    .from("tenants")
    .select(`id, slug, company_name, currency_code, timezone, payment_provider, ${TENANT_STRIPE_COLUMNS}`)
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`tenant lookup failed: ${error.message}`);
  if (!tenant) throw new Error(`tenant ${tenantId} not found`);

  const mode: "test" | "live" = tenant.stripe_mode === "live" ? "live" : "test";
  const paymentProvider: ProviderId = tenant.payment_provider === SQUARE ? SQUARE : STRIPE;
  const platformAccount = getChargePlatformAccount(tenant);
  let unavailable: string | null = null;
  let connectAccountId: string | null = null;
  let stripe: Stripe | null = null;

  if (!planEngineCollects(paymentProvider)) {
    unavailable = "Payment plans cannot charge Square tenants yet — record payments by hand.";
  } else {
    try {
      connectAccountId = getConnectAccountId(tenant);
      stripe = getStripeClientForAccount(platformAccount, mode);
    } catch (e) {
      unavailable = (e as Error)?.message ?? String(e);
    }
  }

  return {
    tenantId,
    slug: tenant.slug,
    companyName: tenant.company_name ?? null,
    currency: String(tenant.currency_code || "USD").toLowerCase(),
    timezone: isValidTimeZone(tenant.timezone ?? "") ? tenant.timezone : null,
    paymentProvider,
    mode,
    platformAccount,
    stripe,
    connectAccountId,
    unavailable,
  };
}

/** The engine's seams for one tenant. */
export function buildEngineDeps(db: PlanDbClient, ctx: TenantPlanContext): EngineDeps & { store: SupabasePlanStore } {
  const provider =
    ctx.unavailable || !ctx.stripe
      ? new UnavailableProvider(ctx.unavailable ?? "Stripe is not configured for this tenant", { name: ctx.paymentProvider, mode: ctx.mode })
      : new StripePaymentProvider({ stripe: ctx.stripe, mode: ctx.mode, account: ctx.connectAccountId, platformAccount: ctx.platformAccount, db, tenantId: ctx.tenantId });
  return {
    store: new SupabasePlanStore(db),
    provider,
    notifier: new DenoNotifier(db),
    links: new DenoLinkMinter(ctx.slug),
    // Renewal periods buy their Bonzah policy before they are charged (A4).
    // Independent of the card processor: a Square tenant's manual renewal
    // plan is insured the same way.
    insurer: new BonzahRenewalInsurer(db),
  };
}
