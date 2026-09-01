// Universal operator-email dispatcher. Called (fire-and-forget) by the
// on_notification_operator_email DB trigger with ONLY a notification_id. The
// function RE-READS the notification row from the DB (never trusts caller
// content), maps its type -> email category, applies the same gate as every
// other operator email (master switch + per-category pref), and routes to the
// tenant's configured recipient. This gives operator EMAIL parity with the
// always-on portal BELL for transactional events, from a single place.
//
// SECURITY: content is derived from the trusted notifications row (not the
// request body), title/message are HTML-escaped, and the link is validated as a
// same-origin path — so this endpoint cannot be used to send arbitrary/branded
// phishing even though it is verify_jwt=false (the trigger sends no auth header).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  sendEmail,
  getTenantBranding,
  getTenantNotificationRecipient,
  isOperatorEmailEnabled,
  wrapWithBrandedTemplate,
} from "../_shared/resend-service.ts";

// Only TRANSACTIONAL event types dispatch a per-event email here. Reminder/digest
// types (insurance_reminder, return_overdue, rental_reminder, pickup_reminder,
// preauth_expiring) are intentionally EXCLUDED — they keep their own in-function
// digest email, so including them here would double-send. booking_new is also
// excluded (send-booking-notification owns its email).
const CATEGORY_BY_TYPE: Record<string, string> = {
  payment_received: "payments",
  payment_failed: "payments",
  refund_processed: "payments",
  fine_new: "fines",
  signing_completed: "verification",
  identity_verified: "verification",
  booking_approved: "bookings",
  booking_rejected: "bookings",
  booking_cancelled: "bookings",
  rental_started: "bookings",
  rental_completed: "returns",
  rental_extended: "bookings",
};

const escapeHtml = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Accept only a same-origin path like "/rentals/123". Reject anything that could
// change the host (protocol-relative "//", schemes, traversal).
const safePath = (link: unknown): string | null =>
  (typeof link === "string" && link.startsWith("/") && !link.startsWith("//") &&
    !link.includes("..") && !link.includes(":")) ? link : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { notification_id } = await req.json();
    if (!notification_id) return json({ skipped: true, reason: "no notification_id" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Re-derive ALL content from the trusted notification row.
    const { data: n } = await supabase
      .from("notifications")
      .select("tenant_id, type, title, message, link")
      .eq("id", notification_id)
      .maybeSingle();

    if (!n || !n.tenant_id) return json({ skipped: true, reason: "notification not found" });

    const category = n.type ? CATEGORY_BY_TYPE[n.type] : undefined;
    if (!category) return json({ skipped: true, reason: "type not emailable" });

    if (!(await isOperatorEmailEnabled(supabase, n.tenant_id, category))) {
      return json({ skipped: true, reason: "category disabled" });
    }

    const recipient = await getTenantNotificationRecipient(supabase, n.tenant_id);
    if (!recipient) return json({ skipped: true, reason: "no recipient" });

    const branding = await getTenantBranding(n.tenant_id, supabase);
    const path = safePath(n.link);
    const linkUrl = path ? `https://${branding.slug}.portal.drive-247.com${path}` : null;

    const content = `
                    <tr>
                        <td style="padding: 30px;">
                            <h2 style="margin: 0 0 16px; color: #1a1a1a; font-size: 20px;">${escapeHtml(n.title) || "Notification"}</h2>
                            <p style="margin: 0 0 24px; color: #444; font-size: 15px; line-height: 1.6;">${escapeHtml(n.message)}</p>
                            ${linkUrl ? `
                            <div style="text-align: center;">
                                <a href="${linkUrl}" style="display: inline-block; background: ${branding.accentColor}; color: #fff; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600;">View in portal</a>
                            </div>` : ""}
                            <p style="margin: 24px 0 0; color: #999; font-size: 12px; text-align: center;">You are receiving this because ${category} email notifications are enabled for your account.</p>
                        </td>
                    </tr>`;

    const html = wrapWithBrandedTemplate(content, branding);
    const result = await sendEmail(recipient, n.title ?? "Notification", html, supabase, n.tenant_id);

    return json({ sent: true, recipient, category, result });
  } catch (error) {
    console.error("notify-operator-email error:", error);
    return json({ success: false, error: (error as Error).message }, 500);
  }
});
