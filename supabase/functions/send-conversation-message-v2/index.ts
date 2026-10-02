/**
 * send-conversation-message-v2 — send one SMS or email in a conversation to a
 * ONE-OFF destination, without touching the customer record.
 *
 * Input: { channelId, channel: "sms" | "email", content, to, subject?, metadata? }
 *
 * The v1 senders (`send-sms-message`, `send-email-message`) always deliver to
 * the phone / email ON FILE. The v2 Messages panel lets the operator reach a
 * customer at a different number or address for this conversation only
 * ("call me on my work phone today") — and that must not rewrite the customer
 * record, which stays the one place contact details are edited. So the
 * destination arrives in the request, is used for this one send, and is
 * recorded on the message row (`metadata.sent_to`, `metadata.to_override`) so
 * the thread shows where it actually went. `customers` is only ever read.
 *
 * Only called when an override is set; every other send still goes through
 * the v1 functions, unchanged (V2_PLAN §7).
 *
 * TENANT ISOLATION (§5): service role, so the caller's tenant comes from their
 * JWT and the channel must belong to it. Super admins act on the channel's
 * own tenant.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getTenantTwilioCredentials, sendTenantSMS, normalizePhoneNumber } from "../_shared/twilio-sms-client.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return errorResponse("Missing authorization", 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth } = await db.auth.getUser(jwt);
    if (!auth?.user) return errorResponse("Unauthorized", 401);

    const { data: appUser } = await db
      .from("app_users")
      .select("id, tenant_id, is_super_admin, is_active")
      .eq("auth_user_id", auth.user.id)
      .maybeSingle();
    if (!appUser || appUser.is_active === false) return errorResponse("Not allowed", 403);

    const { channelId, channel, content, to, subject, metadata } = await req.json();
    if (!channelId) return errorResponse("channelId is required");
    if (channel !== "sms" && channel !== "email") return errorResponse("channel must be sms or email");
    if (!content || typeof content !== "string" || !content.trim()) return errorResponse("content is required");
    if (!to || typeof to !== "string" || !to.trim()) return errorResponse("to is required");

    /* The conversation, scoped to the caller's tenant. */
    let q = db.from("chat_channels").select("id, tenant_id, customer_id").eq("id", channelId);
    if (!appUser.is_super_admin) q = q.eq("tenant_id", appUser.tenant_id);
    const { data: conv } = await q.maybeSingle();
    if (!conv) return errorResponse("Conversation not found", 404);
    const tenantId: string = conv.tenant_id;

    const baseMeta = metadata && typeof metadata === "object" ? metadata : {};
    let externalId: string | null = null;
    let externalStatus = "sent";
    let sentTo = to.trim();
    let cleanSubject: string | null = null;

    if (channel === "sms") {
      const creds = await getTenantTwilioCredentials(db, tenantId);
      if (!creds.isConfigured) {
        return errorResponse("Twilio SMS not configured for this tenant. Complete setup in Settings → Integrations.");
      }
      sentTo = normalizePhoneNumber(sentTo);
      const result = await sendTenantSMS(creds, sentTo, content);
      if (!result.success) return errorResponse(`SMS send failed: ${result.error}`);
      externalId = result.messageId ?? null;
      externalStatus = "queued";
    } else {
      if (!EMAIL_RE.test(sentTo)) return errorResponse("That email address does not look right.");
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      if (!RESEND_API_KEY) return errorResponse("Email service (Resend) not configured on platform", 500);

      const { data: tenant } = await db.from("tenants").select("company_name, email_from").eq("id", tenantId).maybeSingle();
      const fromEmail = tenant?.email_from || "noreply@drive-247.com";
      const fromName = tenant?.company_name || "Drive 247";
      cleanSubject = typeof subject === "string" && subject.trim() ? subject.trim().slice(0, 200) : `Message from ${fromName}`;

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [sentTo],
          subject: cleanSubject,
          html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <p style="font-size: 15px; line-height: 1.6; color: #333;">${escapeHtml(content).replace(/\n/g, "<br/>")}</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="font-size: 12px; color: #999;">This message was sent from ${escapeHtml(fromName)}. Please do not reply directly to this email.</p>
          </div>`,
          text: content,
        }),
      });
      const data = await res.json();
      if (!res.ok) return errorResponse(`Email send failed: ${data?.message || "Unknown error"}`);
      externalId = data?.id ?? null;
    }

    const { data: message, error: insertError } = await db
      .from("chat_channel_messages")
      .insert({
        channel_id: conv.id,
        sender_type: "tenant",
        sender_id: appUser.id,
        content,
        channel,
        external_id: externalId,
        external_status: externalStatus,
        metadata: {
          ...baseMeta,
          sent_to: sentTo,
          to_override: true,
          ...(channel === "email" ? { email_to: sentTo, subject: cleanSubject } : {}),
        },
      })
      .select()
      .single();
    if (insertError) {
      console.error("[send-conversation-message-v2] insert", insertError);
      return errorResponse(`${channel === "sms" ? "SMS" : "Email"} sent but failed to save to the conversation`);
    }

    await db
      .from("chat_channels")
      .update({ last_message_at: message.created_at, last_channel: channel, updated_at: new Date().toISOString() })
      .eq("id", conv.id)
      .eq("tenant_id", tenantId);

    return jsonResponse({ success: true, messageId: message.id, externalId });
  } catch (err) {
    console.error("[send-conversation-message-v2]", err);
    return errorResponse(err instanceof Error ? err.message : "Internal error", 500);
  }
});
