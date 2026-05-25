/**
 * revenue-optimiser-apply — Spec §10 + §13.
 *
 * Operator clicks Apply on a recommendation. We:
 *   1. Verify the recommendation belongs to the caller's tenant
 *   2. Validate the price (max swing, cost floor) — operator may pass customPrice
 *   3. UPDATE vehicles.{tier}_rent
 *   4. INSERT pricing_change_history (immutable audit log)
 *   5. UPDATE the recommendation row to status='applied' with metadata
 *
 * Returns the updated recommendation and the change_history row id.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  recommendationId?: string;
  customPrice?: number;
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
      .select("id, tenant_id, role, is_super_admin")
      .eq("auth_user_id", userResp.user.id)
      .maybeSingle();
    if (!appUser) return errorResponse("App user not found", 403);

    // 1. Load rec + verify tenant ownership
    const { data: rec, error: recErr } = await supabase
      .from("pricing_recommendations")
      .select("*")
      .eq("id", body.recommendationId)
      .maybeSingle();
    if (recErr || !rec) return errorResponse("Recommendation not found", 404);

    const callerTenantId = appUser.tenant_id ?? rec.tenant_id;
    const isSuper = appUser.is_super_admin === true;
    if (!isSuper && rec.tenant_id !== callerTenantId) {
      return errorResponse("Recommendation does not belong to your tenant", 403);
    }
    if (rec.status !== "pending") {
      return errorResponse(`Cannot apply — recommendation is ${rec.status}`, 409);
    }

    // 2. Load tenant settings + vehicle (for safety-rail validation)
    const { data: settings } = await supabase
      .from("revenue_optimiser_settings")
      .select("max_swing_percent, cost_floor_enabled, require_approval_above_amount")
      .eq("tenant_id", rec.tenant_id)
      .maybeSingle();
    const { data: vehicle } = await supabase
      .from("vehicles")
      .select("id, tenant_id, daily_rent, weekly_rent, monthly_rent, cost_floor_daily, cost_floor_weekly, cost_floor_monthly")
      .eq("id", rec.vehicle_id)
      .maybeSingle();
    if (!vehicle) return errorResponse("Vehicle no longer exists", 410);

    const tierCol = TIER_TO_COLUMN[rec.tier as keyof typeof TIER_TO_COLUMN];
    if (!tierCol) return errorResponse(`Unsupported tier: ${rec.tier}`, 400);
    const currentPrice = Number((vehicle as Record<string, unknown>)[tierCol] ?? 0);

    // Operator's chosen price (defaults to the recommended price)
    const targetPrice = body.customPrice != null ? Number(body.customPrice) : Number(rec.recommended_price);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      return errorResponse("Invalid target price", 400);
    }

    // Max swing
    const maxSwingPercent = Number(settings?.max_swing_percent ?? 15);
    const minAllowed = currentPrice * (1 - maxSwingPercent / 100);
    const maxAllowed = currentPrice * (1 + maxSwingPercent / 100);
    if (targetPrice < minAllowed || targetPrice > maxAllowed) {
      return errorResponse(
        `Price ${targetPrice} is outside the ±${maxSwingPercent}% swing window (${Math.round(minAllowed)} – ${Math.round(maxAllowed)})`,
        400,
      );
    }

    // Cost floor
    if (settings?.cost_floor_enabled !== false) {
      const floorCol = `cost_floor_${rec.tier}` as const;
      const floor = Number((vehicle as Record<string, unknown>)[floorCol] ?? 0);
      if (floor > 0 && targetPrice < floor) {
        return errorResponse(
          `Price ${targetPrice} is below the cost floor (${floor}) for this vehicle`,
          400,
        );
      }
    }

    const usedCustomPrice = body.customPrice != null && Number(body.customPrice) !== Number(rec.recommended_price);
    const changeSource = usedCustomPrice ? "manual" : "ai_recommendation";

    // 3. UPDATE vehicles.{tier}_rent
    const { error: vehErr } = await supabase
      .from("vehicles")
      .update({ [tierCol]: targetPrice })
      .eq("id", rec.vehicle_id);
    if (vehErr) {
      console.error("vehicles update error:", vehErr);
      return errorResponse(vehErr.message ?? "Failed to update vehicle price", 500);
    }

    // 4. INSERT immutable audit log (Spec §13.10)
    await supabase.from("pricing_change_history").insert({
      tenant_id: rec.tenant_id,
      vehicle_id: rec.vehicle_id,
      tier: rec.tier,
      old_price: currentPrice,
      new_price: targetPrice,
      change_source: changeSource,
      recommendation_id: rec.id,
      changed_by: appUser.id,
    });

    // 5. Mark rec as applied
    const { data: applied, error: applyErr } = await supabase
      .from("pricing_recommendations")
      .update({
        status: "applied",
        applied_at: new Date().toISOString(),
        applied_by: appUser.id,
        applied_price: targetPrice,
        applied_source: "manual",
      })
      .eq("id", rec.id)
      .select("*")
      .single();
    if (applyErr) {
      console.error("recommendation status update error:", applyErr);
      return errorResponse(applyErr.message ?? "Failed to mark applied", 500);
    }

    return jsonResponse({
      ok: true,
      recommendation: applied,
      old_price: currentPrice,
      new_price: targetPrice,
      used_custom_price: usedCustomPrice,
    });
  } catch (err) {
    console.error("revenue-optimiser-apply error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
