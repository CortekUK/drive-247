// stripe-disconnect-v2 — an operator unlinks their OWN Stripe account.
//
// Ghulam, Oct 2 2026: disconnecting Stripe should be possible from the
// Integrations dialog, like Square, Xero and Zoho. Until now the only way an
// own-model operator unlinked was revoking Drive247 from their own Stripe
// settings, after which `stripe-connect-webhook` (account.application.
// deauthorized) cleared the row. This function does the same thing on the
// operator's behalf, from Drive247's side:
//
//   1. Only an admin / head_admin of THIS tenant, or a super admin.
//   2. Only the OWN model (an OAuth-linked Standard account on the UAE
//      platform). A managed/Express account was created by Drive247 and is
//      unlinked by support — refused here with that sentence.
//   3. Ask Stripe to revoke the platform's access (oauth.deauthorize).
//   4. Apply exactly what the webhook applies: clear own_stripe_account_id +
//      own_stripe_connected_at and revert payment_model to 'managed', so the
//      tenant is never left on 'own' with no account (every live charge would
//      throw — see getConnectAccountId). The webhook that Stripe then sends is
//      idempotent against an already-cleared row.
//
// v2 (V2_PLAN §7): a new function, not an edit to any existing one.
// ⚠️ ISOLATION: the tenant id comes from the body, so the caller is checked
// against it before anything is read or written; every query is scoped by it.

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getStripeClientForAccount } from "../_shared/stripe-client.ts";

async function authorizeCaller(req: Request, tenantId: string): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse("Missing authorization header", 401);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return errorResponse("Unauthorized", 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: appUser } = await admin
    .from("app_users")
    .select("is_super_admin, tenant_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (appUser?.is_super_admin === true) return null;
  const allowed =
    appUser?.tenant_id === tenantId && (appUser?.role === "head_admin" || appUser?.role === "admin");
  return allowed ? null : errorResponse("Not authorized to disconnect Stripe for this tenant", 403);
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { tenantId } = await req.json();
    if (!tenantId || typeof tenantId !== "string") return errorResponse("tenantId is required");

    const authError = await authorizeCaller(req, tenantId);
    if (authError) return authError;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: tenant, error } = await admin
      .from("tenants")
      .select("id, payment_model, own_stripe_account_id")
      .eq("id", tenantId)
      .single();
    if (error || !tenant) return errorResponse("Tenant not found", 404);

    if (tenant.payment_model !== "own" || !tenant.own_stripe_account_id) {
      return errorResponse(
        "This Stripe account was set up for you by Drive247, so support unlinks it. Contact support and we'll take care of it.",
        409,
      );
    }

    // The own account is always linked through the LIVE UAE platform (see
    // stripe-oauth-start), so that is the client id it is revoked from.
    const clientId = Deno.env.get("STRIPE_UAE_OAUTH_CLIENT_ID_LIVE");
    if (!clientId) return errorResponse("Stripe disconnect is not configured", 500);

    const stripe = getStripeClientForAccount("uae", "live");
    try {
      await stripe.oauth.deauthorize({ client_id: clientId, stripe_user_id: tenant.own_stripe_account_id });
    } catch (e) {
      // Already revoked on Stripe's side is not a failure — the row still has
      // to be cleared. Anything else stops before the row is touched.
      const message = e instanceof Error ? e.message : String(e);
      if (!/not connected|no such|invalid_client|already/i.test(message)) {
        return errorResponse(`Stripe refused the disconnect: ${message}`, 502);
      }
    }

    const { error: updateError } = await admin
      .from("tenants")
      .update({ own_stripe_account_id: null, own_stripe_connected_at: null, payment_model: "managed" })
      .eq("id", tenantId)
      .eq("own_stripe_account_id", tenant.own_stripe_account_id);
    if (updateError) return errorResponse(`Disconnected in Stripe, but the account could not be cleared here: ${updateError.message}`, 500);

    return jsonResponse({ success: true });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : "Unexpected error", 500);
  }
});
