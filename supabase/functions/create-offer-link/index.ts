/**
 * create-offer-link — Spec Section 6.6.
 *
 * Builds an offer + dispatches via chosen channel.
 *
 * Side effects:
 *   - Inserts lead_offers row (status='pending', generated 8-char short_code)
 *   - If sendMethod !== 'copy', calls send-lead-message with {{offer_link}} injected
 *   - Transitions lead to 'vehicle_offered'
 *   - Inserts lead_activity 'offer_sent'
 *   - notify_automation_event('lead.offer_sent')
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface OfferVehicle {
  vehicleId: string;
  priceOverride?: number;
  startDate?: string;
  endDate?: string;
}

interface Payload {
  leadId?: string;
  vehicles?: OfferVehicle[];
  customMessage?: string;
  defaultStartDate?: string;
  defaultEndDate?: string;
  dateFlexDays?: number;
  depositAmount?: number;
  showPrices?: boolean;
  expiresInHours?: number;
  sendMethod?: "sms" | "email" | "whatsapp" | "copy";
}

function nanoCode(size = 8): string {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let s = "";
  for (let i = 0; i < size; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.leadId) return errorResponse("leadId is required");
    if (!body.vehicles?.length) return errorResponse("vehicles are required");
    if (!body.defaultStartDate || !body.defaultEndDate) return errorResponse("default dates are required");
    if (body.defaultEndDate < body.defaultStartDate) return errorResponse("end date must be ≥ start date");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, tenant_id, full_name, stage")
      .eq("id", body.leadId)
      .maybeSingle();
    if (leadErr || !lead) return errorResponse("Lead not found", 404);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("slug")
      .eq("id", lead.tenant_id)
      .maybeSingle();

    // Generate a unique short_code (retry on collision)
    let shortCode = nanoCode(8);
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase
        .from("lead_offers")
        .select("id")
        .eq("short_code", shortCode)
        .maybeSingle();
      if (!existing) break;
      shortCode = nanoCode(8);
    }

    const expiresInHours = body.expiresInHours ?? 72;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

    const { data: offer, error: insertErr } = await supabase
      .from("lead_offers")
      .insert({
        tenant_id: lead.tenant_id,
        lead_id: lead.id,
        short_code: shortCode,
        vehicles: body.vehicles,
        custom_message: body.customMessage ?? null,
        default_start_date: body.defaultStartDate,
        default_end_date: body.defaultEndDate,
        date_flex_days: body.dateFlexDays ?? 0,
        deposit_amount: body.depositAmount ?? null,
        show_prices: body.showPrices ?? true,
        expires_at: expiresAt,
        status: "pending",
      })
      .select("id, short_code")
      .single();
    if (insertErr || !offer) {
      console.error("create-offer-link insert error:", insertErr);
      return errorResponse("Failed to create offer", 500);
    }

    const slug = tenant?.slug ?? "tenant";
    const offerUrl = `https://${slug}.drive-247.com/offer/${offer.short_code}`;

    // Transition lead to vehicle_offered (DB trigger emits lead.stage_changed)
    await supabase.from("leads").update({ stage: "vehicle_offered" }).eq("id", lead.id);

    // Activity row
    await supabase.from("lead_activity").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      actor_type: "staff",
      event_type: "offer_sent",
      payload: { offer_id: offer.id, short_code: offer.short_code, url: offerUrl },
    });

    // notify_automation_event lead.offer_sent
    await supabase.rpc("notify_automation_event", {
      p_event_type: "lead.offer_sent",
      p_tenant_id: lead.tenant_id,
      p_entity_type: "lead",
      p_entity_id: lead.id,
      p_payload: { offer_id: offer.id, vehicles: body.vehicles },
    });

    // Dispatch via channel
    if (body.sendMethod && body.sendMethod !== "copy") {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", lead.id)
        .maybeSingle();
      if (conv?.id) {
        const messageBody = body.customMessage
          ? `${body.customMessage}\n\n${offerUrl}`
          : `Hi {{first_name}}, here are some options for {{start_date}} – {{end_date}}: ${offerUrl}`;
        await supabase.functions.invoke("send-lead-message", {
          body: {
            tenantId: lead.tenant_id,
            leadId: lead.id,
            conversationId: conv.id,
            channel: body.sendMethod,
            body: messageBody,
            subject: body.sendMethod === "email" ? "Your vehicle options" : undefined,
            variables: { offer_link: offerUrl, start_date: body.defaultStartDate, end_date: body.defaultEndDate },
            systemTriggered: true,
          },
        });
      }
    }

    return jsonResponse({
      offerId: offer.id,
      shortCode: offer.short_code,
      url: offerUrl,
    });
  } catch (err) {
    console.error("create-offer-link error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
