import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendResendEmail } from "../_shared/resend-service.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Marks a submission whose super-admin alert went out, so a retry is a no-op. */
const NOTIFIED_EVENT = "super_admins_notified";

/**
 * Tell every active super admin that a tenant submitted the Bonzah form, so
 * someone on the Drive247 team checks it.
 *
 * Called fire-and-forget by the portal right after the submission insert
 * (apps/portal/src/hooks/use-bonzah-onboarding.ts). The tenant has already been
 * told their form was received, so nothing in here may surface to them — but
 * every failure is logged.
 *
 * This is about the FORM being submitted. Bonzah being connected is a later,
 * separate step, after Bonzah approves it.
 */
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401);

    // Client bound to the caller's JWT — used only to identify them.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return errorResponse("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { submissionId } = await req.json();
    if (!submissionId) return errorResponse("submissionId is required", 400);

    const { data: submission, error: submissionError } = await supabase
      .from("bonzah_onboarding_submissions")
      .select(
        "id, tenant_id, status, submitted_at, business_trade_name, business_legal_name, primary_contact_first_name, primary_contact_last_name, primary_contact_email, primary_contact_phone",
      )
      .eq("id", submissionId)
      .maybeSingle();
    if (submissionError) {
      console.error("Failed to load submission:", submissionError);
      return errorResponse("Failed to load submission", 500);
    }
    if (!submission) return errorResponse("Submission not found", 404);

    // AuthZ. The service-role read above bypasses RLS, so the check is here:
    // only the tenant's own staff (or a super admin) can trigger this alert.
    const { data: caller } = await supabase
      .from("app_users")
      .select("id, tenant_id, is_super_admin")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!caller?.is_super_admin && caller?.tenant_id !== submission.tenant_id) {
      return errorResponse("Forbidden", 403);
    }

    // Idempotency: one alert per submission.
    const { data: already } = await supabase
      .from("bonzah_submission_events")
      .select("id")
      .eq("submission_id", submission.id)
      .eq("event_type", NOTIFIED_EVENT)
      .limit(1);
    if (already && already.length > 0) {
      return jsonResponse({ success: true, alreadyNotified: true });
    }

    const { data: admins, error: adminsError } = await supabase
      .from("app_users")
      .select("email")
      .eq("is_super_admin", true)
      .eq("is_active", true);
    if (adminsError) {
      console.error("Failed to load super admins:", adminsError);
      return errorResponse("Failed to load super admins", 500);
    }
    // `.test` is a reserved TLD used by seeded test accounts; mail there
    // bounces and counts against the sending domain.
    const recipients = [
      ...new Set(
        (admins || [])
          .map((a: { email: string | null }) => a.email?.trim().toLowerCase())
          .filter((e): e is string => !!e && !e.endsWith(".test")),
      ),
    ];
    if (recipients.length === 0) {
      return jsonResponse({ success: true, skipped: true, reason: "no super admins" });
    }

    const { data: tenant } = await supabase
      .from("tenants")
      .select("company_name, slug")
      .eq("id", submission.tenant_id)
      .maybeSingle();

    const adminUrl = (Deno.env.get("ADMIN_APP_URL") || "https://admin.drive-247.com").replace(/\/$/, "");
    const reviewUrl = `${adminUrl}/admin/bonzah-onboarding`;
    const tenantName = tenant?.company_name || tenant?.slug || "A tenant";
    const contactName = [submission.primary_contact_first_name, submission.primary_contact_last_name]
      .filter(Boolean)
      .join(" ");
    const submittedAt = new Date(submission.submitted_at).toUTCString();

    const rows: [string, string | null | undefined][] = [
      ["Tenant", tenant?.slug ? `${tenantName} (${tenant.slug})` : tenantName],
      ["Business", submission.business_legal_name || submission.business_trade_name],
      ["Contact", contactName || null],
      ["Email", submission.primary_contact_email],
      ["Phone", submission.primary_contact_phone],
      ["Submitted", submittedAt],
    ];
    const shown = rows.filter(([, v]) => !!v) as [string, string][];

    // Plain internal email — deliberately NOT tenant-branded. It goes to the
    // Drive247 team.
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; color: #080812;">
        <h2 style="margin: 0 0 4px; font-size: 18px;">Bonzah form submitted</h2>
        <p style="margin: 0 0 20px; color: #737373; font-size: 13px;">${escapeHtml(tenantName)} has submitted the Bonzah form. Please check it.</p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          ${shown.map(([k, v]) => `<tr><td style="padding: 6px 0; color: #737373; width: 110px;">${escapeHtml(k)}</td><td style="padding: 6px 0;">${escapeHtml(v)}</td></tr>`).join("")}
        </table>
        <p style="margin: 20px 0 0;">
          <a href="${reviewUrl}" style="display: inline-block; padding: 10px 18px; background: #6366f1; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 14px;">Check the Bonzah form</a>
        </p>
      </div>
    `;
    const text = [
      `${tenantName} has submitted the Bonzah form. Please check it.`,
      "",
      ...shown.map(([k, v]) => `${k}: ${v}`),
      "",
      reviewUrl,
    ].join("\n");

    // One send per admin, so nobody sees the others' addresses.
    let sent = 0;
    for (const to of recipients) {
      const result = await sendResendEmail({
        to,
        subject: `Bonzah form submitted — ${tenantName}`,
        html,
        text,
        fromName: "Drive247 Onboarding",
      });
      if (result.success) sent++;
      else console.error(`Bonzah-form alert to ${to} failed:`, result.error);
    }

    if (sent === 0) return errorResponse("Failed to send notification", 500);

    // Only stamp once at least one admin was told, so a total failure stays
    // retryable.
    await supabase.from("bonzah_submission_events").insert({
      submission_id: submission.id,
      tenant_id: submission.tenant_id,
      actor_type: "system",
      event_type: NOTIFIED_EVENT,
      note: `Super admins emailed (${sent}/${recipients.length})`,
      metadata: { sent, total: recipients.length },
    });

    return jsonResponse({ success: true, sent, total: recipients.length });
  } catch (error) {
    console.error("notify-bonzah-form-submitted error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unexpected error", 500);
  }
});
