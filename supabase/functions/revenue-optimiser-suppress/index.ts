/**
 * revenue-optimiser-suppress — Phase 3, super-admin only.
 *
 * Super-admin reviewing the anomaly inbox can suppress a single recommendation
 * (e.g. it's clearly bad data, or the algorithm produced a weird suggestion
 * we don't want any tenant to see). Marks the rec `status='suppressed_by_admin'`
 * — same downstream effect as 'dismissed' (it won't be applied) but auditable
 * separately via the suppressed_by / suppressed_at columns added by Phase 3.
 *
 * If the rec was already applied (status='applied'), this fn refuses — that
 * path should go through `revenue-optimiser-revert` instead.
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

    // Resolve caller (JWT)
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
      .select("id, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser?.is_super_admin) {
      return errorResponse("Super-admin only", 403);
    }

    const { data: rec } = await supabase
      .from("pricing_recommendations")
      .select("id, status, tenant_id")
      .eq("id", body.recommendationId)
      .maybeSingle();
    if (!rec) return errorResponse("Recommendation not found", 404);

    if (!["pending", "pending_approval", "snoozed"].includes(rec.status)) {
      return errorResponse(
        `Cannot suppress a ${rec.status} recommendation — applied recs must be reverted, not suppressed`,
        409,
      );
    }

    const { data: updated, error: updErr } = await supabase
      .from("pricing_recommendations")
      .update({
        status: "suppressed_by_admin",
        suppressed_at: new Date().toISOString(),
        suppressed_by: appUser.id,
        suppress_reason: body.reason?.slice(0, 500) ?? null,
      })
      .eq("id", rec.id)
      .select("*")
      .single();
    if (updErr) return errorResponse(updErr.message ?? "Failed to suppress", 500);

    return jsonResponse({ ok: true, recommendation: updated });
  } catch (err) {
    console.error("revenue-optimiser-suppress error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
