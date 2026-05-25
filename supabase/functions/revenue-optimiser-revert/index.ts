/**
 * revenue-optimiser-revert — Spec §10.
 *
 * Operator regrets applying a recommendation. We:
 *   1. Find the pricing_change_history row for the applied rec
 *   2. Restore vehicles.{tier}_rent to old_price
 *   3. INSERT a new pricing_change_history row (source='revert')
 *   4. Mark the rec status='reverted'
 *
 * Old_price is sourced from the audit log — even if there have been other
 * price changes since the apply, revert restores the price at the time of
 * the apply (not "undo last change"). Operator gets the predictable behavior
 * of "this rec didn't work, take it back".
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  recommendationId?: string;
  reason?: string;
}

const TIER_TO_COLUMN: Record<string, string> = {
  daily: "daily_rent",
  weekly: "weekly_rent",
  monthly: "monthly_rent",
};

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
      .select("*")
      .eq("id", body.recommendationId)
      .maybeSingle();
    if (!rec) return errorResponse("Recommendation not found", 404);
    if (!appUser.is_super_admin && rec.tenant_id !== appUser.tenant_id) {
      return errorResponse("Not your tenant's recommendation", 403);
    }
    if (rec.status !== "applied") {
      return errorResponse(`Cannot revert — recommendation is ${rec.status}`, 409);
    }

    // Find the audit row created at apply time (most recent ai_recommendation/manual for this rec)
    const { data: pch } = await supabase
      .from("pricing_change_history")
      .select("*")
      .eq("recommendation_id", rec.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pch) return errorResponse("Original price-change record not found", 404);

    const tierCol = TIER_TO_COLUMN[rec.tier as keyof typeof TIER_TO_COLUMN];
    if (!tierCol) return errorResponse(`Unsupported tier: ${rec.tier}`, 400);

    const { data: vehicle } = await supabase
      .from("vehicles")
      .select(`id, ${tierCol}`)
      .eq("id", rec.vehicle_id)
      .maybeSingle();
    if (!vehicle) return errorResponse("Vehicle no longer exists", 410);

    const currentPrice = Number((vehicle as Record<string, unknown>)[tierCol] ?? 0);
    const revertPrice = Number(pch.old_price ?? 0);
    if (!Number.isFinite(revertPrice) || revertPrice <= 0) {
      return errorResponse("Cannot revert — no valid original price recorded", 500);
    }

    // Restore vehicle price
    const { error: vehErr } = await supabase
      .from("vehicles")
      .update({ [tierCol]: revertPrice })
      .eq("id", rec.vehicle_id);
    if (vehErr) return errorResponse(vehErr.message ?? "Failed to restore vehicle price", 500);

    // Audit
    await supabase.from("pricing_change_history").insert({
      tenant_id: rec.tenant_id,
      vehicle_id: rec.vehicle_id,
      tier: rec.tier,
      old_price: currentPrice,
      new_price: revertPrice,
      change_source: "revert",
      recommendation_id: rec.id,
      changed_by: appUser.id,
      notes: body.reason?.slice(0, 500) ?? null,
    });

    // Mark rec reverted
    const { data: updated } = await supabase
      .from("pricing_recommendations")
      .update({
        status: "reverted",
        reverted_at: new Date().toISOString(),
        reverted_by: appUser.id,
        revert_reason: body.reason?.slice(0, 500) ?? null,
      })
      .eq("id", rec.id)
      .select("*")
      .single();

    return jsonResponse({
      ok: true,
      recommendation: updated,
      restored_price: revertPrice,
      previous_price: currentPrice,
    });
  } catch (err) {
    console.error("revenue-optimiser-revert error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
