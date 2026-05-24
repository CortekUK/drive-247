/**
 * accept-offer — Spec Section 6.6.
 *
 * Public endpoint (verify_jwt=false). Customer picks a vehicle + confirms dates.
 *
 * Validates:
 *   - offer exists, not expired, status ∈ ('pending','viewed')
 *   - vehicle is in the offer's vehicles array
 *   - selected dates within default ± date_flex_days
 *   - vehicle is still available for those dates (concurrency guard)
 *
 * Transitions lead → 'offer_accepted', updates lead_offers, emits lead.offer_accepted.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  shortCode?: string;
  vehicleId?: string;
  startDate?: string;
  endDate?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.shortCode || !body.vehicleId || !body.startDate || !body.endDate) {
      return errorResponse("shortCode, vehicleId, startDate, endDate required");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: offer } = await supabase
      .from("lead_offers")
      .select("*")
      .eq("short_code", body.shortCode)
      .maybeSingle();
    if (!offer) return jsonResponse({ status: "not_found" }, 404);

    if (new Date(offer.expires_at).getTime() < Date.now()) {
      return jsonResponse({ status: "expired" }, 410);
    }
    if (!["pending", "viewed"].includes(offer.status)) {
      return jsonResponse({ status: "already_accepted" }, 409);
    }

    const vehiclesArr = Array.isArray(offer.vehicles) ? (offer.vehicles as { vehicleId: string }[]) : [];
    if (!vehiclesArr.some((v) => v.vehicleId === body.vehicleId)) {
      return errorResponse("Vehicle not part of this offer", 400);
    }

    // Vehicle may have been deleted/retired between offer creation and acceptance.
    // Without this guard we'd hit a FK violation on the leads update and return a
    // confusing 500 — instead, surface a clean "vehicle_unavailable" so the
    // customer can pick another from the same offer.
    const { data: vehicleRow } = await supabase
      .from("vehicles")
      .select("id, tenant_id, status")
      .eq("id", body.vehicleId)
      .maybeSingle();
    if (!vehicleRow || vehicleRow.tenant_id !== offer.tenant_id) {
      return jsonResponse({ status: "vehicle_unavailable", reason: "removed", availableVehicles: vehiclesArr }, 409);
    }
    // Retired / maintenance / inactive — anything not actively rentable.
    if (vehicleRow.status && !["Active", "active", "available"].includes(vehicleRow.status)) {
      return jsonResponse({ status: "vehicle_unavailable", reason: "retired", availableVehicles: vehiclesArr }, 409);
    }

    // Date flex check
    const flex = offer.date_flex_days ?? 0;
    const sd = Date.parse(body.startDate);
    const ed = Date.parse(body.endDate);
    const defSd = Date.parse(offer.default_start_date);
    const defEd = Date.parse(offer.default_end_date);
    if (Math.abs(sd - defSd) > flex * 86400_000 || Math.abs(ed - defEd) > flex * 86400_000) {
      return errorResponse("Dates outside the flex window", 400);
    }
    if (ed < sd) return errorResponse("End date must be ≥ start date", 400);

    // Concurrency guard — re-check availability
    const overlapStart = body.startDate;
    const overlapEnd = body.endDate;
    const { data: overlaps } = await supabase
      .from("rentals")
      .select("id, start_date, end_date, status")
      .eq("vehicle_id", body.vehicleId)
      .lte("start_date", overlapEnd)
      .gte("end_date", overlapStart);
    const blocked = (overlaps ?? []).filter((r) => ["Active", "Pending", "Confirmed"].includes(r.status));
    if (blocked.length > 0) {
      return jsonResponse({ status: "vehicle_unavailable", availableVehicles: vehiclesArr }, 409);
    }

    // Update offer
    await supabase
      .from("lead_offers")
      .update({
        status: "accepted",
        accepted_vehicle_id: body.vehicleId,
        accepted_start_date: body.startDate,
        accepted_end_date: body.endDate,
        accepted_at: new Date().toISOString(),
      })
      .eq("id", offer.id);

    // Transition lead to offer_accepted
    await supabase
      .from("leads")
      .update({ stage: "offer_accepted", vehicle_id: body.vehicleId, start_date: body.startDate, end_date: body.endDate })
      .eq("id", offer.lead_id);

    // Emit event + activity
    await supabase.rpc("notify_automation_event", {
      p_event_type: "lead.offer_accepted",
      p_tenant_id: offer.tenant_id,
      p_entity_type: "lead",
      p_entity_id: offer.lead_id,
      p_payload: { offer_id: offer.id, vehicle_id: body.vehicleId, start_date: body.startDate, end_date: body.endDate },
    });
    await supabase.from("lead_activity").insert({
      tenant_id: offer.tenant_id,
      lead_id: offer.lead_id,
      actor_type: "lead",
      event_type: "offer_accepted",
      payload: { offer_id: offer.id, vehicle_id: body.vehicleId },
    });

    return jsonResponse({ status: "accepted", offerId: offer.id });
  } catch (err) {
    console.error("accept-offer error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
