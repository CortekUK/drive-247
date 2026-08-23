// sweep-subscription-links — expire links whose 24 hours are up, and tell George.
//
// Redemption already expires a link lazily the moment anyone opens it, so this
// exists for the case that actually matters commercially: NOBODY opened it. A
// prospect who never clicked is exactly the one George needs to chase, and no
// amount of lazy expiry will ever surface them, because lazy expiry needs a
// visitor. Expiry is a pure clock event — nothing can push it.
//
// verify_jwt = false because pg_cron carries no user JWT. It is NOT anonymously
// callable: the caller must present x-platform-secret (validated by the
// platform_verify_secret RPC) or a super-admin JWT, exactly like the other
// DB-driven functions here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── authenticate: platform secret (cron) or super-admin JWT (manual) ────
    let authorized = false;
    const secret = req.headers.get("x-platform-secret");
    if (secret) {
      const { data: ok, error: rpcError } = await supabase.rpc("platform_verify_secret", { p_secret: secret });
      if (rpcError) console.error("platform_verify_secret rpc failed", rpcError);
      authorized = ok === true;
    }
    if (!authorized) {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const supabaseAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
        const { data: { user } } = await supabaseAuth.auth.getUser(authHeader.replace("Bearer ", ""));
        if (user) {
          const { data: appUser } = await supabase
            .from("app_users").select("is_super_admin").eq("auth_user_id", user.id).single();
          authorized = appUser?.is_super_admin === true;
        }
      }
    }
    if (!authorized) return errorResponse("Unauthorized", 401);

    const nowIso = new Date().toISOString();

    // Claim the rows in one statement. `.eq('status','pending')` is the claim:
    // two overlapping sweeps cannot both expire the same link, so the audit row
    // below is written at most once per link.
    const { data: expired, error } = await supabase
      .from("subscription_links")
      .update({ status: "expired", expired_at: nowIso })
      .lt("expires_at", nowIso)
      .eq("status", "pending")
      .select("id, tenant_id, kind, amount_snapshot, currency_snapshot, plan_name_snapshot, mint_count, payment_attempted_at, sent_at");

    if (error) {
      console.error("[sweep-subscription-links] update failed:", error);
      return errorResponse(error.message, 500);
    }

    const rows = expired ?? [];

    // One audit row per expired link. trg_audit_log_platform_push turns this into
    // a push for every super admin who ticked "Payment link expired unpaid" —
    // no bespoke notification code, and it respects their existing preferences.
    //
    // NO PII: sent_to is deliberately never copied into audit details.
    for (const r of rows) {
      try {
        await supabase.from("audit_logs").insert({
          action: "subscription_link_expired",
          tenant_id: r.tenant_id,
          entity_type: "subscription_link",
          entity_id: r.id,
          actor_id: null,
          is_super_admin_action: false,
          details: {
            kind: r.kind,
            plan_name: r.plan_name_snapshot,
            amount: r.amount_snapshot,
            currency: r.currency_snapshot,
            // The useful distinction for whoever chases this up: never opened at
            // all, opened but never paid, or opened and the card was declined.
            opened: (r.mint_count ?? 0) > 0,
            was_emailed: !!r.sent_at,
            card_declined: !!r.payment_attempted_at,
          },
        });
      } catch (e) {
        console.error(`[sweep-subscription-links] audit insert failed for ${r.id}:`, e);
      }
    }

    console.log(`[sweep-subscription-links] expired ${rows.length} link(s)`);
    return jsonResponse({ success: true, expired: rows.length, ids: rows.map((r) => r.id) });
  } catch (err) {
    console.error("[sweep-subscription-links] failed:", err);
    return errorResponse((err as { message?: string })?.message ?? "sweep failed", 500);
  }
});
