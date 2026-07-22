// check-migration-readiness
//
// Super-admin-only readiness probe for the UK → UAE Stripe platform migration.
// Live-checks BOTH migration tracks for a tenant and returns a verdict JSON
// that the admin UI renders directly:
//
//   1. subscription — moving SaaS billing (subscriptions + credits) from the
//      legacy UK account to the UAE account (tenants.subscription_account).
//   2. ownStripe    — moving booking payments from the managed UK Express
//      model to the operator's own Standard account connected via OAuth on
//      the UAE platform (tenants.payment_model).
//
// Statuses: 'ready' | 'warning' | 'blocked' — every non-green item carries a
// human-readable reason string.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  getStripeClientForAccount,
  type StripeMode,
} from "../_shared/stripe-client.ts";
import {
  getSubscriptionStripeClientForAccount,
} from "../_shared/subscription-stripe.ts";

type TrackStatus = "ready" | "warning" | "blocked";

async function verifySuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("app_users")
    .select("is_super_admin")
    .eq("auth_user_id", userId)
    .single();
  return data?.is_super_admin === true;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const isSuperAdmin = await verifySuperAdmin(supabase, user.id);
    if (!isSuperAdmin) {
      return errorResponse("Only super admins can check migration readiness", 403);
    }

    const { tenantId } = await req.json();
    if (!tenantId) return errorResponse("tenantId is required");

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select(
        "id, company_name, stripe_mode, subscription_stripe_mode, subscription_account, payment_model, stripe_account_id, stripe_subscription_customer_id, own_stripe_account_id, own_stripe_test_account_id"
      )
      .eq("id", tenantId)
      .single();
    if (tenantError || !tenant) return errorResponse("Tenant not found", 404);

    const subMode: StripeMode =
      (tenant.subscription_stripe_mode as StripeMode) || "test";

    // =========================================================================
    // Track 1: SUBSCRIPTION (UK → UAE platform billing)
    // =========================================================================
    const subReasons: string[] = [];
    let subBlocked = false;
    let subWarning = false;

    const alreadyOnUae = tenant.subscription_account === "uae";

    // Active-ish subscription row in DB (unique index guarantees at most one).
    const { data: activeSub } = await supabase
      .from("tenant_subscriptions")
      .select(
        "id, status, stripe_subscription_id, stripe_account, current_period_end"
      )
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    const ukSub = activeSub && activeSub.stripe_account !== "uae" ? activeSub : null;

    // Live-verify the UK subscription on Stripe (DB is the fallback).
    let ukSubStatus: string | null = ukSub?.status ?? null;
    let ukPeriodEnd: string | null = ukSub?.current_period_end ?? null;
    let ukSubLiveChecked = false;
    if (ukSub?.stripe_subscription_id) {
      try {
        const ukSubStripe = getSubscriptionStripeClientForAccount("uk", subMode);
        const liveSub = await ukSubStripe.subscriptions.retrieve(
          ukSub.stripe_subscription_id
        );
        ukSubStatus = liveSub.status;
        ukPeriodEnd = liveSub.current_period_end
          ? new Date(liveSub.current_period_end * 1000).toISOString()
          : ukPeriodEnd;
        ukSubLiveChecked = true;
      } catch (err) {
        subWarning = true;
        subReasons.push(
          `Could not live-verify the UK subscription on Stripe (${(err as Error).message}) — showing last known DB state.`
        );
      }
    }

    // Open invoices: DB records + live Stripe unpaid invoices on the UK account.
    const { count: openInvoicesDb } = await supabase
      .from("tenant_subscription_invoices")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "open");

    let openInvoicesStripe: number | null = null;
    if (tenant.stripe_subscription_customer_id) {
      try {
        const ukSubStripe = getSubscriptionStripeClientForAccount("uk", subMode);
        const liveInvoices = await ukSubStripe.invoices.list({
          customer: tenant.stripe_subscription_customer_id,
          status: "open",
          limit: 100,
        });
        openInvoicesStripe = liveInvoices.data.length;
      } catch (err) {
        subWarning = true;
        subReasons.push(
          `Could not list open invoices on the UK Stripe account (${(err as Error).message}).`
        );
      }
    }

    // The DB mirror and live Stripe largely overlap — take the max rather than
    // the sum so the same invoice isn't counted twice.
    const openInvoices = Math.max(openInvoicesDb ?? 0, openInvoicesStripe ?? 0);

    // Is there an active plan configured on the UAE account for this tenant?
    const { count: uaePlanCount } = await supabase
      .from("subscription_plans")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("stripe_account", "uae")
      .eq("is_active", true);
    const planOnUae = (uaePlanCount ?? 0) > 0;

    // Verdict — subscription track
    if (openInvoices > 0) {
      subBlocked = true;
      subReasons.push(
        `${openInvoices} open/unpaid subscription invoice(s) on the UK account — settle or void them before migrating billing.`
      );
    }
    if (alreadyOnUae) {
      subReasons.push(
        "Subscription billing is already on the UAE account — no migration needed."
      );
    } else if (!ukSub) {
      subWarning = true;
      subReasons.push(
        "No active UK subscription found — nothing to migrate; the tenant can start fresh on the UAE account."
      );
    }
    if (!planOnUae) {
      subWarning = true;
      subReasons.push(
        "No active subscription plan exists on the UAE account for this tenant — create one before migrating so the tenant has something to subscribe to."
      );
    }

    const subscriptionStatus: TrackStatus = subBlocked
      ? "blocked"
      : subWarning
        ? "warning"
        : "ready";

    // =========================================================================
    // Track 2: OWN STRIPE (managed UK Express → operator-owned Standard on UAE)
    // =========================================================================
    const ownReasons: string[] = [];
    let ownBlocked = false;
    let ownWarning = false;

    const oauthLiveConnected = !!tenant.own_stripe_account_id;
    const oauthTestConnected = !!tenant.own_stripe_test_account_id;
    const alreadyOwn = tenant.payment_model === "own";

    // Active deposit holds living on the UK platform account — these die the
    // moment the tenant stops charging through UK, so they hard-block.
    const { data: ukHoldRentals } = await supabase
      .from("rentals")
      .select("id, deposit_hold_amount, deposit_hold_status, deposit_hold_expires_at")
      .eq("tenant_id", tenantId)
      .in("deposit_hold_status", ["held", "processing"])
      .eq("platform_account", "uk");

    const activeRentalsWithUkHolds = (ukHoldRentals ?? []).map((r: any) => ({
      rental_id: r.id,
      deposit_hold_amount: r.deposit_hold_amount,
      deposit_hold_status: r.deposit_hold_status,
      deposit_hold_expires_at: r.deposit_hold_expires_at,
    }));

    // Uncaptured (requires_capture) payments on the UK account.
    const { count: uncapturedUkPayments } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("capture_status", "requires_capture")
      .eq("platform_account", "uk");

    // Scheduled refunds still pending — process-scheduled-refund picks these up
    // from payments.refund_status = 'scheduled' (get_refunds_due_today RPC).
    const { count: scheduledRefunds } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("refund_status", "scheduled")
      .eq("platform_account", "uk");

    // Saved cards are platform-scoped: Stripe customer + payment-method ids
    // created on the UK platform do not exist on the UAE platform. Any flow
    // that charges a saved card off-session must therefore finish on UK before
    // the tenant flips — active installment plans and auto-extend rentals are
    // exactly those flows.
    const { count: activeInstallmentPlans } = await supabase
      .from("installment_plans")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("status", ["active", "pending"]);

    const { count: activeAutoExtendRentals } = await supabase
      .from("rentals")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("auto_extend_enabled", true)
      .in("status", ["Active", "Pending"]);

    // Express account balance on the UK platform (live keys — Express accounts
    // are live-mode objects). Failure is a warning, never a crash.
    let expressBalance:
      | {
          available: number;
          pending: number;
          currency: string | null;
          byCurrency: Array<{ currency: string; available: number; pending: number }>;
        }
      | { error: string }
      | null = null;

    if (tenant.stripe_account_id) {
      try {
        const ukLive = getStripeClientForAccount("uk", "live");
        const balance = await ukLive.balance.retrieve(
          { stripeAccount: tenant.stripe_account_id } as any
        );
        const byCurrency = new Map<string, { available: number; pending: number }>();
        for (const b of balance.available ?? []) {
          const e = byCurrency.get(b.currency) ?? { available: 0, pending: 0 };
          e.available += b.amount;
          byCurrency.set(b.currency, e);
        }
        for (const b of balance.pending ?? []) {
          const e = byCurrency.get(b.currency) ?? { available: 0, pending: 0 };
          e.pending += b.amount;
          byCurrency.set(b.currency, e);
        }
        const entries = Array.from(byCurrency.entries()).map(([currency, v]) => ({
          currency,
          available: v.available,
          pending: v.pending,
        }));
        expressBalance = {
          available: entries.reduce((s, e) => s + e.available, 0),
          pending: entries.reduce((s, e) => s + e.pending, 0),
          currency: entries[0]?.currency ?? null,
          byCurrency: entries,
        };
      } catch (err) {
        expressBalance = { error: (err as Error).message };
        ownWarning = true;
        ownReasons.push(
          `Could not retrieve the UK Express account balance (${(err as Error).message}) — verify payouts manually before migrating.`
        );
      }
    }

    // Verdict — own-Stripe track
    if (activeRentalsWithUkHolds.length > 0) {
      ownBlocked = true;
      ownReasons.push(
        `${activeRentalsWithUkHolds.length} active rental(s) still have deposit holds on the UK account — capture or release them before switching, or they cannot be operated after migration.`
      );
    }
    if ((uncapturedUkPayments ?? 0) > 0) {
      ownBlocked = true;
      ownReasons.push(
        `${uncapturedUkPayments} uncaptured payment(s) (requires_capture) on the UK account — capture or cancel them before switching.`
      );
    }
    if ((scheduledRefunds ?? 0) > 0) {
      ownWarning = true;
      ownReasons.push(
        `${scheduledRefunds} scheduled refund(s) pending on UK payments — they will still process on the UK account; keep it open until they complete.`
      );
    }
    if ((activeInstallmentPlans ?? 0) > 0) {
      ownBlocked = true;
      ownReasons.push(
        `${activeInstallmentPlans} active/pending installment plan(s) charge a saved card on the UK platform — remaining installments cannot be charged after flipping. Let plans finish (or settle them) before switching.`
      );
    }
    if ((activeAutoExtendRentals ?? 0) > 0) {
      ownBlocked = true;
      ownReasons.push(
        `${activeAutoExtendRentals} active auto-extend rental(s) auto-charge a saved card on the UK platform — wait for them to close before switching.`
      );
    }
    if (
      expressBalance &&
      !("error" in expressBalance) &&
      expressBalance.pending > 0
    ) {
      ownWarning = true;
      const cur = (expressBalance.currency ?? "usd").toUpperCase();
      ownReasons.push(
        `UK Express account has a pending balance of ${(expressBalance.pending / 100).toFixed(2)} ${cur} — funds will still pay out on the old account; do not close it until settled.`
      );
    }
    // BLOCK if the tenant's CURRENT stripe_mode has no connected own-account.
    // Flipping to 'own' without the current mode's account = every charge in
    // that mode throws (getConnectAccountId backstop). This is the misroute
    // guard: the flip must be impossible-to-green until the right account for
    // the mode the tenant actually charges in is connected.
    const currentMode = (tenant.stripe_mode as StripeMode) || "test";
    const currentModeConnected = currentMode === "live" ? oauthLiveConnected : oauthTestConnected;
    if (alreadyOwn) {
      ownReasons.push(
        "Tenant already uses their own Stripe account for booking payments — no migration needed."
      );
    } else if (!currentModeConnected) {
      ownBlocked = true;
      ownReasons.push(
        `Operator's own Stripe account for the tenant's CURRENT mode (${currentMode}) is not connected via OAuth — connect it before flipping, or charges will fail. (Tenant charges in ${currentMode} mode.)`
      );
    } else if (!oauthLiveConnected) {
      // Current mode is connected (test) but live isn't — fine for a test run,
      // warn so nobody goes live-charging without the live account.
      ownWarning = true;
      ownReasons.push(
        "Own Stripe LIVE account not yet connected — connect it before this tenant charges in live mode."
      );
    }

    const ownStripeStatus: TrackStatus = ownBlocked
      ? "blocked"
      : ownWarning
        ? "warning"
        : "ready";

    return jsonResponse({
      checkedAt: new Date().toISOString(),
      tenantId,
      tenantName: tenant.company_name,
      subscription: {
        status: subscriptionStatus,
        reasons: subReasons,
        details: {
          ukSubStatus,
          ukPeriodEnd,
          ukSubLiveChecked,
          openInvoices,
          openInvoicesDb: openInvoicesDb ?? 0,
          openInvoicesStripe,
          planOnUae,
          alreadyOnUae,
          subscriptionStripeMode: subMode,
        },
      },
      ownStripe: {
        status: ownStripeStatus,
        reasons: ownReasons,
        details: {
          oauthLiveConnected,
          oauthTestConnected,
          alreadyOwn,
          activeRentalsWithUkHolds,
          uncapturedUkPayments: uncapturedUkPayments ?? 0,
          scheduledRefunds: scheduledRefunds ?? 0,
          activeInstallmentPlans: activeInstallmentPlans ?? 0,
          activeAutoExtendRentals: activeAutoExtendRentals ?? 0,
          expressBalance,
          stripeMode: (tenant.stripe_mode as StripeMode) || "test",
        },
      },
    });
  } catch (error) {
    console.error("Error in check-migration-readiness:", error);
    return errorResponse((error as Error).message || "Internal server error", 500);
  }
});
