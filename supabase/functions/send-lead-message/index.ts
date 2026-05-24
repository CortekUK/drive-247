/**
 * send-lead-message — Spec Section 6.4 + 15.
 *
 * Multi-channel outbound sender for a lead's conversation. Inserts a
 * conversation_messages row (direction='outbound', status='queued'), renders
 * {{variables}} server-side, dispatches to the appropriate channel, updates
 * the row to 'sent' with channel_message_id, and inserts a lead_activity entry.
 *
 * Channels:
 *   sms       → aws-sns-sms (existing)
 *   email     → Resend via _shared/resend-service.ts (branded with tenant template)
 *   whatsapp  → _shared/whatsapp-client.ts (Meta Graph API)
 *   note      → internal-only, no provider dispatch
 *
 * Variable substitution: re-implements the {{var}} pattern used by notify-lockbox-code.
 * Resolves system variables (first_name, vehicle, offer_link, etc.) from the lead row
 * + caller-supplied overrides.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  sendResendEmail,
  getTenantBranding,
  wrapWithBrandedTemplate,
} from "../_shared/resend-service.ts";

type Channel = "sms" | "email" | "whatsapp" | "note";

interface Payload {
  tenantId?: string;
  leadId?: string;
  conversationId?: string;
  channel?: Channel;
  body?: string;
  subject?: string;
  templateId?: string;
  variables?: Record<string, string | number>;
  /** Internal — set when called by another edge function (e.g., submit-application) */
  systemTriggered?: boolean;
}

interface LeadRow {
  id: string;
  tenant_id: string;
  full_name: string;
  email: string;
  phone: string;
  vehicle_id: string | null;
  vehicle_class: string | null;
  start_date: string | null;
  end_date: string | null;
}

interface TenantRow {
  id: string;
  company_name: string | null;
  slug: string | null;
  contact_email: string | null;
  phone: string | null;
}

function firstName(full: string): string {
  return (full?.split(" ")[0] ?? "").trim();
}

function renderTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const body = (await req.json()) as Payload;
    if (!body.tenantId) return errorResponse("tenantId is required");
    if (!body.leadId) return errorResponse("leadId is required");
    if (!body.conversationId) return errorResponse("conversationId is required");
    if (!body.channel) return errorResponse("channel is required");
    if (!body.body && !body.templateId) return errorResponse("body or templateId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Resolve lead + tenant for variable rendering
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("id, tenant_id, full_name, email, phone, vehicle_id, vehicle_class, start_date, end_date")
      .eq("id", body.leadId)
      .eq("tenant_id", body.tenantId)
      .maybeSingle();
    if (leadErr || !lead) return errorResponse("Lead not found", 404);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, company_name, slug, contact_email, phone")
      .eq("id", body.tenantId)
      .maybeSingle();

    let rawBody = body.body ?? "";
    let rawSubject = body.subject ?? "";
    let templateChannelOverride: Channel | null = null;
    if (body.templateId) {
      const { data: tpl } = await supabase
        .from("lead_message_templates")
        .select("body, subject, channel")
        .eq("id", body.templateId)
        .maybeSingle();
      if (tpl) {
        rawBody = tpl.body || rawBody;
        rawSubject = tpl.subject || rawSubject;
        templateChannelOverride = tpl.channel as Channel;
      }
    }

    const effectiveChannel = body.channel ?? templateChannelOverride ?? "sms";

    // Build variable map
    const t = tenant as TenantRow | null;
    const l = lead as LeadRow;
    const vars: Record<string, string | number> = {
      first_name: firstName(l.full_name),
      full_name: l.full_name,
      phone: l.phone,
      email: l.email,
      vehicle: l.vehicle_class ?? "",
      start_date: l.start_date ?? "",
      end_date: l.end_date ?? "",
      tenant_name: t?.company_name ?? "",
      tenant_phone: t?.phone ?? "",
      tenant_email: t?.contact_email ?? "",
      ...(body.variables ?? {}),
    };
    const renderedBody = renderTemplate(rawBody, vars);
    const renderedSubject = rawSubject ? renderTemplate(rawSubject, vars) : undefined;

    // Insert queued message row
    const senderType = body.systemTriggered ? "system" : "staff";
    const insertChannel = effectiveChannel === "note" ? "note" : effectiveChannel;
    const direction = effectiveChannel === "note" ? "internal" : "outbound";

    const { data: msg, error: insertErr } = await supabase
      .from("conversation_messages")
      .insert({
        tenant_id: body.tenantId,
        conversation_id: body.conversationId,
        channel: insertChannel,
        direction,
        sender_type: senderType,
        body: renderedBody,
        subject: renderedSubject ?? null,
        status: effectiveChannel === "note" ? "sent" : "queued",
      })
      .select("id")
      .single();
    if (insertErr || !msg) {
      console.error("send-lead-message insert error:", insertErr);
      return errorResponse("Failed to record message", 500);
    }

    // Internal note — done.
    if (effectiveChannel === "note") {
      await supabase.from("lead_activity").insert({
        tenant_id: body.tenantId,
        lead_id: body.leadId,
        actor_type: senderType === "system" ? "system" : "staff",
        event_type: "note_added",
        payload: { conversation_id: body.conversationId, message_id: msg.id },
      });
      return jsonResponse({ messageId: msg.id, status: "sent" });
    }

    // Dispatch
    let channelMessageId: string | null = null;
    let dispatchError: string | null = null;

    try {
      if (effectiveChannel === "sms") {
        const { data } = await supabase.functions.invoke("aws-sns-sms", {
          body: { phoneNumber: l.phone, message: renderedBody, tenantId: body.tenantId },
        }) as { data?: { messageId?: string; success?: boolean; error?: string } };
        if (data?.messageId) channelMessageId = data.messageId;
        if (data?.success === false) dispatchError = data.error ?? "SMS send failed";
      } else if (effectiveChannel === "email") {
        // Email goes via Resend (per CLAUDE.md — AWS SES path is deprecated for
        // tenant-facing mail). Wrap the body with the tenant's branded template
        // so the customer gets a logo + footer instead of plain text.
        if (!l.email) {
          dispatchError = "Lead has no email on file";
        } else {
          const branding = await getTenantBranding(body.tenantId, supabase);
          const inner = `
            <tr><td style="padding:30px;color:#333;line-height:1.6;font-size:15px;">
              ${renderedBody.replace(/\n/g, "<br/>")}
            </td></tr>`;
          const html = wrapWithBrandedTemplate(inner, branding);
          const result = await sendResendEmail(
            {
              to: l.email,
              subject: renderedSubject ?? "(no subject)",
              html,
              tenantId: body.tenantId,
              replyTo: branding.contactEmail,
            },
            supabase,
          );
          if (result.messageId) channelMessageId = result.messageId;
          if (!result.success) dispatchError = result.error ?? "Email send failed";
        }
      } else if (effectiveChannel === "whatsapp") {
        // Reuse send-collection-whatsapp for now — generic Meta Graph send.
        // V2 will introduce a generic send-lead-whatsapp wrapper.
        const { data } = await supabase.functions.invoke("send-collection-whatsapp", {
          body: {
            customerName: l.full_name,
            customerPhone: l.phone,
            vehicleName: l.vehicle_class ?? "your rental",
            vehicleReg: "",
            bookingRef: l.id.slice(0, 8),
            notes: renderedBody,
            tenantId: body.tenantId,
          },
        }) as { data?: { messageId?: string; success?: boolean; error?: string } };
        if (data?.messageId) channelMessageId = data.messageId;
        if (data?.success === false) dispatchError = data.error ?? "WhatsApp send failed";
      }
    } catch (err) {
      dispatchError = err instanceof Error ? err.message : "Dispatch error";
    }

    // Update message row with provider response
    await supabase
      .from("conversation_messages")
      .update({
        status: dispatchError ? "failed" : "sent",
        channel_message_id: channelMessageId,
        error: dispatchError,
      })
      .eq("id", msg.id);

    // Update conversation last_message_at
    await supabase
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
      })
      .eq("id", body.conversationId);

    // Update lead.last_message_at + last_activity_at
    await supabase
      .from("leads")
      .update({
        last_message_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      })
      .eq("id", body.leadId);

    // Activity log
    await supabase.from("lead_activity").insert({
      tenant_id: body.tenantId,
      lead_id: body.leadId,
      actor_type: senderType === "system" ? "system" : "staff",
      event_type: "message_sent",
      payload: {
        channel: effectiveChannel,
        message_id: msg.id,
        provider_id: channelMessageId,
        error: dispatchError,
      },
    });

    if (dispatchError) {
      return jsonResponse({ messageId: msg.id, status: "failed", error: dispatchError }, 200);
    }
    return jsonResponse({ messageId: msg.id, status: "sent", channelMessageId });
  } catch (err) {
    console.error("send-lead-message error:", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
