// Defense-in-depth subscription gate for tenant-facing edge functions.
//
// COVERAGE (as of 2026-07-29). Wired into generate-review-summary. It sat
// entirely unimported before that, which meant the paywall was enforced in the
// BROWSER ONLY — a caller with a saved JWT could drive every edge function
// whatever their subscription state.
//
// Coverage is still PARTIAL and deliberately so. Gating is applied where
// refusing costs the platform money and costs a lapsed tenant's own customers
// nothing: staff-initiated work that spends OpenAI/verification credit. It is
// NOT applied to customer-facing paths (the booking-site chatbot, notification
// sending), because blocking those punishes the tenant's customers for the
// tenant's unpaid bill — that is a product call, not a code one.
//
// So: do not read an import of this module as "the platform is fully gated
// server-side". Check the import list before assuming any given function is
// protected.
//
// The Next.js middleware blocks tenant staff from reaching the portal UI when
// they're unsubscribed, and the client-side modal is the visible signal — but
// a determined caller could still hit edge functions directly with a saved
// JWT. This helper lets sensitive tenant-only functions (admin operations,
// platform-cost things like notifications and AI) refuse to run for an
// unsubscribed tenant.
//
// USAGE
// -----
//   import { requireActiveSubscription } from "../_shared/subscription-gate.ts";
//
//   const gate = await requireActiveSubscription(supabaseAdmin, tenantId);
//   if (gate) return gate; // gate is a 402 Response if blocked, null if ok
//
// Returns null when the tenant is allowed to proceed:
//   - has an active / trialing subscription, OR
//   - is past_due but still inside the configured grace window (and a past_due
//     tenant with no open invoice owes nothing, so it is allowed too), OR
//   - has no active subscription_plans configured (can't subscribe yet), OR
//   - either subscription kill switch is on — the global
//     admin_settings.subscription_gate_disabled or the per-tenant
//     tenants.subscription_gate_disabled. Both are what support flips to get
//     inside an unpaid tenant, so this module has to honour them or the UI opens
//     and the gated function keeps answering 402.
//
// Returns a 402 Response when the tenant must subscribe before continuing.
//
// Fails OPEN (returns null) on unexpected errors to avoid taking the platform
// offline on a transient DB hiccup. The middleware/UI gates remain in place.
// Two deliberate exceptions, both of which fail SAFE instead, matching the
// portal hooks they mirror: a failed grace-window read falls back to
// DEFAULT_GRACE_DAYS, and a failed kill-switch read does not suppress the gate
// (a config read nobody can answer must not silently disable the paywall).
//
// COST: the healthy path (active/trialing) still costs exactly one query. The
// grace window is read only for a past_due tenant that actually has an open
// invoice, and the kill switches only when the gate is about to refuse — i.e.
// on a request that was going to fail anyway.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

/**
 * The fallback grace window: the value the column was created with, and the
 * behaviour the product had before it was configurable. Mirrors
 * DEFAULT_GRACE_DAYS in apps/portal/src/hooks/use-subscription-grace-days.ts.
 */
const DEFAULT_GRACE_DAYS = 7;

/**
 * How long a tenant keeps working after a payment fails — a SUPER ADMIN
 * SETTING, read from admin_settings.subscription_grace_days.
 *
 * ROW SELECTION IS NOT INCIDENTAL. admin_settings has four rows; the admin
 * settings page edits the OLDEST (`created_at asc limit 1`) and mirrors the
 * global flags across the rest, so the portal hook reads that same row. This
 * reads it the same way. A `max()` or an "any row" reading here would refuse
 * requests on a window the super admin is not looking at.
 *
 * A null, a string or an out-of-range number is a bad read, not a policy, and a
 * bad read must never shorten anybody's window: all of those fall back to
 * DEFAULT_GRACE_DAYS, as does a read that fails outright.
 */
async function resolveGraceDays(supabase: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("admin_settings")
      .select("subscription_grace_days")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const raw = (data as { subscription_grace_days?: number | null } | null)
      ?.subscription_grace_days;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 90) {
      return DEFAULT_GRACE_DAYS;
    }
    return Math.floor(raw);
  } catch (err) {
    console.error(
      "[subscription-gate] grace-days read failed, using the default:",
      err,
    );
    return DEFAULT_GRACE_DAYS;
  }
}

/**
 * Is the subscription blocker switched off for this tenant?
 *
 * Two switches, OR-combined, exactly as the portal combines them
 * (apps/portal/src/app/(dashboard)/layout.tsx `gateSuppressed`):
 *   - GLOBAL: admin_settings.subscription_gate_disabled on ANY row. The portal
 *     hook (use-subscription-gate-disabled.ts) filters `eq(true).limit(1)`
 *     rather than reading the oldest row, because the admin page mirrors the
 *     global flags across rows — so "any row" is the rule here too. Note this
 *     is deliberately a DIFFERENT row rule from the grace window above.
 *   - PER TENANT: tenants.subscription_gate_disabled, the documented way
 *     support gets inside an unpaid tenant.
 *
 * Called only when the gate is about to refuse, so it costs nothing on the
 * healthy path. Fails SAFE (false): a read nobody can answer must not be the
 * thing that disables the paywall.
 */
async function isSubscriptionGateDisabled(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  // The two switches are INDEPENDENT, and each is read in its own try/catch on
  // purpose. A single shared catch let a failing `admin_settings` read skip the
  // per-tenant read entirely and answer false — so support would flip
  // tenants.subscription_gate_disabled, watch the portal open (it ORs the two
  // separately), and still get 402 from every gated function until the
  // admin_settings blip cleared. Each read failing SAFE on its own keeps the
  // paywall un-disableable by one broken query without making the other switch
  // depend on it.
  let global = false;
  try {
    const { data, error } = await supabase
      .from("admin_settings")
      .select("subscription_gate_disabled")
      .eq("subscription_gate_disabled", true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    global = !!data;
  } catch (err) {
    console.error(
      "[subscription-gate] global kill-switch read failed; treating it as OFF and still checking the tenant's own switch:",
      err,
    );
  }
  if (global) return true;

  try {
    const { data, error } = await supabase
      .from("tenants")
      .select("subscription_gate_disabled")
      .eq("id", tenantId)
      .maybeSingle();
    if (error) throw error;
    return (data as { subscription_gate_disabled?: boolean } | null)
      ?.subscription_gate_disabled === true;
  } catch (err) {
    console.error(
      "[subscription-gate] per-tenant kill-switch read failed; NOT suppressing the gate:",
      err,
    );
    return false;
  }
}

/**
 * The date the portal sorts and anchors invoices on — Stripe's own date first,
 * our INSERT time only as a last resort. Mirrors `invoiceDateOf` in
 * apps/portal/src/hooks/use-tenant-subscription.ts: created_at is stamped
 * whenever the reconciler backfills a row, so anchoring on it produced
 * fabricated dates and could expire a window that had not started.
 */
function invoiceDateOf(inv: {
  invoice_date?: string | null;
  period_end?: string | null;
  created_at: string;
}): number {
  return new Date(inv.invoice_date || inv.period_end || inv.created_at).getTime();
}

export interface SubscriptionGateOptions {
  /**
   * When true, the gate is strict: it will return a 402 even if the tenant has
   * no plans configured. Use for endpoints that should ONLY ever serve paying
   * customers (e.g. costly AI features in production). Default false.
   */
  strict?: boolean;
}

export async function requireActiveSubscription(
  supabase: SupabaseClient,
  tenantId: string,
  options: SubscriptionGateOptions = {},
): Promise<Response | null> {
  if (!tenantId) {
    return jsonResponse(
      { error: "Subscription required", code: "missing_tenant" },
      402,
    );
  }

  try {
    const { data: activeSub, error: subErr } = await supabase
      .from("tenant_subscriptions")
      .select("id, status, created_at")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (subErr) throw subErr;

    if (activeSub) {
      // past_due is allowed ONLY inside the CONFIGURED grace window.
      //
      // Stripe leaves a subscription at past_due indefinitely once its retries
      // are exhausted, so accepting the status alone meant the hard paywall was
      // enforced in the BROWSER only: after the window the UI blocked the tenant,
      // but a saved JWT could still drive every gated edge function forever.
      // This is the defence-in-depth layer, so it has to know about the window.
      //
      // The window is NOT a constant here any more. It was `const GRACE_DAYS = 7`
      // with a note saying the duplication was deliberate; that went stale the
      // moment the number became a super-admin setting
      // (admin_settings.subscription_grace_days, read by the portal in
      // use-subscription-grace-days.ts). A super admin setting 14 or 30 then got
      // a UI that honoured it and an edge gate that kept refusing at 7 — the two
      // surfaces disagreeing about whether a paying tenant is blocked. Both now
      // read the same column, the same row, with the same validation.
      if (activeSub.status !== "past_due") return null;

      // The unpaid invoices, narrowed the SAME WAY the portal narrows them
      // (`openInvoice` in use-tenant-subscription.ts), because the narrowing is
      // what decides whether the clock has started at all:
      //   - scoped to THIS subscription (or unlinked but not older than it), so
      //     a debt belonging to a dead, abandoned subscription cannot expire the
      //     window of a tenant who owes nothing on the live one
      //   - oldest by Stripe's own date, not by our INSERT time
      //
      // The cap and the ordering are BOTH on Stripe's date, and that pairing is
      // the point. A 50-row cap ordered by `created_at` could hide the very row
      // that decides the answer: `created_at` is our INSERT time, so a
      // reconciler backfilling an ancient debt stamps it NEWEST and pushes it
      // out of the window, leaving the gate to allow a tenant the portal has
      // long since blocked. Ordering by `invoice_date` keeps the oldest debts —
      // the only ones that can anchor the clock — whenever the cap bites at all.
      // 500 is far past any real tenant (production carries 2–3 invoice rows
      // each) and still one small query of four columns.
      const { data: unpaidInvoices, error: invErr } = await supabase
        .from("tenant_subscription_invoices")
        .select("created_at, invoice_date, period_end, subscription_id")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "uncollectible"])
        .order("invoice_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(500);

      if (invErr) throw invErr;

      const subCreatedMs = new Date(activeSub.created_at).getTime();
      const mine = (unpaidInvoices ?? []).filter((i: any) =>
        i.subscription_id
          ? i.subscription_id === activeSub.id
          : !Number.isNaN(subCreatedMs) && invoiceDateOf(i) >= subCreatedMs,
      );

      // No open invoice of our own → nothing is actually overdue; let them
      // through rather than blocking on missing data.
      if (mine.length === 0) return null;

      const oldest = mine.reduce((a: any, b: any) =>
        invoiceDateOf(a) <= invoiceDateOf(b) ? a : b,
      );

      const anchorMs = new Date(
        oldest.period_end || oldest.invoice_date || oldest.created_at,
      ).getTime();
      if (Number.isNaN(anchorMs)) return null; // unparseable anchor → fail open

      const graceDays = await resolveGraceDays(supabase);
      if (Date.now() < anchorMs + graceDays * 86_400_000) return null;

      if (await isSubscriptionGateDisabled(supabase, tenantId)) {
        console.log(
          `[subscription-gate] tenant ${tenantId} is past its ${graceDays}-day grace window but a subscription kill switch is on — allowing`,
        );
        return null;
      }

      return jsonResponse(
        {
          error:
            "Your subscription has expired, and your access has been canceled. Please pay your pending invoice.",
          code: "subscription_past_due_expired",
        },
        402,
      );
    }

    if (!options.strict) {
      const { count: planCount, error: planErr } = await supabase
        .from("subscription_plans")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true);

      if (planErr) throw planErr;
      // No plans yet → not the tenant's fault, let them through.
      if (!planCount || planCount === 0) return null;
    }

    // Same kill switches, same reason: support flips one to work inside a tenant
    // who has never subscribed, and the portal's gate honours it here too.
    if (await isSubscriptionGateDisabled(supabase, tenantId)) {
      console.log(
        `[subscription-gate] tenant ${tenantId} has no active subscription but a subscription kill switch is on — allowing`,
      );
      return null;
    }

    return jsonResponse(
      {
        error:
          "Your subscription is not active. Please complete setup or contact support.",
        code: "subscription_required",
      },
      402,
    );
  } catch (err) {
    console.error("[subscription-gate] check failed, failing open:", err);
    return null;
  }
}
