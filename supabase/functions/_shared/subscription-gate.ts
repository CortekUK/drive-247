// Defense-in-depth subscription gate for tenant-facing edge functions.
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
    if (activeSub) return null;

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
