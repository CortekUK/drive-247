// revoke-subscription-link — kill a link AND the Stripe session behind it.
//
// Revoking used to be a bare status UPDATE from the browser. That marks our row
// dead and does nothing to Stripe, so the prospect's already-open checkout tab
// stayed payable: George revokes mid-call, is told "it can no longer be paid",
// and the client pays anyway. Because a session's expiry is clamped to at least
// now+30min, one minted near the end of a link's life outlives the link by up to
// half an hour.
//
// A browser cannot call Stripe, which is why this has to be a function rather
// than an RLS policy. With it in place the narrow pending->revoked UPDATE policy
// is no longer needed and is dropped, so the table goes back to being
// service_role-write-only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getSubscriptionStripeClientForAccount } from "../_shared/subscription-stripe.ts";
import { expireLinkSession } from "../_shared/subscription-link.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user }, error: userError } =
      await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: appUser } = await supabase
      .from("app_users").select("id, is_active, is_super_admin")
      .eq("auth_user_id", user.id).maybeSingle();
    if (!appUser?.is_active || appUser?.is_super_admin !== true) {
      return errorResponse("Only super admins can revoke a subscription link", 403);
    }

    const { linkId } = await req.json().catch(() => ({}));
    if (!linkId) return errorResponse("linkId is required", 400);

    const { data: link } = await supabase
      .from("subscription_links")
      .select("id, status, tenant_id, last_session_id, last_session_expires_at, stripe_account_snapshot, stripe_mode_snapshot")
      .eq("id", linkId)
      .maybeSingle();
    if (!link) return errorResponse("Link not found", 404);

    if (link.status === "paid") {
      return jsonResponse({ error: "This link has already been paid — it cannot be revoked.", code: "already_paid" }, 409);
    }
    if (link.status !== "pending") {
      return jsonResponse({ success: true, alreadyTerminal: link.status, sessionExpired: false });
    }

    // Stripe FIRST. If we flipped the row first and then failed here, the admin
    // would be told the link is dead while it is still payable — the exact
    // failure being fixed.
    const stripe = getSubscriptionStripeClientForAccount(
      link.stripe_account_snapshot as "uk" | "uae",
      link.stripe_mode_snapshot as "test" | "live",
    );
    const sessionExpired = await expireLinkSession(stripe, link);

    const { error } = await supabase
      .from("subscription_links")
      .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: appUser.id })
      .eq("id", link.id)
      .eq("status", "pending");
    if (error) return errorResponse(error.message, 500);

    await supabase.from("audit_logs").insert({
      action: "subscription_link_revoked",
      tenant_id: link.tenant_id,
      entity_type: "subscription_link",
      entity_id: link.id,
      actor_id: appUser.id,
      is_super_admin_action: true,
      details: { session_expired: sessionExpired },
    });

    return jsonResponse({ success: true, sessionExpired });
  } catch (err) {
    console.error("[revoke-subscription-link] failed:", err);
    return errorResponse((err as { message?: string })?.message ?? "Failed to revoke", 500);
  }
});
