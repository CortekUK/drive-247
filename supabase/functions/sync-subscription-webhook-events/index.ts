import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";
import { SUBSCRIPTION_WEBHOOK_EVENTS } from "../_shared/subscription-webhook-events.ts";

/**
 * Bring every Stripe webhook endpoint's subscribed events in line with what
 * subscription-webhook actually handles.
 *
 * A handler that Stripe never sends an event to is dead code that reads as
 * working — there is no error, no log, nothing. That is exactly how three
 * invoice-closing handlers and the subscription-adoption handler sat unused.
 * The subscription is Stripe-side config, so nothing in CI or code review can
 * see the drift; this function is the check.
 *
 * It runs INSIDE Supabase deliberately: the four account/mode secret keys live
 * in the function environment, so no operator ever has to hold them to run it.
 *
 * ADDITIVE ONLY. It never removes an event someone added by hand for a reason
 * this repo does not know about.
 *
 * POST {} to preview (dry run). POST {"apply": true} to write.
 */
const ACCOUNTS = ["uk", "uae"] as const;
const MODES = ["test", "live"] as const;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Rewriting webhook configuration is a platform-wide action: a super admin,
    // or the service role (so it can be driven from inside the database without
    // any operator ever handling a Stripe key).
    const token = authHeader.replace("Bearer ", "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (token !== serviceKey) {
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) return errorResponse("Unauthorized", 401);

      const { data: appUser } = await supabase
        .from("app_users")
        .select("is_super_admin, is_active")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (!appUser?.is_super_admin || appUser.is_active === false) {
        return errorResponse("Forbidden: super admin only", 403);
      }
    }

    const body = await req.json().catch(() => ({}));
    const apply = body?.apply === true;

    const required = [...SUBSCRIPTION_WEBHOOK_EVENTS];
    const results: any[] = [];

    for (const account of ACCOUNTS) {
      for (const mode of MODES) {
        let stripe;
        try {
          stripe = getSubscriptionStripeClientForAccount(account, mode);
        } catch (e) {
          // A key we simply do not hold for this combination is not an error.
          results.push({ account, mode, skipped: `no key configured (${(e as any)?.message ?? e})` });
          continue;
        }

        try {
          const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
          const ours = endpoints.data.filter((e: any) =>
            (e.url || "").includes("/subscription-webhook")
          );

          if (ours.length === 0) {
            results.push({ account, mode, warning: "no subscription-webhook endpoint found" });
            continue;
          }

          for (const ep of ours) {
            const existing: string[] = ep.enabled_events || [];
            // A wildcard already covers everything.
            if (existing.includes("*")) {
              results.push({ account, mode, endpoint: ep.id, action: "none", reason: "endpoint receives all events" });
              continue;
            }
            const missing = required.filter((e) => !existing.includes(e));
            if (missing.length === 0) {
              results.push({ account, mode, endpoint: ep.id, action: "none", enabled: existing.length });
              continue;
            }
            if (!apply) {
              results.push({ account, mode, endpoint: ep.id, action: "would-add", missing });
              continue;
            }
            const merged = Array.from(new Set([...existing, ...required]));
            await stripe.webhookEndpoints.update(ep.id, { enabled_events: merged as any });
            results.push({ account, mode, endpoint: ep.id, action: "added", missing, now: merged.length });
            console.log(`Added ${missing.length} events to ${account}/${mode} endpoint ${ep.id}: ${missing.join(", ")}`);
          }
        } catch (e) {
          results.push({ account, mode, error: (e as any)?.message ?? String(e) });
        }
      }
    }

    return jsonResponse({
      applied: apply,
      requiredEvents: required,
      results,
    });
  } catch (error) {
    console.error("sync-subscription-webhook-events failed:", error);
    return errorResponse((error as any)?.message || "Internal server error", 500);
  }
});
