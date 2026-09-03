// @ts-nocheck — Deno edge function.
//
// Send (or resend) the ID-verification invite to a single additional driver.
//
// Uses Drive247's AI verification flow (NOT Veriff). Mirrors what
// create-ai-verification-session does for primary customers, but:
//   - identity_verifications.customer_id is NULL (additional drivers are not
//     customers; they live in rental_additional_drivers).
//   - external_user_id is "additional_driver_<driver_id>" so the completion
//     handler in process-ai-verification can route results back to the
//     rental_additional_drivers row.
//
// Flow:
//   1. Generate a QR token + URL (https://<tenant>.drive-247.com/verify/<token>)
//   2. Insert identity_verifications row keyed to the driver
//   3. Stamp the driver row with verification_url + identity_verification_id
//   4. Email the link to the driver via Resend (branded)
//
// Request body: { driver_id: string }
// Response: { success: true, verification_url } | { success: false, error }
//
// Auth: requires JWT; tenant ownership enforced via app_users.tenant_id.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "../_shared/cors.ts";
import { sendEmail, getTenantBranding, wrapWithBrandedTemplate } from "../_shared/resend-service.ts";

interface RequestBody {
  driver_id: string;
}

// QR session lives 3 hours (matches create-ai-verification-session). Operator
// resends from the rental detail page if the driver doesn't act in time.
const QR_TTL_MS = 3 * 60 * 60 * 1000;

function generateQRToken(): string {
  const uuid = crypto.randomUUID();
  const ts = Date.now().toString(36);
  return `${uuid}-${ts}`;
}

function buildVerifyUrl(tenantSlug: string, qrToken: string): string {
  const explicit = Deno.env.get("BOOKING_APP_URL");
  if (explicit) return `${explicit}/verify/${qrToken}`;
  return `https://${tenantSlug}.drive-247.com/verify/${qrToken}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inviteEmailHtml(driverName: string, verificationUrl: string, companyName: string): string {
  return `
    <p>Hi ${escapeHtml(driverName)},</p>
    <p>You have been added as an additional driver on a vehicle rental with <strong>${escapeHtml(companyName)}</strong>.</p>
    <p>To complete the process, please verify your driving licence using the secure link below. The link works on mobile and desktop and is valid for 3 hours — your operator can resend if it expires.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${verificationUrl}" style="background:#6366f1;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">
        Verify Your Licence
      </a>
    </p>
    <p>You will also receive a separate email shortly to sign the rental agreement.</p>
    <p style="color:#737373;font-size:12px;">If the button doesn't work, copy and paste this URL into your browser:<br/>${verificationUrl}</p>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Auth: resolve the caller's tenant_id from app_users via their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return softError("Missing authorization token");
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return softError("Invalid or expired token");
    const { data: appUser } = await supabase
      .from("app_users")
      .select("tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return softError("User not found in app_users");

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const driverId = body?.driver_id;
    if (!driverId) return softError("driver_id is required");

    // Load the driver row.
    const { data: driver, error: driverErr } = await supabase
      .from("rental_additional_drivers")
      .select("id, tenant_id, name, email, rental_id")
      .eq("id", driverId)
      .single();
    if (driverErr || !driver) return softError("Driver not found");
    if (!appUser.is_super_admin && appUser.tenant_id !== driver.tenant_id) {
      return softError("Not authorized for this driver");
    }
    if (!driver.email) {
      return softError("Cannot send email — driver has no email address");
    }

    // Tenant slug is needed for the verify URL; company_name + branding for
    // the email shell.
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("slug, company_name")
      .eq("id", driver.tenant_id)
      .single();
    if (tenantErr || !tenant?.slug) {
      return softError("Tenant slug not found — cannot build verification URL");
    }

    // Build the QR session.
    const qrToken = generateQRToken();
    const verifyUrl = buildVerifyUrl(tenant.slug, qrToken);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + QR_TTL_MS);

    // Insert verification record. customer_id is NULL because this driver is
    // NOT a `customers` row — they live in rental_additional_drivers. The
    // process-ai-verification handler reads external_user_id to figure out
    // where to route the completion.
    const { data: verification, error: vErr } = await supabase
      .from("identity_verifications")
      .insert({
        tenant_id: driver.tenant_id,
        provider: "ai",
        verification_provider: "ai",
        external_user_id: `additional_driver_${driver.id}`,
        session_id: sessionId,
        status: "pending",
        review_status: "pending",
        qr_session_token: qrToken,
        qr_session_expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();
    if (vErr) {
      console.error("[SendInvite] identity_verifications insert failed:", vErr);
      return softError(`Verification insert failed: ${vErr.message}`);
    }

    // Stamp the driver row with the linkage + URL so the rental detail page
    // can show "Resend" / "Open Verification URL" buttons.
    const { error: drvUpdErr } = await supabase
      .from("rental_additional_drivers")
      .update({
        identity_verification_id: verification.id,
        verification_url: verifyUrl,
        verification_status: "pending",
      })
      .eq("id", driver.id);
    if (drvUpdErr) {
      console.error("[SendInvite] driver row update failed:", drvUpdErr);
      // Non-fatal — verification row exists; the URL can be retrieved by
      // joining on identity_verification_id from another query.
    }

    // Send the invite email. Non-fatal: if Resend fails the verification row
    // is still good — operator can resend from the portal.
    try {
      const branding = await getTenantBranding(driver.tenant_id, supabase);
      const companyName = tenant.company_name || (branding as any)?.company_name || "Drive247";
      const html = wrapWithBrandedTemplate(
        inviteEmailHtml(driver.name, verifyUrl, companyName),
        branding,
      );
      await sendEmail(
        driver.email,
        `Verify your driving licence for the upcoming rental`,
        html,
        supabase,
        driver.tenant_id,
      );
    } catch (mailErr) {
      console.error("[SendInvite] email send failed (non-fatal):", mailErr);
    }

    return new Response(
      JSON.stringify({ success: true, verification_url: verifyUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[SendAdditionalDriverInvite] Fatal:", error);
    return softError(error instanceof Error ? error.message : "Unknown error");
  }
});

// Return 200 with success:false so the Supabase JS client surfaces the message
// in `data.error` rather than throwing a generic "non-2xx" error.
function softError(message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
