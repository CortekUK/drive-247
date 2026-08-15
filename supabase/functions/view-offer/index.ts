/**
 * view-offer — Spec Section 6.6.
 *
 * Public endpoint (verify_jwt=false). Resolves an offer by short_code,
 * returns the payload, increments view_count, sets first_viewed_at on first view.
 * Emits lead.offer_opened (idempotent: only on first view).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface Payload {
  shortCode?: string;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST" && req.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    let shortCode: string | undefined;
    if (req.method === "POST") {
      const body = (await req.json()) as Payload;
      shortCode = body.shortCode;
    } else {
      const url = new URL(req.url);
      shortCode = url.searchParams.get("code") ?? undefined;
    }
    if (!shortCode) return errorResponse("shortCode is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: offer, error } = await supabase
      .from("lead_offers")
      .select("*")
      .eq("short_code", shortCode)
      .maybeSingle();
    if (error) return errorResponse("Lookup failed", 500);
    if (!offer) return jsonResponse({ status: "not_found" }, 404);

    if (offer.status === "expired" || new Date(offer.expires_at).getTime() < Date.now()) {
      if (offer.status !== "expired") {
        await supabase.from("lead_offers").update({ status: "expired" }).eq("id", offer.id);
        await supabase.rpc("notify_automation_event", {
          p_event_type: "lead.offer_expired",
          p_tenant_id: offer.tenant_id,
          p_entity_type: "lead",
          p_entity_id: offer.lead_id,
          p_payload: { offer_id: offer.id },
        });
      }
      return jsonResponse({ status: "expired" }, 410);
    }

    // Mark viewed
    const updates: Record<string, unknown> = {
      view_count: (offer.view_count ?? 0) + 1,
      last_viewed_at: new Date().toISOString(),
      status: offer.status === "pending" ? "viewed" : offer.status,
    };
    if (!offer.first_viewed_at) {
      updates.first_viewed_at = new Date().toISOString();
    }
    await supabase.from("lead_offers").update(updates).eq("id", offer.id);

    if (!offer.first_viewed_at) {
      // Idempotent fire on first view
      await supabase.rpc("notify_automation_event", {
        p_event_type: "lead.offer_opened",
        p_tenant_id: offer.tenant_id,
        p_entity_type: "lead",
        p_entity_id: offer.lead_id,
        p_payload: { offer_id: offer.id },
      });
      await supabase.from("lead_activity").insert({
        tenant_id: offer.tenant_id,
        lead_id: offer.lead_id,
        actor_type: "lead",
        event_type: "offer_opened",
        payload: { offer_id: offer.id },
      });
    }

    // Hydrate vehicle details for display
    const vehicleIds = Array.isArray(offer.vehicles)
      ? (offer.vehicles as { vehicleId: string }[]).map((v) => v.vehicleId)
      : [];
    let vehicleDetails: Array<{
      id: string;
      make: string | null;
      model: string | null;
      photo_url: string | null;
      daily_rate: number | null;
      weekly_rate: number | null;
      monthly_rate: number | null;
      category: string | null;
    }> = [];
    if (vehicleIds.length > 0) {
      // The rate columns are daily_rent/weekly_rent/monthly_rent. Selecting
      // daily_rate (and rate_daily) asked for columns that do not exist, so
      // PostgREST failed the whole query with 42703 and the destructure
      // discarded the error — every offer page silently rendered with no
      // vehicle details at all. Aliased so the response shape is unchanged for
      // offer-page.tsx, which reads detail.weekly_rate.
      const { data: rows, error: vehicleError } = await supabase
        .from("vehicles")
        .select(
          "id, make, model, photo_url, category, daily_rate:daily_rent, weekly_rate:weekly_rent, monthly_rate:monthly_rent",
        )
        .in("id", vehicleIds);
      if (vehicleError) {
        console.error("view-offer: vehicle lookup failed", { code: vehicleError.code });
      }
      vehicleDetails = (rows ?? []) as typeof vehicleDetails;

      // An offer link is public and unauthenticated, so the plate rule the
      // booking site enforces has to hold here too: for a tenant that hides
      // plates, a photo the operator blurred must not be handed to a lead in
      // its original form. `vehicles.photo_url` has no redacted twin of its
      // own, so the redacted gallery copy stands in for it. Deliberately not
      // deny-by-default — matching customerPhotoUrl(), an unreviewed photo
      // still serves as-is rather than blanking the offer page.
      if (vehicleDetails.length > 0) {
        const { data: tenantRow } = await supabase
          .from("tenants")
          .select("hide_vehicle_registration")
          .eq("id", offer.tenant_id)
          .maybeSingle();

        if (tenantRow?.hide_vehicle_registration === true) {
          const { data: photos } = await supabase
            .from("vehicle_photos")
            .select("vehicle_id, redacted_url, redaction_status, display_order")
            .in("vehicle_id", vehicleIds)
            .eq("redaction_status", "redacted")
            .order("display_order", { ascending: true });

          const redactedByVehicle = new Map<string, string>();
          for (const p of (photos ?? []) as { vehicle_id: string; redacted_url: string | null }[]) {
            if (p.redacted_url && !redactedByVehicle.has(p.vehicle_id)) {
              redactedByVehicle.set(p.vehicle_id, p.redacted_url);
            }
          }

          vehicleDetails = vehicleDetails.map((v) =>
            redactedByVehicle.has(v.id) ? { ...v, photo_url: redactedByVehicle.get(v.id)! } : v,
          );
        }
      }
    }

    return jsonResponse({
      status: "valid",
      offer: {
        id: offer.id,
        shortCode: offer.short_code,
        leadId: offer.lead_id,
        vehicles: offer.vehicles,
        customMessage: offer.custom_message,
        defaultStartDate: offer.default_start_date,
        defaultEndDate: offer.default_end_date,
        dateFlexDays: offer.date_flex_days,
        depositAmount: offer.deposit_amount,
        showPrices: offer.show_prices,
        expiresAt: offer.expires_at,
      },
      vehicleDetails,
    });
  } catch (err) {
    console.error("view-offer error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
