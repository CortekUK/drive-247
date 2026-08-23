// create-subscription-link — mint a 24h anonymous subscription payment link.
//
// SUPER ADMIN ONLY. Not sales agents: the admin app confines them with a
// client-side router.replace, which is not an authorization boundary, and this
// function mints payable links and drives a branded mailer. Putting the
// platform's sending reputation for all 47 tenants behind the lowest-privilege
// admin role is not a trade worth making.
//
// Nothing about money is accepted from the caller — no amount, no currency, no
// success/cancel URL. Everything is resolved server-side and frozen onto the row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { issueSubscriptionLink } from "../_shared/subscription-link.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, is_active, is_super_admin")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!appUser?.is_active || appUser?.is_super_admin !== true) {
      return errorResponse("Only super admins can generate subscription links", 403);
    }

    const body = await req.json().catch(() => ({}));
    const tenantId = body?.tenantId;
    if (!tenantId) return errorResponse("tenantId is required", 400);

    const result = await issueSubscriptionLink(supabase, {
      tenantId,
      planId: body?.planId ?? null,
      kind: body?.kind,
      createdBy: appUser.id,
    });

    if (!result.ok) {
      return jsonResponse({ error: result.message, code: result.code }, result.httpStatus);
    }

    // `token` leaves the server exactly once, in this response. It is stored only
    // as a hash, so once George's screen is gone the plaintext is unrecoverable —
    // the panel then offers Regenerate & send, which is the flow the meeting
    // asked for anyway.
    return jsonResponse(result);
  } catch (err) {
    console.error("[create-subscription-link] failed:", err);
    return errorResponse((err as { message?: string })?.message ?? "Failed to create link", 500);
  }
});
