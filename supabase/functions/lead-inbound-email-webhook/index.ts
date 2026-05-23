/**
 * lead-inbound-email-webhook — Spec Section 15.4.
 *
 * Public endpoint (verify_jwt=false). Accepts SES/Resend inbound notifications
 * in a normalised JSON envelope:
 *
 *   { from, to, subject, body, inReplyTo? }
 *
 * Resolves the lead by:
 *   1. inReplyTo header → looks up conversation_messages.channel_message_id (preferred)
 *   2. from email → leads.email_lower
 *   3. to address → tenant by contact_email
 *
 * Inserts an inbound conversation_messages row and emits lead.inbound_message.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface EmailPayload {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
}

function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as EmailPayload;
    if (!body.from || !body.body) {
      return jsonResponse({ ok: false, reason: "Missing from/body" }, 200);
    }
    const fromEmail = extractEmail(body.from);
    const toEmail = body.to ? extractEmail(body.to) : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    let leadId: string | null = null;
    let tenantId: string | null = null;
    let conversationId: string | null = null;

    // 1. Resolve via inReplyTo (most reliable)
    if (body.inReplyTo) {
      const { data: prev } = await supabase
        .from("conversation_messages")
        .select("conversation_id, tenant_id")
        .eq("channel_message_id", body.inReplyTo)
        .maybeSingle();
      if (prev?.conversation_id) {
        conversationId = prev.conversation_id;
        tenantId = prev.tenant_id;
        const { data: conv } = await supabase
          .from("conversations")
          .select("lead_id")
          .eq("id", conversationId)
          .maybeSingle();
        leadId = conv?.lead_id ?? null;
      }
    }

    // 2. Fallback: find a non-terminal lead with this email
    if (!leadId) {
      const NON_TERMINAL = [
        "new", "contacted", "docs_requested", "docs_submitted", "docs_verified",
        "docs_failed", "approved", "vehicle_offered", "offer_accepted",
        "agreement_sent", "agreement_signed", "deposit_paid", "pickup_scheduled", "waitlist",
      ];
      const { data: existing } = await supabase
        .from("leads")
        .select("id, tenant_id")
        .eq("email_lower", fromEmail)
        .in("stage", NON_TERMINAL)
        .order("last_activity_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        leadId = existing.id;
        tenantId = existing.tenant_id;
      }
    }

    // 3. Fallback: match destination to a tenant.contact_email → create new lead
    if (!leadId && toEmail) {
      const { data: tenantMatch } = await supabase
        .from("tenants")
        .select("id, lead_management_enabled, contact_email")
        .eq("contact_email", toEmail)
        .eq("lead_management_enabled", true)
        .maybeSingle();
      if (tenantMatch?.id) {
        const { data: newLead } = await supabase
          .from("leads")
          .insert({
            tenant_id: tenantMatch.id,
            full_name: body.from.replace(/<[^>]+>/, "").trim() || "Unknown (inbound email)",
            email: fromEmail,
            phone: "",
            application_data: {
              submissions: [{ submittedAt: new Date().toISOString(), source: "inbound_email", subject: body.subject ?? "" }],
            },
            stage: "new",
            source: "inbound_email",
            source_metadata: { subject: body.subject, firstMessage: body.body },
          })
          .select("id")
          .single();
        if (newLead) {
          leadId = newLead.id;
          tenantId = tenantMatch.id;
          await supabase.from("conversations").insert({ tenant_id: tenantId, lead_id: leadId });
        }
      }
    }

    if (!leadId || !tenantId) {
      return jsonResponse({ ok: false, reason: "No matching lead" }, 200);
    }

    if (!conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", leadId)
        .maybeSingle();
      conversationId = conv?.id ?? null;
    }
    if (!conversationId) {
      return jsonResponse({ ok: false, reason: "No conversation" }, 200);
    }

    await supabase.from("conversation_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      channel: "email",
      direction: "inbound",
      sender_type: "lead",
      subject: body.subject ?? null,
      body: body.body,
      status: "sent",
    });

    const nowIso = new Date().toISOString();
    await supabase
      .from("conversations")
      .update({ last_message_at: nowIso, unread_count: 1 })
      .eq("id", conversationId);
    await supabase
      .from("leads")
      .update({ last_message_at: nowIso, last_activity_at: nowIso, is_read: false })
      .eq("id", leadId);

    await supabase.rpc("notify_automation_event", {
      p_event_type: "lead.inbound_message",
      p_tenant_id: tenantId,
      p_entity_type: "lead",
      p_entity_id: leadId,
      p_payload: { channel: "email", subject: body.subject ?? "", body: body.body },
    });

    await supabase.from("lead_activity").insert({
      tenant_id: tenantId,
      lead_id: leadId,
      actor_type: "lead",
      event_type: "inbound_message",
      payload: { channel: "email", subject: body.subject },
    });

    return jsonResponse({ ok: true, leadId });
  } catch (err) {
    console.error("lead-inbound-email-webhook error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
