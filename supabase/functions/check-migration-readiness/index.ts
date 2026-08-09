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

/** Stripe requires trial_end to be at least 48h out; mirrors MIN_TRIAL_END_MS
 *  in create-uae-subscription-capture. Inside this window the first UAE charge
 *  cannot be deferred to the existing period end. */
const MIN_TRIAL_HOURS = 48;

/**
 * Every `rentals.deposit_hold_status` that is NOT terminal.
 *
 * The column now carries 11 values; only `captured`, `released` and `expired`
 * mean the authorization is definitively over. This gate used to filter on
 * `['held','processing']`, which predates the chained-hold engine — so a hold
 * mid-refresh (`refreshing`), mid-capture (`capturing`), waiting on SCA
 * (`requires_action`), parked after a soft decline (`failed`), escalated to a
 * human (`needs_review`) or under dispute (`disputed`) was INVISIBLE here.
 *
 * That is a false green light, not a cosmetic miss: a PaymentIntent cannot be
 * moved between platform accounts, so flipping UK → UAE while any of those
 * exist strands the renter's authorized money on an account the tenant has
 * stopped operating, with no way to capture or release it.
 *
 * Kept as an explicit list rather than "not in (terminal…)" so a status added
 * to the enum later is treated as unknown-and-therefore-blocking only if it is
 * also added here — see the platform filter below for the same fail-safe
 * reasoning applied to the account anchor.
 */
const NON_TERMINAL_HOLD_STATUSES = [
  "processing",
  "refreshing",
  "capturing",
  "held",
  "requires_action",
  "failed",
  "needs_review",
  "disputed",
];

/** Terminal statuses, for the operator-facing explanation only. */
const TERMINAL_HOLD_STATUSES = ["captured", "released", "expired"];

/**
 * Run a `head: true, count: 'exact'` query so that it fails CLOSED.
 *
 * supabase-js RESOLVES with `{ error }` instead of throwing, so the previous
 * `const { count } = await supabase…` pattern silently turned every read
 * failure into `undefined` → `?? 0` → "nothing to block on". On a gate whose
 * entire job is to withhold permission, a failed read that reads as zero is the
 * worst possible direction. `count: null` means UNKNOWN and every call site
 * below treats unknown at least as severely as a non-zero count.
 */
async function safeCount(
  builder: any,
  label: string
): Promise<{ count: number | null; error: string | null }> {
  try {
    const { count, error } = await builder;
    if (error) {
      console.error(`[MIGRATION-READINESS] ${label}: count query failed —`, error.message);
      return { count: null, error: error.message };
    }
    return { count: count ?? 0, error: null };
  } catch (err) {
    // ...and it REJECTS on a transport failure, which an `{ error }` check
    // alone would sail straight past.
    console.error(`[MIGRATION-READINESS] ${label}: count query threw —`, err);
    return { count: null, error: (err as Error).message };
  }
}

async function verifySuperAdmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("app_users")
    .select("is_super_admin, is_active")
    .eq("auth_user_id", userId)
    .single();
  // is_active too — see the note in mark-invoice-paid.
  return data?.is_super_admin === true && data?.is_active !== false;
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
    const openInvoicesDbProbe = await safeCount(
      supabase
        .from("tenant_subscription_invoices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "open"),
      "open subscription invoices"
    );
    const openInvoicesDb = openInvoicesDbProbe.count;

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
    if (openInvoicesDbProbe.error) {
      // Unknown, not zero. The live-Stripe list is a mirror of the same fact,
      // not an independent one, so a failed DB read leaves the open-invoice
      // count genuinely unknown and the flip must not go green on it.
      subBlocked = true;
      subReasons.push(
        `Could not read subscription invoices from the database (${openInvoicesDbProbe.error}) — the open-invoice count is UNKNOWN. Blocking: an unreadable count is not a zero count. Re-run this check.`
      );
    }
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

    // Renewal timing. The UAE subscription defers its first charge to the UK
    // period end (so the tenant never pays twice), but Stripe requires
    // trial_end to be >= 48h out. Inside that window there is no trial: UAE
    // bills immediately and the tenant is briefly covered by both.
    let daysUntilRenewal: number | null = null;
    let renewalTooClose = false;
    if (!alreadyOnUae && ukPeriodEnd) {
      const msUntil = new Date(ukPeriodEnd).getTime() - Date.now();
      daysUntilRenewal = Math.floor(msUntil / (24 * 60 * 60 * 1000));
      const hoursUntil = msUntil / (60 * 60 * 1000);
      const renewalStr = new Date(ukPeriodEnd).toISOString().slice(0, 10);
      if (msUntil <= 0) {
        subWarning = true;
        subReasons.push(
          `The current period ended on ${renewalStr} — UAE billing will start immediately on capture.`
        );
      } else if (hoursUntil < MIN_TRIAL_HOURS) {
        renewalTooClose = true;
        subWarning = true;
        subReasons.push(
          `Renews in under ${MIN_TRIAL_HOURS}h (on ${renewalStr}). Stripe can't defer a first charge that close, so the tenant would be billed immediately and briefly pay both accounts. Wait until after ${renewalStr} to send the capture link.`
        );
      } else {
        subReasons.push(
          `Renews ${renewalStr} (${daysUntilRenewal} day${daysUntilRenewal === 1 ? "" : "s"} away) — the new subscription will show "${daysUntilRenewal} days free" and take over on that exact date, so no double billing.`
        );
      }
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

    // Deposit holds still LIVE on the UK platform account. These become
    // unreachable the moment the tenant stops charging through UK — a
    // PaymentIntent cannot be moved between platform accounts — so they
    // hard-block the flip.
    //
    // TWO fail-safe choices here, both deliberate:
    //
    //  1. Status filter is every NON-terminal value, not the historical
    //     ['held','processing'] pair. See NON_TERMINAL_HOLD_STATUSES.
    //
    //  2. Platform filter is applied in JS as "not 'uae'", not in SQL as
    //     "= 'uk'". rentals.platform_account is NOT NULL DEFAULT 'uk', but
    //     treating any NULL/unrecognised anchor as legacy is the safe
    //     direction: an ambiguous anchor must count as possibly-on-UK, never
    //     as definitely-migrated. (The reverse case — a hold anchored to UAE
    //     on a rental still stamped 'uk', which sync-deposit-hold logs as
    //     PLATFORM DIVERGENCE — over-blocks rather than under-blocks, which is
    //     the direction we want on a money gate.)
    const { data: ukHoldRentals, error: ukHoldError } = await supabase
      .from("rentals")
      .select(
        "id, deposit_hold_amount, deposit_hold_status, deposit_hold_expires_at, deposit_hold_payment_intent_id, platform_account"
      )
      .eq("tenant_id", tenantId)
      .in("deposit_hold_status", NON_TERMINAL_HOLD_STATUSES);

    if (ukHoldError) {
      console.error(
        "[MIGRATION-READINESS] Could not read deposit holds for tenant",
        tenantId,
        "—",
        ukHoldError.message
      );
    }

    const activeRentalsWithUkHolds = (ukHoldRentals ?? [])
      .filter((r: any) => r.platform_account !== "uae")
      .map((r: any) => ({
        rental_id: r.id,
        deposit_hold_amount: r.deposit_hold_amount,
        deposit_hold_status: r.deposit_hold_status,
        deposit_hold_expires_at: r.deposit_hold_expires_at,
        deposit_hold_payment_intent_id: r.deposit_hold_payment_intent_id ?? null,
        platform_account: r.platform_account ?? null,
      }));

    // Uncaptured (requires_capture) payments on the UK account.
    const uncapturedUkPaymentsProbe = await safeCount(
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("capture_status", "requires_capture")
        .eq("platform_account", "uk"),
      "uncaptured UK payments"
    );
    const uncapturedUkPayments = uncapturedUkPaymentsProbe.count;

    // Scheduled refunds still pending — process-scheduled-refund picks these up
    // from payments.refund_status = 'scheduled' (get_refunds_due_today RPC).
    const scheduledRefundsProbe = await safeCount(
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("refund_status", "scheduled")
        .eq("platform_account", "uk"),
      "scheduled UK refunds"
    );
    const scheduledRefunds = scheduledRefundsProbe.count;

    // Saved cards are platform-scoped: Stripe customer + payment-method ids
    // created on the UK platform do not exist on the UAE platform. Any flow
    // that charges a saved card off-session must therefore finish on UK before
    // the tenant flips — active installment plans and auto-extend rentals are
    // exactly those flows.
    const activeInstallmentPlansProbe = await safeCount(
      supabase
        .from("installment_plans")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .in("status", ["active", "pending"]),
      "active installment plans"
    );
    const activeInstallmentPlans = activeInstallmentPlansProbe.count;

    const activeAutoExtendRentalsProbe = await safeCount(
      supabase
        .from("rentals")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("auto_extend_enabled", true)
        .in("status", ["Active", "Pending"]),
      "active auto-extend rentals"
    );
    const activeAutoExtendRentals = activeAutoExtendRentalsProbe.count;

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

    // Verdict — own-Stripe track.
    //
    // Every DB probe below fails CLOSED: an unreadable count blocks at least as
    // hard as a non-zero one. Before this, each of these was destructured
    // without an error check, so a transient PostgREST failure read as zero and
    // handed the operator a green flip gate while live authorisations,
    // uncaptured payments or running installment plans sat on the UK account.
    if (ukHoldError) {
      ownBlocked = true;
      ownReasons.push(
        `Could not read deposit holds for this tenant (${ukHoldError.message}) — the number of live authorisations on the UK account is UNKNOWN. Blocking: an unread hold is not a zero hold, and a hold stranded on the old platform can never be captured or released. Re-run this check.`
      );
    } else if (activeRentalsWithUkHolds.length > 0) {
      ownBlocked = true;
      const byStatus = activeRentalsWithUkHolds.reduce(
        (acc: Record<string, number>, h: any) => {
          const key = String(h.deposit_hold_status ?? "unknown");
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
      const breakdown = Object.entries(byStatus)
        .map(([status, n]) => `${n} ${status}`)
        .join(", ");
      ownReasons.push(
        `${activeRentalsWithUkHolds.length} rental(s) still carry a non-terminal deposit hold on the UK account (${breakdown}) — capture, release or resolve them before switching. Only ${TERMINAL_HOLD_STATUSES.join("/")} are safe to leave behind; anything else may still be holding the renter's money on a platform account this tenant is about to stop using.`
      );
    }
    if (uncapturedUkPaymentsProbe.error) {
      ownBlocked = true;
      ownReasons.push(
        `Could not count uncaptured UK payments (${uncapturedUkPaymentsProbe.error}) — UNKNOWN, so blocking rather than assuming zero.`
      );
    } else if ((uncapturedUkPayments ?? 0) > 0) {
      ownBlocked = true;
      ownReasons.push(
        `${uncapturedUkPayments} uncaptured payment(s) (requires_capture) on the UK account — capture or cancel them before switching.`
      );
    }
    if (scheduledRefundsProbe.error) {
      // Non-blocking when known non-zero, so non-blocking when unknown — but
      // still said out loud rather than silently reported as "0 scheduled".
      ownWarning = true;
      ownReasons.push(
        `Could not count scheduled UK refunds (${scheduledRefundsProbe.error}) — treat as UNKNOWN and keep the UK account open until you have verified manually.`
      );
    } else if ((scheduledRefunds ?? 0) > 0) {
      ownWarning = true;
      ownReasons.push(
        `${scheduledRefunds} scheduled refund(s) pending on UK payments — they will still process on the UK account; keep it open until they complete.`
      );
    }
    if (activeInstallmentPlansProbe.error) {
      ownBlocked = true;
      ownReasons.push(
        `Could not count active installment plans (${activeInstallmentPlansProbe.error}) — UNKNOWN, so blocking rather than assuming zero.`
      );
    } else if ((activeInstallmentPlans ?? 0) > 0) {
      ownBlocked = true;
      ownReasons.push(
        `${activeInstallmentPlans} active/pending installment plan(s) charge a saved card on the UK platform — remaining installments cannot be charged after flipping. Let plans finish (or settle them) before switching.`
      );
    }
    if (activeAutoExtendRentalsProbe.error) {
      ownBlocked = true;
      ownReasons.push(
        `Could not count active auto-extend rentals (${activeAutoExtendRentalsProbe.error}) — UNKNOWN, so blocking rather than assuming zero.`
      );
    } else if ((activeAutoExtendRentals ?? 0) > 0) {
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
          renewalDate: ukPeriodEnd ? ukPeriodEnd.slice(0, 10) : null,
          daysUntilRenewal,
          renewalTooClose,
          ukSubLiveChecked,
          openInvoices,
          openInvoicesDb: openInvoicesDb ?? 0,
          // null count === the read failed. Surfaced explicitly so the UI can
          // say "unknown" rather than render a reassuring 0.
          openInvoicesDbUnknown: openInvoicesDbProbe.error !== null,
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
          // A failed read is never reported as a clean zero. `*Unknown: true`
          // means "we could not tell", and every one of these already forced
          // the track to `blocked` above.
          ukHoldsUnknown: !!ukHoldError,
          ukHoldsError: ukHoldError?.message ?? null,
          nonTerminalHoldStatuses: NON_TERMINAL_HOLD_STATUSES,
          uncapturedUkPayments: uncapturedUkPayments ?? 0,
          uncapturedUkPaymentsUnknown: uncapturedUkPaymentsProbe.error !== null,
          scheduledRefunds: scheduledRefunds ?? 0,
          scheduledRefundsUnknown: scheduledRefundsProbe.error !== null,
          activeInstallmentPlans: activeInstallmentPlans ?? 0,
          activeInstallmentPlansUnknown: activeInstallmentPlansProbe.error !== null,
          activeAutoExtendRentals: activeAutoExtendRentals ?? 0,
          activeAutoExtendRentalsUnknown: activeAutoExtendRentalsProbe.error !== null,
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
