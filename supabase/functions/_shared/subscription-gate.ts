// Defense-in-depth subscription gate for tenant-facing edge functions.
//
// ⚠️ CURRENTLY UNUSED. As of 2026-07-28 nothing imports this module — a repo-wide
// search for `requireActiveSubscription` finds only this file and the usage
// example below. The subscription paywall is therefore enforced in the BROWSER
// ONLY: a caller with a saved JWT can still drive every edge function directly,
// whatever their subscription state. The logic here is correct and ready, but
// wiring it into the sensitive functions is still outstanding work — do not read
// this file's existence as evidence that server-side gating is in place.
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
//   - has an active / trialing / past_due subscription, OR
//   - has no active subscription_plans configured (can't subscribe yet)
//
// Returns a 402 Response when the tenant must subscribe before continuing.
//
// Fails OPEN (returns null) on unexpected errors to avoid taking the platform
// offline on a transient DB hiccup. The middleware/UI gates remain in place.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

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
      .select("id, status")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (subErr) throw subErr;

    if (activeSub) {
      // past_due is allowed ONLY inside the 7-day grace window.
      //
      // Stripe leaves a subscription at past_due indefinitely once its retries
      // are exhausted, so accepting the status alone meant the hard paywall was
      // enforced in the BROWSER only: after day 7 the UI blocked the tenant, but
      // a saved JWT could still drive every gated edge function forever. This is
      // the defence-in-depth layer, so it has to know about the grace window too.
      //
      // Anchored on the oldest still-open invoice, matching
      // apps/portal/src/hooks/use-tenant-subscription.ts. Keep the two in step —
      // GRACE_DAYS is duplicated deliberately (separate build roots), so a change
      // in one must be mirrored in the other.
      if (activeSub.status !== "past_due") return null;

      const { data: openInvoices, error: invErr } = await supabase
        .from("tenant_subscription_invoices")
        .select("created_at, period_end")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "uncollectible"])
        .order("created_at", { ascending: true })
        .limit(1);

      if (invErr) throw invErr;

      const oldest = openInvoices?.[0];
      // No open invoice → nothing is actually overdue; let them through rather
      // than blocking on missing data.
      if (!oldest) return null;

      const GRACE_DAYS = 7;
      const anchorMs = new Date(oldest.period_end || oldest.created_at).getTime();
      if (Number.isNaN(anchorMs)) return null; // unparseable anchor → fail open
      if (Date.now() < anchorMs + GRACE_DAYS * 86_400_000) return null;

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
