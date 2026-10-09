// subscription-pause — a v2 tenant pauses their Drive247 subscription.
//
// Called by the tenant's own portal user (Billing → Pause). Two actions:
//
//   { action: "request", startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
//       Checks who may pause (Super Admin → Pausing Accounts: the pilot
//       tenant only, or every v2 tenant), the subscription, and the date rules
//       in _shared/subscription-pause.ts. Records the pause; if it starts
//       today, pauses Stripe collection at once. A later start is picked up by
//       subscription-pause-run.
//
//   { action: "end" }
//       A scheduled pause is cancelled; a running one ends now and Stripe
//       collection is switched back on.
//
// While paused, nothing is deleted. The database refuses new rentals, vehicles
// and customers and the booking site shows "Booking on hold" — both from the
// pause row's dates (migration 20261009170000), not from anything here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkPause, errText, stripePause, stripeResume } from "../_shared/subscription-pause.ts";

/** Roles that may act on billing from the portal. Viewers and ops may not. */
const BILLING_ROLES = new Set(["head_admin", "admin", "manager"]);

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const { data: appUser } = await db
      .from("app_users")
      .select("id, tenant_id, role, is_active")
      .eq("auth_user_id", user.id)
      .not("tenant_id", "is", null)
      .maybeSingle();
    if (!appUser || appUser.is_active === false) return errorResponse("Unauthorized", 401);
    if (!BILLING_ROLES.has(appUser.role)) {
      return errorResponse("Only an admin of this account can pause the subscription", 403);
    }
    const tenantId: string = appUser.tenant_id;

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const now = new Date();

    // A pause whose end has passed is over whatever its status says; close it
    // so it never blocks the next one (the runner does the same every 5 min).
    await db
      .from("tenant_subscription_pauses")
      .update({ status: "ended", ended_at: now.toISOString(), updated_at: now.toISOString() })
      .eq("tenant_id", tenantId)
      .in("status", ["scheduled", "active"])
      .lte("ends_at", now.toISOString());

    const { data: open } = await db
      .from("tenant_subscription_pauses")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("status", ["scheduled", "active"])
      .maybeSingle();

    const { data: sub } = await db
      .from("tenant_subscriptions")
      .select("stripe_subscription_id, stripe_account, status, current_period_end, interval, trial_end, cancel_at")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    /* ── End / cancel ─────────────────────────────────────────────────────── */

    if (action === "end") {
      if (!open) return errorResponse("There is no pause to end", 409);
      const running = new Date(open.starts_at).getTime() <= now.getTime();
      const patch: Record<string, unknown> = {
        status: running ? "ended" : "cancelled",
        ended_at: now.toISOString(),
        ended_by: appUser.id,
        updated_at: now.toISOString(),
      };
      if (open.stripe_status === "applied") {
        try {
          await stripeResume(db, tenantId, {
            stripe_subscription_id: open.stripe_subscription_id ?? sub?.stripe_subscription_id ?? null,
            stripe_account: sub?.stripe_account ?? null,
          });
          patch.stripe_status = "resumed";
          patch.stripe_error = null;
        } catch (e) {
          // Billing must not stay paused behind the tenant's back: refuse, and
          // leave the pause as it is so they (or we) can try again.
          console.error("subscription-pause: resume failed", tenantId, errText(e));
          return errorResponse(`Could not switch billing back on: ${errText(e)}`, 502);
        }
      } else if (open.stripe_status === "pending") {
        patch.stripe_status = "not_needed";
      }
      await db.from("tenant_subscription_pauses").update(patch).eq("id", open.id);
      return jsonResponse({ success: true, status: patch.status });
    }

    /* ── Request ──────────────────────────────────────────────────────────── */

    if (action !== "request") return errorResponse("Unknown action", 400);

    const { data: allowed, error: allowedError } = await db.rpc("subscription_pause_allowed", { p_tenant_id: tenantId });
    if (allowedError) throw allowedError;
    if (!allowed) return errorResponse("Pausing isn't available for this account", 403);

    if (open) return errorResponse("This account already has a pause booked", 409);

    if (!sub?.stripe_subscription_id) return errorResponse("There is no active subscription to pause", 409);
    if (sub.status === "past_due") {
      return errorResponse("Please pay the outstanding bill before pausing", 409);
    }
    if (sub.status === "trialing" || (sub.trial_end && new Date(sub.trial_end).getTime() > now.getTime())) {
      return errorResponse("You can pause once your free trial has ended", 409);
    }
    if (sub.cancel_at) return errorResponse("This subscription is already set to end", 409);
    if (!sub.current_period_end) return errorResponse("The billing date isn't known yet, please try again later", 409);

    const check = checkPause({
      startDate: String(body?.startDate ?? ""),
      endDate: String(body?.endDate ?? ""),
      now,
      knownBill: new Date(sub.current_period_end),
      interval: sub.interval || "month",
    });
    if (!check.ok) return jsonResponse({ success: false, code: check.code, error: check.message }, 422);

    const { data: row, error: insertError } = await db
      .from("tenant_subscription_pauses")
      .insert({
        tenant_id: tenantId,
        start_date: check.startDate,
        end_date: check.endDate,
        months: check.months,
        starts_at: check.startsAt.toISOString(),
        ends_at: check.endsAt.toISOString(),
        status: "scheduled",
        stripe_subscription_id: sub.stripe_subscription_id,
        requested_by: appUser.id,
      })
      .select("*")
      .single();
    if (insertError) {
      if ((insertError as { code?: string }).code === "23505") {
        return errorResponse("This account already has a pause booked", 409);
      }
      throw insertError;
    }

    // Starts today: pause Stripe now rather than on the runner's next tick.
    if (check.startsAt.getTime() <= now.getTime()) {
      const patch: Record<string, unknown> = { status: "active", stripe_attempts: 1, updated_at: new Date().toISOString() };
      try {
        await stripePause(db, tenantId, sub, check.endsAt);
        patch.stripe_status = "applied";
      } catch (e) {
        patch.stripe_status = "failed";
        patch.stripe_error = errText(e);
        console.error("subscription-pause: Stripe pause failed", tenantId, patch.stripe_error);
      }
      await db.from("tenant_subscription_pauses").update(patch).eq("id", row.id);
      Object.assign(row, patch);
    }

    return jsonResponse({ success: true, pause: row });
  } catch (error) {
    console.error("subscription-pause error:", errText(error));
    return errorResponse(errText(error) || "Internal server error", 500);
  }
});
