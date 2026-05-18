// @ts-nocheck - Deno Edge Function
//
// cmd-resend-link — Re-sends the existing CMD magic link to the customer via
// the requested channels. Useful when the customer lost the original message.
// Does NOT generate a new verification; reuses the stored magic link URL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

type Channel = "email" | "sms" | "whatsapp";

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { verificationId, channels } = (await req.json()) as {
      verificationId: string;
      channels: Channel[];
    };

    if (!verificationId) return errorResponse("verificationId is required", 400);
    if (!Array.isArray(channels) || channels.length === 0) {
      return errorResponse("channels must be a non-empty array", 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: row, error: rowErr } = await supabase
      .from("identity_verifications")
      .select("id, customer_id, tenant_id, cmd_magic_link, cmd_magic_link_expires_at, cmd_delivery_channels")
      .eq("id", verificationId)
      .eq("provider", "cmd")
      .single();
    if (rowErr || !row) return errorResponse("Verification record not found", 404);
    if (!row.cmd_magic_link) return errorResponse("No magic link on this record", 400);
    if (row.cmd_magic_link_expires_at && new Date(row.cmd_magic_link_expires_at) < new Date()) {
      return errorResponse("Magic link has expired — please re-run verification", 410);
    }

    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .select("id, name, email, phone, tenant_id")
      .eq("id", row.customer_id)
      .single();
    if (custErr || !customer) return errorResponse("Customer not found", 404);

    const magicLink = row.cmd_magic_link as string;
    const name = customer.name || "there";
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width:560px; margin:0 auto; padding:24px; color:#111827;">
        <h2 style="margin:0 0 12px; font-size:20px;">Reminder: verify your driver's license</h2>
        <p style="margin:0 0 16px; line-height:1.55; color:#374151;">Hi ${name},</p>
        <p style="margin:0 0 16px; line-height:1.55; color:#374151;">
          We're following up on your verification. Please tap the link below to complete it.
        </p>
        <p style="margin:24px 0;">
          <a href="${magicLink}" style="display:inline-block; padding:12px 22px; background:#6366f1; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:600;">Verify my license</a>
        </p>
        <p style="margin:0; font-size:12px; color:#9ca3af;">Link valid for ~7 days from when it was first generated.</p>
      </div>`;
    const smsText = `Reminder: please verify your driver's license here: ${magicLink}`;

    const delivered: Channel[] = [];
    const errors: Record<string, string> = {};

    if (channels.includes("email") && customer.email) {
      try {
        const { error } = await supabase.functions.invoke("aws-ses-email", {
          body: { to: customer.email, subject: "Reminder: verify your driver's license", html },
        });
        if (error) throw error;
        delivered.push("email");
      } catch (e: any) { errors.email = e?.message ?? String(e); }
    }
    if (channels.includes("sms") && customer.phone) {
      try {
        const { error } = await supabase.functions.invoke("aws-sns-sms", {
          body: { phoneNumber: customer.phone, message: smsText },
        });
        if (error) throw error;
        delivered.push("sms");
      } catch (e: any) { errors.sms = e?.message ?? String(e); }
    }
    if (channels.includes("whatsapp") && customer.phone && customer.tenant_id) {
      try {
        const { error } = await supabase.functions.invoke("send-signing-whatsapp", {
          body: { customerPhone: customer.phone, message: smsText, tenantId: customer.tenant_id },
        });
        if (error) throw error;
        delivered.push("whatsapp");
      } catch (e: any) { errors.whatsapp = e?.message ?? String(e); }
    }

    // Merge channels into the stored set
    const existing = Array.isArray(row.cmd_delivery_channels) ? (row.cmd_delivery_channels as Channel[]) : [];
    const merged = Array.from(new Set([...existing, ...delivered]));
    await supabase.from("identity_verifications").update({ cmd_delivery_channels: merged }).eq("id", row.id);

    return jsonResponse({
      ok: true,
      deliveredVia: delivered,
      deliveryErrors: Object.keys(errors).length ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[cmd-resend-link] error:", err);
    return errorResponse(err?.message ?? "Internal error", 500);
  }
});
