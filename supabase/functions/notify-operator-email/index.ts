// Universal operator-email dispatcher. Called (fire-and-forget) by the
// on_notification_operator_email DB trigger for every broadcast operator bell.
// Maps the notification type -> email category, applies the SAME gate as every
// other operator email (master switch + per-category pref), and routes to the
// tenant's configured recipient. This gives operator EMAIL parity with the
// always-on portal BELL for every event, from a single place.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  sendEmail,
  getTenantBranding,
  getTenantNotificationRecipient,
  isOperatorEmailEnabled,
  wrapWithBrandedTemplate,
} from "../_shared/resend-service.ts";

// notification type -> email preference category. Types not listed here get no
// operator email. booking_new is intentionally excluded: send-booking-notification
// already sends its operator email (avoids a double-send).
const CATEGORY_BY_TYPE: Record<string, string> = {
  payment_received: "payments",
  payment_failed: "payments",
  refund_processed: "payments",
  preauth_expiring: "payments",
  fine_new: "fines",
  signing_completed: "verification",
  identity_verified: "verification",
  booking_approved: "bookings",
  booking_rejected: "bookings",
  booking_cancelled: "bookings",
  pickup_reminder: "bookings",
  rental_started: "bookings",
  rental_extended: "bookings",
  rental_completed: "returns",
  return_overdue: "returns",
  rental_reminder: "returns",
  insurance_reminder: "insurance",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { tenant_id, type, title, message, link } = await req.json();
    const category = type ? CATEGORY_BY_TYPE[type] : undefined;

    if (!tenant_id || !category) {
      return new Response(JSON.stringify({ skipped: true, reason: "no category for type" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Gate: master switch AND per-category preference (missing row = off).
    if (!(await isOperatorEmailEnabled(supabase, tenant_id, category))) {
      return new Response(JSON.stringify({ skipped: true, reason: "category disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const recipient = await getTenantNotificationRecipient(supabase, tenant_id);
    if (!recipient) {
      return new Response(JSON.stringify({ skipped: true, reason: "no recipient" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const branding = await getTenantBranding(tenant_id, supabase);
    const linkUrl = link ? `https://${branding.slug}.portal.drive-247.com${link}` : null;

    const content = `
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 16px; color: #1a1a1a; font-size: 20px;">${title ?? "Notification"}</h2>
                            <p style="margin: 0 0 24px; color: #444; font-size: 15px; line-height: 1.6;">${message ?? ""}</p>
                            ${linkUrl ? `
                            <div style="text-align: center;">
                                <a href="${linkUrl}" style="display: inline-block; background: ${branding.accentColor}; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">View in portal</a>
                            </div>` : ""}
                            <p style="margin: 24px 0 0; color: #999; font-size: 12px; text-align: center;">You are receiving this because ${category} email notifications are enabled for your account.</p>
                        </td>
                    </tr>`;

    const html = wrapWithBrandedTemplate(content, branding);
    const result = await sendEmail(recipient, title ?? "Notification", html, supabase, tenant_id);

    return new Response(JSON.stringify({ sent: true, recipient, category, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("notify-operator-email error:", error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
