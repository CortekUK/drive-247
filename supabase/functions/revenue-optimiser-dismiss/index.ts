/**
 * revenue-optimiser-dismiss — Spec §10.
 *
 * Operator dismisses a recommendation. Writes the reason + actor to the rec
 * row; the next daily generate cron will re-evaluate the same vehicle.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  recommendationId?: string;
  reason?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.recommendationId) return errorResponse("recommendationId is required");

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userResp } = await userClient.auth.getUser();
    if (!userResp?.user) return errorResponse("Unauthorised", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: appUser } = await supabase
      .from("app_users")
      .select("id, tenant_id, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);

    const { data: rec } = await supabase
      .from("pricing_recommendations")
      .select("id, tenant_id, status")
      .eq("id", body.recommendationId)
      .maybeSingle();
    if (!rec) return errorResponse("Recommendation not found", 404);
    if (!appUser.is_super_admin && rec.tenant_id !== appUser.tenant_id) {
      return errorResponse("Not your tenant's recommendation", 403);
    }
    if (rec.status !== "pending") {
      return errorResponse(`Cannot dismiss — recommendation is ${rec.status}`, 409);
    }

    const { data: updated, error: updErr } = await supabase
      .from("pricing_recommendations")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        dismissed_by: appUser.id,
        dismiss_reason: body.reason?.slice(0, 500) ?? null,
      })
      .eq("id", rec.id)
      .select("*")
      .single();
    if (updErr) return errorResponse(updErr.message ?? "Failed to dismiss", 500);

    return jsonResponse({ ok: true, recommendation: updated });
  } catch (err) {
    console.error("revenue-optimiser-dismiss error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
