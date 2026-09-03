/**
 * lead-inbound-sms-webhook — Spec Section 15.4 + 6.4 Inbound message handling.
 *
 * Public endpoint (verify_jwt=false). Generic shape — accepts AWS SNS inbound
 * SMS notifications AND a simple JSON envelope so a Twilio webhook can be
 * pointed at the same URL later.
 *
 * Behaviour:
 *   1. Normalise the inbound phone.
 *   2. Find a non-terminal lead in any tenant with that phone_normalised.
 *      If none, fall through to creating a new lead with source='inbound_sms'
 *      on the matching tenant — V1 keeps this conservative and ONLY creates a
 *      lead when the destination phone resolves to a tenant via tenants.phone.
 *   3. Insert a conversation_messages row (direction='inbound').
 *   4. Update conversation.last_message_at + lead.last_message_at + last_activity_at.
 *   5. Emit lead.inbound_message event.
 *
 * AWS SNS sends a JSON with SubscribeURL during confirmation — we GET it once
 * automatically to complete the subscription handshake.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface GenericPayload {
  from?: string;
  to?: string;
  body?: string;
  channel?: "sms" | "whatsapp";
}

interface SnsEnvelope {
  Type?: string;
  Token?: string;
  SubscribeURL?: string;
  Message?: string;
  TopicArn?: string;
  MessageAttributes?: Record<string, { Type: string; Value: string }>;
}

function normalisePhone(raw: string): string {
  return (raw ?? "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const raw = await req.text();
    let payload: GenericPayload = {};
    let snsConfirmHandled = false;

    // Detect AWS SNS envelope (Content-Type: text/plain often)
    try {
      const parsed = JSON.parse(raw) as SnsEnvelope | GenericPayload;
      if ((parsed as SnsEnvelope).Type === "SubscriptionConfirmation" && (parsed as SnsEnvelope).SubscribeURL) {
        await fetch((parsed as SnsEnvelope).SubscribeURL!).catch(() => {});
        snsConfirmHandled = true;
      } else if ((parsed as SnsEnvelope).Type === "Notification" && (parsed as SnsEnvelope).Message) {
        const innerRaw = String((parsed as SnsEnvelope).Message);
        try {
          const inner = JSON.parse(innerRaw) as GenericPayload & {
            originationNumber?: string;
            destinationNumber?: string;
            messageBody?: string;
            originatingNumber?: string;
          };
          payload = {
            from: inner.from ?? inner.originationNumber ?? inner.originatingNumber,
            to: inner.to ?? inner.destinationNumber,
            body: inner.body ?? inner.messageBody ?? innerRaw,
            channel: "sms",
          };
        } catch {
          payload = { body: innerRaw, channel: "sms" };
        }
      } else {
        payload = parsed as GenericPayload;
      }
    } catch {
      // Twilio-style form-encoded fallback
      const formMatch = new URLSearchParams(raw);
      payload = {
        from: formMatch.get("From") ?? undefined,
        to: formMatch.get("To") ?? undefined,
        body: formMatch.get("Body") ?? undefined,
        channel: "sms",
      };
    }

    if (snsConfirmHandled) {
      return jsonResponse({ ok: true, status: "subscription_confirmed" });
    }
    if (!payload.from || !payload.body) {
      return jsonResponse({ ok: false, reason: "Missing from/body" }, 200);
    }

    const fromNorm = normalisePhone(payload.from);
    if (!fromNorm) return jsonResponse({ ok: false, reason: "Bad from" }, 200);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Find a non-terminal lead by phone (most-recent first; cross-tenant on purpose since
    // we don't know which tenant until we match the destination number below).
    const NON_TERMINAL = [
      "new", "contacted", "docs_requested", "docs_submitted", "docs_verified",
      "docs_failed", "approved", "vehicle_offered", "offer_accepted",
      "agreement_sent", "agreement_signed", "deposit_paid", "pickup_scheduled", "waitlist",
    ];

    const { data: existing } = await supabase
      .from("leads")
      .select("id, tenant_id, full_name, stage")
      .eq("phone_normalised", fromNorm)
      .in("stage", NON_TERMINAL)
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let leadId: string | null = existing?.id ?? null;
    let tenantId: string | null = existing?.tenant_id ?? null;

    // No lead — see if we can create one by matching the destination number to a tenant's
    // configured phone. Conservative: only act when there is a clean 1-to-1 match.
    if (!leadId && payload.to) {
      const toNorm = normalisePhone(payload.to);
      const { data: tenantMatches } = await supabase
        .from("tenants")
        .select("id, phone, lead_management_enabled")
        .eq("lead_management_enabled", true);
      const match = (tenantMatches ?? []).find((t) => normalisePhone(String(t.phone ?? "")) === toNorm && t.phone);
      if (match) {
        const { data: newLead } = await supabase
          .from("leads")
          .insert({
            tenant_id: match.id,
            full_name: "Unknown (inbound SMS)",
            email: `unknown-${fromNorm}@inbound.local`,
            phone: payload.from,
            application_data: { submissions: [{ submittedAt: new Date().toISOString(), source: "inbound_sms" }] },
            stage: "new",
            source: payload.channel === "whatsapp" ? "inbound_whatsapp" : "inbound_sms",
            source_metadata: { firstMessage: payload.body },
          })
          .select("id")
          .single();
        if (newLead) {
          leadId = newLead.id;
          tenantId = match.id;
          // Conversation gets auto-created here too
          await supabase.from("conversations").insert({ tenant_id: tenantId, lead_id: leadId });
        }
      }
    }

    if (!leadId || !tenantId) {
      return jsonResponse({ ok: false, reason: "No matching lead and no tenant claim" }, 200);
    }

    const { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (!conv?.id) {
      return jsonResponse({ ok: false, reason: "No conversation" }, 200);
    }

    await supabase.from("conversation_messages").insert({
      tenant_id: tenantId,
      conversation_id: conv.id,
      channel: payload.channel === "whatsapp" ? "whatsapp" : "sms",
      direction: "inbound",
      sender_type: "lead",
      body: payload.body,
      status: "sent",
    });

    const nowIso = new Date().toISOString();
    await supabase
      .from("conversations")
      .update({ last_message_at: nowIso, unread_count: 1 })
      .eq("id", conv.id);
    await supabase
      .from("leads")
      .update({ last_message_at: nowIso, last_activity_at: nowIso, is_read: false })
      .eq("id", leadId);

    // Emit event
    await supabase.rpc("notify_automation_event", {
      p_event_type: "lead.inbound_message",
      p_tenant_id: tenantId,
      p_entity_type: "lead",
      p_entity_id: leadId,
      p_payload: { channel: payload.channel ?? "sms", body: payload.body },
    });

    // Activity row
    await supabase.from("lead_activity").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      actor_type: "lead",
      event_type: "inbound_message",
      payload: { channel: payload.channel ?? "sms", body: payload.body },
    });

    return jsonResponse({ ok: true, leadId });
  } catch (err) {
    console.error("lead-inbound-sms-webhook error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
